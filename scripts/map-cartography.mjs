// Display-only extraction from dated OSM archives. Never use these visual
// heights, street widths or basemap features as routing/verification evidence.
const footways = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'crossing', 'corridor', 'bridleway']);
const roads = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'road', 'busway']);
const green = new Set(['park', 'garden', 'grass', 'forest', 'wood', 'recreation_ground', 'grassland', 'shrubbery', 'meadow', 'scrub', 'cemetery', 'village_green', 'orchard']);
const rail = new Set(['rail', 'light_rail', 'subway', 'tram', 'monorail', 'narrow_gauge']);
const civic = new Set(['university', 'college', 'school', 'library', 'hospital', 'community_centre', 'marketplace', 'place_of_worship', 'arts_centre', 'theatre', 'townhall', 'courthouse']);
const transit = new Set(['station', 'halt', 'tram_stop', 'subway_entrance', 'train_station_entrance']);
const food = new Set(['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream', 'bar', 'pub']);
const no = v => !v || v === 'no';
const text = v => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
const nameOf = t => text(t['name:en'] || t.name || t['name:ms'] || t['waterway:name']);
export function mapText(name) {
    // The offline MapLibre glyph set contains Basic Latin/Latin-1 and general
    // punctuation. Retain every original name for the 2D map and inspector.
    return [...name].every(c => c.codePointAt(0) <= 255 || (c.codePointAt(0) >= 8192 && c.codePointAt(0) <= 8447)) ? name : '';
}
const samePoint = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
export const closedRing = ring => ring.length >= 4 && samePoint(ring[0], ring.at(-1));
const bbox = ring => ring.reduce(([w, s, e, n], [x, y]) => [Math.min(w,x), Math.min(s,y), Math.max(e,x), Math.max(n,y)], [Infinity,Infinity,-Infinity,-Infinity]);
const withinBounds = ([x,y], [w,s,e,n]) => x >= w && x <= e && y >= s && y <= n;
function insideRing([x,y], ring) {
    let inside = false;
    for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
        const [a,b]=ring[i], [c,d]=ring[j];
        if ((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a) inside=!inside;
    }
    return inside;
}
const insidePolygon = (point, rings) => insideRing(point,rings[0]) && !rings.slice(1).some(r=>insideRing(point,r));
const polygonsOf = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
export function wayCoordinates(way) {
    return way?.geometry?.length && way.geometry.every(p=>Number.isFinite(p?.lon)&&Number.isFinite(p?.lat))
        ? way.geometry.map(p=>[p.lon,p.lat]) : [];
}
function stitchRings(lines) {
    const todo = lines.filter(line=>line.length>=2).map(line=>line.slice());
    const result=[];
    while(todo.length){
        let ring=todo.pop();
        while(!closedRing(ring)){
            const i=todo.findIndex(line=>samePoint(ring.at(-1),line[0])||samePoint(ring.at(-1),line.at(-1)));
            if(i<0)break;
            const line=todo.splice(i,1)[0];
            ring=ring.concat((samePoint(ring.at(-1),line[0])?line:line.reverse()).slice(1));
        }
        if(closedRing(ring))result.push(ring);
    }
    return result;
}
/** Join OSM multipolygon member ways, keeping courtyards and lake islands.
 * Incomplete outer rings are never closed or filled with invented geometry. */
export function relationGeometry(element, ways) {
    if(element.tags?.type!=='multipolygon')return null;
    const lines=role=>(element.members??[]).filter(m=>m.type==='way'&&(role==='outer'?m.role==='outer'||!m.role:m.role==='inner'))
        .map(m=>{const line=wayCoordinates(m);return line.length?line:wayCoordinates(ways.get(m.ref));});
    const outers=stitchRings(lines('outer')).map(r=>[r]);
    for(const hole of stitchRings(lines('inner'))){
        const owner=outers.find(p=>insideRing(hole[0],p[0]));
        if(owner)owner.push(hole);
    }
    if(!outers.length)return null;
    return outers.length===1?{type:'Polygon',coordinates:outers[0]}:{type:'MultiPolygon',coordinates:outers};
}
function metric(value,min=0,max=800){
    const match=/^(\d+(?:\.\d+)?)\s*m?$/.exec(String(value??'').trim());
    const n=match?Number(match[1]):NaN;
    return Number.isFinite(n)&&n>=min&&n<=max?n:null;
}
const levels = value => metric(value,0,200);
function buildingUse(tags){
    const type=tags['building:part']&&tags['building:part']!=='yes'?tags['building:part']:tags.building;
    if(type==='roof'||tags['building:part']==='roof')return 'canopy';
    if(civic.has(type)||civic.has(tags.amenity)||type==='civic'||type==='religious')return 'civic';
    if(['commercial','retail','office','hotel','supermarket','industrial','warehouse'].includes(type)||tags.shop)return 'commercial';
    if(['house','detached','semidetached_house','terrace','residential','apartments','bungalow','dormitory'].includes(type))return 'residential';
    return 'other';
}
export function buildingDimensions(tags){
    const use=buildingUse(tags);
    const count=levels(tags['building:levels']);
    const explicit=metric(tags.height,.1,800);
    const existingBase=metric(tags.min_height,0,799)??(levels(tags['building:min_level'])!==null?3*levels(tags['building:min_level']):null);
    const roofHeight=metric(tags['roof:height'],0,100)??(levels(tags['roof:levels'])??0)*2.5;
    const levelHeight=count!==null&&count>0?3*count+roofHeight:null;
    const recorded=explicit??levelHeight;
    // A missing height still has a readable low volume; all approximations are
    // labelled as such and are isolated from the solar/accessibility models.
    const fallback=use==='canopy'?3.5:tags.building==='bungalow'||tags.building==='shed'?3.5:use==='residential'?6:7;
    const top=recorded??Math.max(fallback,(existingBase??0)+Math.min(3.5,fallback));
    const base=existingBase??(use==='canopy'?Math.max(0,top-.45):0);
    const valid=top>base;
    return {height:valid?top:base+1,base,use,part:!no(tags['building:part']),volume:true,
        heightSource:valid&&explicit!==null?'height':valid&&levelHeight!==null?'levels':'approximate',
        ...(count!==null?{levels:count}:{}),...(tags['roof:shape']?{roofShape:text(tags['roof:shape'])}:{}),
        ...(existingBase!==null?{baseSource:metric(tags.min_height,0,799)!==null?'height':'levels'}:{})};
}
function polygonProperties(tags){
    if(!no(tags.building)||!no(tags['building:part']))return {kind:'building',...buildingDimensions(tags)};
    if(tags.natural==='water'||tags.water||tags.waterway==='riverbank'||tags.amenity==='fountain')return {kind:'water'};
    if(['pitch','track','stadium','sports_centre'].includes(tags.leisure))return {kind:'pitch',landcover:tags.leisure,...(tags.sport?{sport:text(tags.sport)}:{})};
    const vegetation=[tags.leisure,tags.natural,tags.landcover,tags.landuse].find(v=>green.has(v));
    if(vegetation)return {kind:'green',landcover:['forest','wood','scrub','shrubbery'].includes(vegetation)?'wood':vegetation==='park'||vegetation==='garden'?vegetation:'grass'};
    if(tags.highway==='pedestrian'&&tags.area==='yes'||tags.place==='square')return {kind:'plaza'};
    if(tags.amenity==='parking')return {kind:'parking'};
    if(tags.man_made==='bridge')return {kind:'deck'};
    if(['university','college','school','hospital','kindergarten'].includes(tags.amenity)||tags.landuse==='education')return {kind:'landuse',landcover:'institutional'};
    if(['residential','commercial','retail','industrial','institutional','religious','civic_admin','railway','construction','brownfield'].includes(tags.landuse))return {kind:'landuse',landcover:tags.landuse};
    return null;
}
function structure(tags){
    const level=Number(tags.layer);
    return !no(tags.bridge)?'bridge':(!no(tags.tunnel)&&tags.tunnel!=='building_passage'&&tags.tunnel!=='covered')||level<0?'tunnel':'surface';
}
function linearProperties(tags){
    const grade=structure(tags);
    if(['river','canal','stream','ditch','drain'].includes(tags.waterway)&&grade!=='tunnel')return {kind:'watercourse',waterway:tags.waterway};
    if(rail.has(tags.railway))return {kind:'rail',railway:tags.railway,structure:grade};
    const highway=(tags.highway??'').replace(/_link$/,'');
    if(roads.has(highway)){
        const roadClass=['motorway','trunk'].includes(highway)?'arterial':highway==='primary'?'primary':highway==='secondary'?'secondary':highway==='tertiary'?'collector':highway==='service'?'service':'local';
        return {kind:'street',road:['arterial','primary','secondary','collector'].includes(roadClass)?'major':'local',roadClass,structure:grade};
    }
    if(footways.has(highway)){
        const covered=tags.covered!=='no'&&(['yes','arcade','shelter','colonnade'].includes(tags.covered)||['building_passage','covered'].includes(tags.tunnel));
        const pathType=highway==='steps'?'steps':highway==='crossing'||tags.footway==='crossing'||tags.crossing?'crossing':covered?'covered':highway==='corridor'?'corridor':['cycleway','track','bridleway'].includes(highway)?'shared':'footway';
        const restricted=['no','private','customers'].includes(tags.foot)||(!['yes','designated','permissive'].includes(tags.foot)&&['no','private','customers'].includes(tags.access));
        return {kind:'path',pathType,structure:grade,covered,restricted,...(tags.surface?{surface:text(tags.surface)}:{}),...(tags.level?{level:text(tags.level)}:{})};
    }
    if(['wall','fence','hedge','retaining_wall','kerb'].includes(tags.barrier))return {kind:'boundary',barrier:tags.barrier};
    return null;
}
const featureOf=(element,geometry,properties)=>{
    const name=nameOf(element.tags??{});
    return {type:'Feature',geometry,properties:{...properties,osmRef:`${element.type}/${element.id}`,...(element.sourceDate?{sourceDate:element.sourceDate}:{}),...(name?{name,mapName:mapText(name)}:{})}};
};
export function shapeFeature(element, geometry){
    const tags=element.tags??{};
    if(geometry.type==='LineString'){
        const line=geometry.coordinates;
        if(closedRing(line)&&tags.area!=='no'){
            const props=polygonProperties(tags);
            if(props)return featureOf(element,{type:'Polygon',coordinates:[line]},props);
        }
        const props=linearProperties(tags);
        return props&&line.length>=2?featureOf(element,geometry,props):null;
    }
    const props=polygonProperties(tags);
    return props?featureOf(element,geometry,props):null;
}
function polygonPoint(rings){
    const [w,s,e,n]=bbox(rings[0]);
    const center=[(w+e)/2,(s+n)/2];
    if(insidePolygon(center,rings))return center;
    // A courtyard or irregular footprint can have its bounding-box centre
    // outside the polygon. Choose an interior sample instead.
    for(const [a,b] of [[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.25,.25],[.75,.75]]){
        const p=[w+(e-w)*a,s+(n-s)*b];if(insidePolygon(p,rings))return p;
    }
    return rings[0][0];
}
function pointOf(element,feature){
    if(Number.isFinite(element.lon)&&Number.isFinite(element.lat))return [element.lon,element.lat];
    if(feature&&polygonsOf(feature.geometry).length)return polygonPoint(polygonsOf(feature.geometry)[0]);
    if(Number.isFinite(element.center?.lon)&&Number.isFinite(element.center?.lat))return [element.center.lon,element.center.lat];
    if(feature?.geometry.type==='LineString')return feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length/2)];
    const line=wayCoordinates(element);
    return line.length?(closedRing(line)?polygonPoint([line]):line[Math.floor(line.length/2)]):null;
}
function labelProperties(tags,feature){
    const name=nameOf(tags);
    if(!name)return null;
    const kind=feature?.properties.kind;
    if(['suburb','quarter','neighbourhood','city','town','village'].includes(tags.place))return {labelKind:'district',priority:0,minZoom:12.8};
    if(transit.has(tags.railway)&&!['subway_entrance','train_station_entrance'].includes(tags.railway)||tags.public_transport==='station')return {labelKind:'station',priority:1,minZoom:14};
    if(kind==='green'||kind==='water'||kind==='pitch')return {labelKind:kind,priority:2,minZoom:15};
    if(['hospital','university'].includes(tags.amenity)||tags.building==='hospital'||tags.building==='university')return {labelKind:'landmark',priority:2,minZoom:15};
    if(civic.has(tags.amenity)||tags.shop==='mall'||['attraction','museum','gallery'].includes(tags.tourism)||tags.historic||kind==='deck')return {labelKind:'landmark',priority:3,minZoom:15.8};
    if(tags.healthcare||['clinic','pharmacy','doctors','dentist'].includes(tags.amenity)||tags.shop==='chemist')return {labelKind:'health',priority:4,minZoom:16.7};
    if(['toilets','drinking_water','bench','shelter'].includes(tags.amenity))return {labelKind:'facility',priority:5,minZoom:17.4};
    if(tags.highway==='bus_stop'||tags.public_transport==='platform'||transit.has(tags.railway))return {labelKind:'stop',priority:5,minZoom:17.5};
    if(tags.shop||food.has(tags.amenity)||tags.tourism==='hotel')return {labelKind:food.has(tags.amenity)?'food':'shop',priority:6,minZoom:17.5};
    if(kind==='building'&&!feature.properties.part&&feature.properties.use!=='canopy')return {labelKind:'building',priority:7,minZoom:16.9};
    return null;
}
function pointFeature(element, feature){
    const tags=element.tags??{};
    const props=labelProperties(tags,feature);
    const point=pointOf(element,feature);
    if(!point)return null;
    if(props)return featureOf(element,{type:'Point',coordinates:point},{kind:'label',...props});
    if(element.type==='node'&&tags.natural==='tree')return featureOf(element,{type:'Point',coordinates:point},{kind:'tree'});
    return null;
}
/** Building outlines are retained in 2D, but mapped parts take precedence
 * in 3D. Even a partially described complex must not become an invented solid
 * tower enclosing all its real sections. */
export function resolveBuildingParts(features){
    const parts=features.filter(f=>f.properties.kind==='building'&&f.properties.part);
    const outlines=features.filter(f=>f.properties.kind==='building'&&!f.properties.part);
    const parents=outlines.flatMap(outline=>polygonsOf(outline.geometry).map(polygon=>({outline,polygon,bounds:bbox(polygon[0])})));
    for(const part of parts){
        for(const polygon of polygonsOf(part.geometry)){
            const point=polygonPoint(polygon);
            for(const {outline,polygon:parent,bounds} of parents){
                if(outline.properties.use==='canopy'&&part.properties.use!=='canopy'||outline.properties.use!=='canopy'&&part.properties.use==='canopy')continue;
                if(!withinBounds(point,bounds)||!insidePolygon(point,parent))continue;
                // Avoid suppressing an unrelated tiny building merely because
                // a part's centre overlaps it. Most vertices must be inside
                // or on its bounds (shared boundary vertices are common).
                const samples=polygon[0].slice(0,-1);
                if(!samples.length||samples.filter(p=>withinBounds(p,bounds)&& (insidePolygon(p,parent)||parent[0].some(q=>samePoint(p,q)))).length/samples.length<.55)continue;
                outline.properties.volume=false;
            }
        }
    }
}

export function buildCartography(elements, additionalPolygons=[], additionalStreets=[]){
    const features=[], labels=[], coveredWays=new Map(), ways=new Map(elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
    for(const element of elements){
        if(element.type!=='relation')continue;
        const geometry=relationGeometry(element,ways);
        const feature=geometry&&shapeFeature(element,geometry);
        if(!feature)continue;
        features.push(feature);
        const label=pointFeature(element,feature);if(label)labels.push(label);
        for(const member of element.members??[]){
            const way=ways.get(member.ref);
            if(!way||member.type!=='way')continue;
            const props=polygonProperties(way.tags??{});
            if(props?.kind===feature.properties.kind&&!(props.part&&!feature.properties.part))coveredWays.set(member.ref,feature.properties.kind);
        }
    }
    for(const element of elements){
        const line=element.type==='way'?wayCoordinates(element):[];
        const feature=line.length>=2?shapeFeature(element,{type:'LineString',coordinates:line}):null;
        if(feature&&!(coveredWays.get(element.id)===feature.properties.kind&&feature.geometry.type!=='LineString'))features.push(feature);
        if(element.type==='relation'&&features.some(f=>f.properties.osmRef===`relation/${element.id}`))continue;
        const label=pointFeature(element,feature);if(label)labels.push(label);
    }
    for(const item of additionalPolygons){
        const feature=shapeFeature(item.element,item.geometry);
        if(feature){features.push(feature);const label=pointFeature(item.element,feature);if(label)labels.push(label);}
    }
    for(const street of additionalStreets){
        const props=street.properties??{};
        features.push({...street,properties:{...props,kind:'street',roadClass:props.road==='major'?'collector':'local',structure:'surface',...(props.name?{mapName:mapText(props.name)}:{})}});
    }
    resolveBuildingParts(features);
    // Several archives contain the building and amenity with the same name.
    // Deduplicate nearby labels without dropping repeats on other streets.
    labels.sort((a,b)=>(a.properties.priority??9)-(b.properties.priority??9));
    const seen=new Set();
    for(const label of labels){
        if(label.properties.kind!=='label'){features.push(label);continue;}
        const [x,y]=label.geometry.coordinates;
        const key=`${label.properties.name.toLowerCase()}:${Math.round(x*2500)}:${Math.round(y*2500)}`;
        if(!seen.has(key)){seen.add(key);features.push(label);}
    }
    return features;
}
