import { pointAt, metres } from '../lib/walking-geometry.ts';
import { corridorRing, crownRing as disk, offsetMetres as offset } from '../lib/pedestrian-geometry.ts';
import { wayCoordinates, mapText } from './map-cartography.mjs';

// OpenSidewalks-inspired, source-addressable facts. A layer is a relative
// ordering tag, not metres above street level, nor necessarily a floor.
const paths = new Set(['footway','path','pedestrian','steps','corridor','crossing','cycleway','track','bridleway','service']);
const yes = value => ['yes','designated','permissive'].includes(value);
const metric = (v,min,max) => {
    const m = /^(-?\d+(?:\.\d+)?)\s*m?$/.exec(String(v??'').trim());
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n)&&n>=min&&n<=max?n:undefined;
};
const boolean = value => value==='yes'?true:value==='no'?false:undefined;
const numericLevels = value => typeof value==='string'&&/^-?\d+(?:\.\d+)?(?:;-?\d+(?:\.\d+)?)*$/.test(value)?value.split(';').map(Number):[];
const clean = value => typeof value==='string'?value.trim().slice(0,200):undefined;
export function wayFacts(tags={}) {
    const levels=numericLevels(tags.level), layer=metric(tags.layer,-20,20);
    const tunnel=tags.tunnel&& !['no','covered','building_passage'].includes(tags.tunnel);
    const bridge=tags.bridge&&tags.bridge!=='no';
    const structure=tunnel?'tunnel':bridge?'bridge':tags.indoor==='yes'||tags.indoor==='corridor'||tags.highway==='corridor'?'indoor':'surface';
    const levelGroups=levels.length?[...new Set(levels.map(v=>v<0?'below':v>0?'above':'ground'))]:[tunnel||layer<0?'below':bridge||layer>0?'above':structure==='indoor'?'unknown':'ground'];
    const covered=tags.covered==='no'?false:['yes','arcade','colonnade','shelter'].includes(tags.covered)||['building_passage','covered'].includes(tags.tunnel)?true:undefined;
    const incline=/^(-?\d+(?:\.\d+)?)%$/.exec(tags.incline??'');
    const slope=incline?metric(incline[1],-100,100):undefined;
    const clearWidth=metric(tags['width:effective'],.1,30)??metric(tags.width,.1,30);
    const kerb=tags.kerb==='lowered'||tags.kerb==='flush'?true:['raised','rolled'].includes(tags.kerb)?false:undefined;
    const ramp=boolean(tags['ramp:wheelchair']??tags.ramp);
    const count=metric(tags.step_count,1,500);
    return Object.fromEntries(Object.entries({structure,levels,layer,levelGroups,covered,clearWidth,slope,kerb,
        // A ramp beside stairs does not make the stairs a step-free edge.
        ramp,stepCount:tags.highway==='steps'&&Number.isInteger(count)?count:undefined,
        tactile:boolean(tags.tactile_paving),audible:boolean(tags['traffic_signals:sound']),kerbHeight:metric(tags['kerb:height'],0,1),
        openingHours:clean(tags.opening_hours),restricted: ['no','private','customers','permit'].includes(tags.foot)||(!yes(tags.foot)&&['no','private','customers','permit'].includes(tags.access)),
        connector:tags.highway==='steps'?'stairs':tags.highway==='elevator'?'lift':ramp===true?'ramp':bridge?'bridge':tunnel?'underpass':undefined,
        incline:clean(tags.incline),source:'osm',
    }).filter(([,v])=>v!==undefined));
}
const feature=(ref,geometry,properties)=>({type:'Feature',geometry,properties:{kind:'infrastructure',osmRef:ref,source:'OpenStreetMap',...properties}});
const polygon=ring=>({type:'Polygon',coordinates:[ring]});
const lineGeom=coordinates=>({type:'LineString',coordinates});
const group=facts=>facts.levelGroups.join('|');
const labels={roof:'Mapped covered walkway',bridge:'Mapped pedestrian bridge',underpass:'Mapped underpass',stairs:'Mapped stairway',ramp:'Mapped ramp',tactile:'Mapped tactile paving',kerb:'Mapped kerb',lift:'Mapped lift location',bench:'Mapped bench',tree:'Mapped tree',signal:'Mapped accessible signal',wood:'Mapped wooded area',shelter:'Mapped shelter',toilet:'Mapped toilet',water:'Mapped drinking water',entrance:'Mapped entrance'};
function specs(kind, facts,extra={}){return {modelKind:kind,modelLabel:labels[kind],levelGroup:group(facts),level:facts.levels.join(';'),structure:facts.structure,restricted:facts.restricted, ...extra};}

export function buildPedestrianModel(elements, baseFeatures, area) {
    const features=[],ways={},gaps=[],counts={};
    const sourceByRef=new Map(elements.map(e=>[`${e.type}/${e.id}`,e]));
    const add=f=>{features.push(f);const k=f.properties.modelKind;counts[k]=(counts[k]??0)+1;};
    const gap=(ref,kind,fields,geometry)=>{const source=sourceByRef.get(ref);if(fields.length)gaps.push({type:'Feature',geometry,properties:{ref,kind,missing:fields.join('; '),source:source?'OpenStreetMap · mapped, not field checked':'Imported model · needs checking',source_archive:source?.sourceArchive??null,source_date:source?.sourceDate??null}});};
    const pointOf=element=>Number.isFinite(element.lon)&&Number.isFinite(element.lat)?[element.lon,element.lat]:null;
    for(const element of elements){
        const t=element.tags??{},ref=`${element.type}/${element.id}`;
        if(element.type==='way'&&paths.has(t.highway)&&(t.highway!=='service'||yes(t.foot))){
            const line=wayCoordinates(element);if(line.length<2)continue;
            const facts={...wayFacts(t),sourceArchive:element.sourceArchive,sourceDate:element.sourceDate};const {structure,connector,covered,clearWidth,stepCount,tactile,kerb,slope}=facts;
            // Omit default facts from the sidecar; only special or attributed ways need transfer.
            if(structure!=='surface'||covered!==undefined||connector||clearWidth!==undefined||tactile!==undefined||kerb!==undefined||facts.audible!==undefined||facts.levels.length||facts.layer||slope!==undefined||facts.openingHours||facts.restricted||facts.incline)ways[String(element.id)]=facts;
            const width=clearWidth??(structure==='bridge'?2.4:2);
            const common={width,dimensionSource:clearWidth!==undefined?'mapped width; schematic elevation':'schematic dimensions',visualOnly:true,...(t.name?{name:clean(t.name),mapName:mapText(clean(t.name))}:{})};
            const ring=corridorRing(line,width);
            const z=structure==='bridge'?Math.max(1,Math.min(12,(facts.layer>0?facts.layer:1)*4)):0;
            if(structure==='bridge'&&ring)add(feature(ref,polygon(ring),specs('bridge',facts,{...common,base:Math.max(0,z-.35),height:z})));
            if(covered&&structure!=='tunnel'&&ring)add(feature(ref,polygon(ring),specs('roof',facts,{...common,base:z+2.8,height:z+3.15})));
            if(structure==='tunnel')add(feature(ref,lineGeom(line),specs('underpass',facts,{visualOnly:true,dimensionSource:'schematic alignment'})));
            if(t.highway==='steps'){
                // No step count: use a dashed line rather than an invented number of steps.
                if(stepCount&&ring){
                    const count=Math.min(60,stepCount),len=line.slice(1).reduce((n,p,i)=>n+metres(line[i],p),0),widthFraction=Math.min(.4,Math.max(.08,.1/(len/count||1)));
                    const bands=Array.from({length:count},(_,i)=>corridorRing([pointAt(line,(i+.5-widthFraction/2)/count),pointAt(line,(i+.5+widthFraction/2)/count)],width)).filter(Boolean).map(r=>[r]);
                    if(bands.length)add(feature(ref,{type:'MultiPolygon',coordinates:bands},specs('stairs',facts,{...common,base:z,height:z+.08,stepCount})));
                }else add(feature(ref,lineGeom(line),specs('stairs',facts,{...common})));
            }else if(facts.ramp===true&&ring)add(feature(ref,polygon(ring),specs('ramp',facts,{...common,base:z,height:z+.08,...(slope!==undefined?{slope}:{})})));
            if(tactile===true)add(feature(ref,lineGeom(line),specs('tactile',facts,{visualOnly:true,dimensionSource:'mapped indication; continuity unknown'})));
            const missing=[];
            if(clearWidth===undefined)missing.push('clear width (m)');
            if(slope===undefined&&t.highway!=='steps')missing.push('measured incline (%)');
            if(covered===undefined)missing.push('roof cover and continuity');
            if(tactile===undefined)missing.push('tactile paving presence and continuity');else if(tactile)missing.push('tactile paving continuity and condition');
            if(t.highway==='steps'&&!stepCount)missing.push('step count and dimensions');
            if(t.highway==='steps'&&facts.ramp===undefined)missing.push('adjacent ramp, accessibility and connection');
            if(structure!=='surface')missing.push('physical elevation / floor connections');
            if(structure==='indoor'||structure==='tunnel'||structure==='bridge')missing.push('public access hours and entrances');
            if(covered)missing.push('roof height, width and openings');
            if(t.footway==='crossing'||t.highway==='crossing'||t.crossing){if(kerb===undefined)missing.push('kerb height / ramp at both ends');if(facts.audible===undefined)missing.push('audible signal and timing');}
            gap(ref,'path',missing,lineGeom(line));
        }
        if(element.type==='way'&&t.highway==='elevator'){
            const line=wayCoordinates(element);if(line.length){const facts=wayFacts(t),geometry={type:'Point',coordinates:pointAt(line,.5)};
                add(feature(ref,geometry,specs('lift',facts,{visualOnly:true})));gap(ref,'lift',['served floors and connected doors','availability, hours, dimensions'],geometry);}
        }
        // A facility symbol is a mapped observation, not proof of a usable
        // door, drinking water, toilet access or public opening hours.
        const facilityKind={shelter:'shelter',toilets:'toilet',drinking_water:'water'}[t.amenity]??(t.entrance&&t.entrance!=='no'?'entrance':undefined);
        if(facilityKind){
            const line=element.type==='way'?wayCoordinates(element):[],p=pointOf(element)??(line.length?pointAt(line,.5):null);
            if(p){const geometry={type:'Point',coordinates:p},facts=wayFacts(t);add(feature(ref,geometry,specs(facilityKind,facts,{visualOnly:true,...(t.name?{name:clean(t.name)}:{})})));
                const fields=facilityKind==='entrance'?['usable door, served floor, step-free connection','opening hours']:facilityKind==='toilet'?['accessible toilet and usable door','hours, fee and access terms']:facilityKind==='water'?['working drinking-water facility','access and hours']:['roof extent, availability and access'];
                gap(ref,facilityKind,fields,geometry);}
        }
        if(element.type!=='node')continue;
        const p=pointOf(element);if(!p)continue;
        const facts=wayFacts(t);
        const point={type:'Point',coordinates:p};
        if(t.amenity==='bench'){
            // Reusable low-poly seat footprint (symbol, not measured clear space).
            const ring=corridorRing([offset(p,-.8,0),offset(p,.8,0)],.55);
            add(feature(ref,polygon(ring),specs('bench',facts,{base:.36,height:.52,visualOnly:true,dimensionSource:'schematic seat'})));
            gap(ref,'bench',['seat condition, armrests, backrest','step-free approach / wheelchair space','shelter and hours'],point);
        }
        if(t.highway==='elevator'){
            add(feature(ref,point,specs('lift',facts,{visualOnly:true})));gap(ref,'lift',['served floors and connected doors','availability, hours, dimensions'],point);
        }
        if(t.barrier==='kerb'||t.kerb){add(feature(ref,point,specs('kerb',facts,{visualOnly:true,...(facts.kerbHeight!==undefined?{kerbHeight:facts.kerbHeight}:{})})));gap(ref,'kerb',['measured height and ramp width / slope','crossing endpoint connection'],point);}
        if(t.tactile_paving==='yes')add(feature(ref,point,specs('tactile',facts,{visualOnly:true,dimensionSource:'mapped at point; continuity unknown'})));
        if(facts.audible===true)add(feature(ref,point,specs('signal',facts,{visualOnly:true})));
        if(t.natural==='tree'){
            const height=metric(t.height,1,80),diameter=metric(t.diameter_crown,.5,60);
            if(height&&diameter)add(feature(ref,polygon(disk(p,diameter)),{kind:'vegetation',modelKind:'tree',modelLabel:labels.tree,height,base:height,dimensionSource:'mapped crown dimensions',heightSource:'height',solarEligible:true}));
            else gap(ref,'tree',['crown extent, height and current condition'],point);
        }
    }
    for(const f of baseFeatures){
        const p=f.properties;
        if(p.kind==='path'){
            const facts=ways[p.osmRef?.split('/')[1]];
            p.levelGroup=facts?group(facts):p.structure==='tunnel'?'below':p.structure==='bridge'?'above':'ground';
        }
        if(p.kind==='green'&&p.landcover==='wood'){
            // Real OSM vegetation extent only. No tree count, canopy height or shadow fabricated.
            gap(p.osmRef??p.sourceRef,'wooded area',['canopy height, crown extent and observation date'],f.geometry);
        }
        if(p.kind==='building'&&p.heightSource==='approximate'&&p.volume!==false)gap(p.osmRef??p.sourceRef,'building',['height; roof and base where relevant'],f.geometry);
    }
    for(const f of features){const source=sourceByRef.get(f.properties.osmRef);if(source?.sourceDate)f.properties.sourceDate=source.sourceDate;}
    return {area,features,ways,gaps,counts};
}

export function sharedShadeDataset(features, centre, ways){
    const objects=[];let buildings=0,crowns=0;
    for(const f of features){
        const p=f.properties;
        if(!(p.height>0)||p.height<p.base||p.visualOnly||p.volume===false||p.heightSource==='approximate')continue;
        if(p.kind!=='building'&&!(p.kind==='vegetation'&&p.solarEligible))continue;
        const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
        for(const polygon of polygons){
            if(polygon[0].length<4)continue;
            const strip=ring=>ring.slice(0,-1);
            objects.push({ring:strip(polygon[0]),...(polygon.length>1?{holes:polygon.slice(1).map(strip)}:{}),height:p.height,base:p.base??0,source_ref:p.osmRef??p.sourceRef,source:p.source??'OpenStreetMap',height_source:p.heightSource});
            if(p.kind==='building')buildings++;else crowns++;
        }
    }
    const non_ground_ways=Object.entries(ways).filter(([,w])=>w.levelGroups.some(g=>g!=='ground')||w.structure!=='surface').map(([id])=>id);
    return {centre,objects,non_ground_ways,coverage:'partial',buildings,crowns};
}
