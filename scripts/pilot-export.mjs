import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pointInPilot } from '../lib/pilots.ts';
import { gisLayers } from './pilot-snapshot.mjs';

/** Missing source data leaves KL pending. Corrupt or private data still stops the build. */
export async function loadPagesPilot(path,area='pasar-seni'){
    let contents;
    try{contents=await readFile(path,'utf8');}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
    const bundle=JSON.parse(contents);
    validatePilotSnapshot(bundle,area);
    let supplement;
    try { supplement=JSON.parse(await readFile(resolve(dirname(path),'walking-details.json'),'utf8')); }
    catch(error){if(error.code==='ENOENT')return bundle;throw error;}
    if(supplement.area_id!==area)throw Error('Walking details belong to another area.');
    if(supplement.dataset_id!==bundle.context.dataset_id){
        console.warn(`${area}: imported walking details are for an older graph. Run npm run data:details to rebuild them.`);
        return bundle;
    }
    return attachPilotDetails(bundle,supplement);
}

export function attachPilotDetails(bundle,supplement){
    assert.equal(supplement.dataset_id,bundle.context.dataset_id);
    assert.equal(supplement.area_id,bundle.area_id);
    const {context,entrances}=supplement;
    const {walking_details,transit,demand,demographics,landmarks,environment}=context;
    const paths=new Set(bundle.graph.edges.map(edge=>String(edge.id)));
    const assets=new Set(bundle.walking.assets.map(asset=>asset.id));
    for(const [id,fields] of Object.entries(walking_details.paths)){
        assert.ok(paths.has(id),'Mapped path details reference another dataset.');
        for(const [field,value] of Object.entries(fields)){
            const valid=field==='shade_source'?value==='modelled':
                ['has_tactile','audible_signal'].includes(field)?typeof value==='boolean':
                field==='clear_width_m'?Number.isFinite(value)&&value>=.1&&value<=30:
                ['shade_morning','shade_midday','shade_afternoon'].includes(field)&&Number.isFinite(value)&&value>=0&&value<=1;
            assert.ok(valid,`Invalid mapped path detail: ${field}.`);
        }
    }
    for(const [id,fields] of Object.entries(walking_details.facilities)){
        assert.ok(assets.has(id),'Mapped facility details reference another dataset.');
        for(const [field,value] of Object.entries(fields)){
            const valid=field==='clear_width_m'?Number.isFinite(value)&&value>=.1&&value<=30:
                ['accessible_toilet','water_available','armrests','backrest','step_free'].includes(field)&&typeof value==='boolean';
            assert.ok(valid,`Invalid mapped facility detail: ${field}.`);
        }
    }
    const stationIds = new Set(bundle.walking.assets.filter(asset => asset.kind === 'transit').map(asset => asset.id));
    const supplemental = entrances.filter(asset=>{
        assert.ok(asset.kind==='entrance'&&stationIds.has(asset.parent_id),'An added station entrance requires a mapped parent.');
        return !assets.has(asset.id);
    });
    for (const stop of transit.stops) {
        assert.ok(pointInPilot([stop.lat,stop.lng],bundle.area_id),'A transit stop is outside this pilot.');
        if(stop.walking_asset_id)assert.ok(stationIds.has(stop.walking_asset_id),'A stop references an unknown station.');
        if(stop.approach)assert.ok(paths.has(String(stop.approach.edge_id))
            &&pointInPilot([stop.approach.lat,stop.approach.lng],bundle.area_id)
            &&Number.isFinite(stop.approach.fraction)&&stop.approach.fraction>=0&&stop.approach.fraction<=1
            &&Number.isFinite(stop.approach.distance_m)&&stop.approach.distance_m>=0&&stop.approach.distance_m<=8,
        'An approximate transit approach needs a nearby mapped footpath.');
    }
    const sources=[...new Map([...bundle.context.sources,...context.sources].map(source=>[source.id,source])).values()];
    const coverage={...bundle.context.coverage,entrances:bundle.context.coverage.entrances+supplemental.length,
        unconnected_places:bundle.context.coverage.unconnected_places+supplemental.filter(asset=>asset.edge_id===null).length};
    const enriched={...bundle,supplemental_assets:supplemental,
        walking:{...bundle.walking,assets:[...bundle.walking.assets,...supplemental]},
        context:{...bundle.context,walking_details,transit,demand,demographics,landmarks,environment,sources,coverage}};
    validatePilotSnapshot(enriched,bundle.area_id);
    return enriched;
}

export function pagesPilotMetadata(kl,um){
    const areas=[...(kl?['pasar-seni']:[]),...(um?['um-campus']:[]),'elmina'];
    return {areas,default_area:areas[0],
        pilot_status:{'pasar-seni':kl?'available':'awaiting-source-data','um-campus':um?'available':'awaiting-source-data',elmina:'available'}};
}

/** Fail before a source build could publish private records or a mismatched graph. */
export function validatePilotSnapshot(bundle,area=bundle.area_id){
    assert.ok(['pasar-seni','um-campus'].includes(bundle.area_id),'Unknown source pilot.');
    assert.equal(bundle.area_id,area,'Source bundle belongs to another pilot.');
    const {graph,walking,context}=bundle;
    assert.ok(graph.nodes.length&&graph.edges.length,'The pilot needs a real pedestrian network.');
    assert.equal(graph.source.area_id,bundle.area_id);
    assert.equal(walking.area_id,bundle.area_id);
    assert.equal(context.area_id,bundle.area_id);
    assert.equal(context.dataset_id,graph.source.dataset_id);
    assert.equal(context.dataset_id,walking.dataset_id);
    const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
    assert.equal(nodes.size,graph.nodes.length,'Duplicate source node.');
    const edges=new Map(graph.edges.map(e=>[e.id,e]));
    assert.equal(edges.size,graph.edges.length,'Duplicate source edge.');
    for(const n of nodes.values())assert.ok(Number.isSafeInteger(n.id)&&Number.isFinite(n.lat)&&Number.isFinite(n.lng));
    for(const e of edges.values()){
        assert.ok(e.pedestrian_access===true&&e.kind!=='street','Road carriageways must not become walking routes.');
        assert.ok(nodes.has(e.from_node)&&nodes.has(e.to_node)&&e.length_m>0);
        assert.ok(e.geometry.length>=2&&e.geometry.every(p=>p.length===2&&p.every(Number.isFinite)));
    }
    const assets=new Map(walking.assets.map(a=>[a.id,a]));
    assert.equal(assets.size,walking.assets.length);
    for(const a of assets.values()){
        assert.ok(pointInPilot([a.lat,a.lng],bundle.area_id),'A place is outside the pilot.');
        assert.ok(a.source==='osm'&&/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(a.source_ref),'Every place needs its original OSM reference.');
        assert.ok(a.edge_id===null||edges.has(a.edge_id),'A place references another graph.');
        assert.ok(a.parent_id===null||assets.has(a.parent_id),'Missing parent destination.');
    }
    assert.deepEqual(walking.verifications,[],'Never publish local field-auditor records.');
    assert.deepEqual(bundle.hazards.hazards,[],'Never publish local reports in a source snapshot.');
    assert.deepEqual(bundle.reports.reports,[],'Never publish local reports in a source snapshot.');
    assert.ok(context.featured_ids.length&&context.featured_ids.every(id=>assets.has(id)),'The pilot needs connected featured places.');
    assert.ok(pointInPilot(context.origin.coordinates,bundle.area_id));
    assert.ok(context.sources.some(s=>['osm','geofabrik'].includes(s.id)&&s.status==='loaded'),'The walking source must be loaded.');
}

export async function writePublicSnapshot(directory,snapshot){
    await mkdir(directory,{recursive:true});
    for(const [name,value] of Object.entries({graph:snapshot.graph,'walking-data':snapshot.walking,hazards:snapshot.hazards,reports:snapshot.reports,context:snapshot.context})){
        await writeFile(resolve(directory,`${name}.json`),JSON.stringify(value));
    }
}

export async function writePublicPilot(directory,bundle){
    validatePilotSnapshot(bundle);
    await writePublicSnapshot(directory,bundle);
    const gis=resolve(directory,'gis');await mkdir(gis,{recursive:true});
    for(const [name,layer]of Object.entries(gisLayers(bundle)))await writeFile(resolve(gis,`${name}.geojson`),JSON.stringify(layer));
}
