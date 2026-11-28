import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { PILOTS } from '../lib/pilots.ts';

export const externalSources = {
    'overture': {name:'Overture Maps Buildings',url:'https://docs.overturemaps.org/guides/buildings/',license:'ODbL-1.0',attribution:'Overture Maps Foundation; © OpenStreetMap contributors'},
    'google-buildings': {name:'Google Open Buildings 2.5D Temporal',url:'https://sites.research.google/gr/open-buildings/temporal/',license:'CC-BY-4.0'},
    'meta-wri-canopy': {name:'Meta / WRI Canopy Height Maps V2',url:'https://registry.opendata.aws/dataforgood-fb-forestsv2/',license:'CC-BY-4.0',attribution:'Meta & WRI (2026); source imagery © 2016 Vantor'},
};
export async function readExternal(area) {
    try { return JSON.parse(gunzipSync(await readFile(new URL(`../data/${area}/source/pedestrian-external.json.gz`,import.meta.url)))); }
    catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function validDate(value){return typeof value==='string'&&/^\d{4}(-\d\d(-\d\d)?)?$/.test(value);}
function localPolygon(geometry,bounds){
    const [s,w,n,e]=bounds;const polys=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
    return polys.length&&polys.every(poly=>poly.length&&poly.every(r=>r.length>=4&&r.length<=50000&&r.every(p=>p.length===2&&p.every(Number.isFinite)&&p[0]>=w-.001&&p[0]<=e+.001&&p[1]>=s-.001&&p[1]<=n+.001)&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]));
}
/** Only generated local clips of these explicitly reusable data products are
 * accepted. No raster download, licensing decision or remote dependency at runtime. */
export function applyExternal(features,area,external){
    if(!external)return [];
    if(external.version!==1||external.area!==area||!Array.isArray(external.sources)||!Array.isArray(external.features)||!Array.isArray(external.heights))throw Error('Invalid pedestrian external import');
    const sources=new Map();
    for(const source of external.sources){
        const expected=externalSources[source.id];
        if(!expected||source.license!==expected.license||!validDate(source.data_at)||!(/^[a-f0-9]{64}$/i.test(source.sha256??'')))throw Error(`Missing reusable source provenance: ${source.id}`);
        sources.set(source.id,{id:source.id,...expected,data_at:source.data_at,sha256:source.sha256,records:0});
    }
    const byRef=new Map(features.filter(f=>f.properties.kind==='building').map(f=>[f.properties.osmRef,f]));
    for(const record of external.heights){
        const f=byRef.get(record.osmRef);const source=sources.get(record.source);
        if(!source||!['google-buildings','overture'].includes(source.id)||!Number.isFinite(record.height)||record.height<1||record.height>(source.id==='google-buildings'?99:800))throw Error('Invalid imported height');
        if(!f||f.properties.heightSource!=='approximate'||f.properties.height>=100||f.properties.use==='canopy'||record.height<=(f.properties.base??0))continue;
        Object.assign(f.properties,{height:record.height,heightSource:source.id==='google-buildings'?'satellite':'overture-height',source:source.name,sourceDate:source.data_at,sourceRef:record.source_ref});source.records++;
    }
    const bounds=PILOTS[area].bounds;
    for(const f of external.features){
        const p=f.properties??{},source=sources.get(p.source);const canopy=source?.id==='meta-wri-canopy';
        if(!source||(!canopy&&source.id!=='overture')||!localPolygon(f.geometry,bounds)||!Number.isFinite(p.height)||!Number.isFinite(p.base)||p.height<1||p.height> (canopy?80:800)||p.base<0||p.base>p.height||(!canopy&&p.base===p.height))throw Error('Invalid imported model geometry');
        features.push({type:'Feature',geometry:f.geometry,properties:{...p,kind:canopy?'vegetation':'building',...(canopy?{modelKind:'tree',modelLabel:'Estimated canopy surface',solarEligible:true}:{use:p.use??'other',part:p.part===true,volume:p.volume!==false}),heightSource:canopy?'satellite':p.heightSource==='approximate'?'approximate':'overture-height',source:source.name,sourceDate:source.data_at}});source.records++;
    }
    return [...sources.values()];
}

/** An explicitly redistributable local survey, not community/user report data.
 * A measured height that names an OSM footprint replaces that model height;
 * unmatched building/crown polygons keep the survey's own source reference. */
export function applySurvey(features,area,survey){
    if(survey.type!=='FeatureCollection'||!Array.isArray(survey.features)||!/^https:\/\//.test(survey.source_url??'')||!['CC-BY-4.0','CC BY 4.0','CC0-1.0','CC0','ODbL','ODbL-1.0'].includes(survey.license)||!validDate(survey.data_at))throw Error('A published building/canopy survey needs a free redistribution license, source URL and observation date.');
    const refs=new Map(features.filter(f=>f.properties.kind==='building').map(f=>[f.properties.osmRef,f]));
    let records=0;
    for(const [index,f] of survey.features.entries()){
        const p=f.properties??{},canopy=p.kind==='canopy',height=Number(p.height_m),base=canopy?height:Number(p.base_m??0);
        if(!['canopy','building'].includes(p.kind)||!localPolygon(f.geometry,PILOTS[area].bounds)||!Number.isFinite(height)||height<1||height>(canopy?80:800)||!Number.isFinite(base)||base<0||base>height||(!canopy&&base===height))throw Error('Invalid reusable survey dimensions');
        const current=!canopy&&p.osm_ref?refs.get(p.osm_ref):undefined;
        const sourceProps={height,base,heightSource:'survey',source:'Published geometry survey',sourceDate:survey.data_at,sourceRef:`${survey.source_url}#${index}`};
        if(current)Object.assign(current.properties,sourceProps);
        else features.push({type:'Feature',geometry:f.geometry,properties:{...sourceProps,kind:canopy?'vegetation':'building',...(canopy?{modelKind:'tree',modelLabel:'Estimated canopy surface',solarEligible:true}:{use:'other',part:false,volume:true})}});
        records++;
    }
    return {id:'survey',name:'Published building and canopy survey',url:survey.source_url,license:survey.license,data_at:survey.data_at,records};
}
