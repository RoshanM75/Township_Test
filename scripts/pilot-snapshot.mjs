import { createHash } from 'node:crypto';
import { PILOTS } from '../lib/pilots.ts';
import { mappedAssets,preparePilotGraph,networkCoverage,pilotOrigin } from '../lib/data/osm.ts';
import { transitContext,railDemand,districtPopulation,wikidataLandmarks,satelliteScenes } from '../lib/data/context.ts';
import { placeSearchText } from '../lib/walking.ts';

export function createPilotSnapshot(rawGraph,osm,inputs={},now=new Date().toISOString(),area='pasar-seni'){
    const graph=preparePilotGraph(rawGraph,osm,area);
    graph.nodes.sort((a,b)=>a.id-b.id);graph.edges.sort((a,b)=>a.id-b.id);
    const assets=mappedAssets(osm,graph.edges,area).sort((a,b)=>Number(a.parent_id!==null)-Number(b.parent_id!==null)||Number(a.id)-Number(b.id));
    const origin=pilotOrigin(graph.nodes,graph.edges,area),{coverage,component,largest}=networkCoverage(graph.nodes,graph.edges,assets);
    const destinations=assets.filter(a=>a.kind==='destination'||a.kind==='transit');
    const connected=destinations.filter(a=>assets.some(e=>e.parent_id===a.id&&e.edge_id!==null&&component.get(graph.edges.find(p=>p.id===e.edge_id)?.from_node)===largest));
    const selected=[];
    // Give each pilot landmark a turn before businesses whose names mention it.
    for(const preferred of PILOTS[area].preferred_names){
        const key=preferred.toLowerCase(),matches=connected.filter(a=>placeSearchText(a).includes(key));
        const quality=a=>[a.name,a.properties.osm_name,a.properties.name_en,a.properties.name_ms].some(n=>typeof n==='string'&&n.toLowerCase()===key)?0:1;
        matches.sort((a,b)=>quality(a)-quality(b)||a.name.length-b.name.length||a.name.localeCompare(b.name));
        const best=matches.find(a=>!selected.includes(a.id));if(best)selected.push(best.id);
    }
    const cultural=a=>a.kind==='transit'||a.category==='park'||['attraction','museum','gallery'].includes(String(a.properties.tourism_type));
    const featured=[...selected,...connected.filter(a=>!selected.includes(a.id)).sort((a,b)=>Number(cultural(b))-Number(cultural(a))||a.name.localeCompare(b.name)).map(a=>a.id)].slice(0,8);
    const id=createHash('sha256').update(JSON.stringify({nodes:graph.nodes,edges:graph.edges,assets})).digest('hex');
    const transit={stops:[],routes:[],service_dates:[],calendars:{}};
    for(const [agency,files]of Object.entries(inputs.gtfs??{})){const part=transitContext(files,agency,area);transit.stops.push(...part.stops);transit.routes.push(...part.routes);transit.service_dates.push(...part.service_dates);Object.assign(transit.calendars,part.calendars);}
    const context={area_id:area,dataset_id:id,built_at:now,origin,featured_ids:featured,coverage,sources:inputs.sources??[],transit,
        demand:railDemand(inputs.ridership??[],transit.stops.map(s=>s.name)),demographics:districtPopulation(inputs.population??[],area),landmarks:wikidataLandmarks(inputs.wikidata??{},area),
        environment:{scenes:satelliteScenes(inputs.satellite??{},area),note:'Satellite scenes and land-cover products provide environmental context at their published resolution. They do not verify footpath shade, heat, kerbs or working lights.'}};
    return {area_id:area,graph:{...graph,source:{name:'OpenStreetMap',pedestrian_only:true,attribution:'© OpenStreetMap contributors (ODbL)',snapshot_at:osm.osm3s?.timestamp_osm_base??inputs.osm_date??null,area_id:area,dataset_id:id,origin,featured_ids:featured}},
        walking:{assets,verifications:[],as_of:now,area_id:area,dataset_id:id},hazards:{hazards:[]},reports:{reports:[]},context};
}

export function gisLayers(bundle){
    const feature=(geometry,properties)=>({type:'Feature',geometry,properties});
    const collection=features=>({type:'FeatureCollection',features});
    const {component}=networkCoverage(bundle.graph.nodes,bundle.graph.edges,bundle.walking.assets);
    return {
        paths:collection(bundle.graph.edges.map(e=>feature({type:'LineString',coordinates:e.geometry},{id:e.id,osm_way_id:e.osm_way_id,name:e.name,kind:e.kind,component:component.get(e.from_node),length_m:e.length_m,covered:e.covered,level:e.level,layer:e.layer,foot_direction:e.foot_direction,
            ...bundle.context.walking_details?.paths[e.id],evidence:'mapped or modelled; field checks separate'}))),
        places:collection(bundle.walking.assets.map(a=>feature({type:'Point',coordinates:[a.lng,a.lat]},{id:a.id,external_id:a.external_id,name:a.name,kind:a.kind,parent_id:a.parent_id,edge_id:a.edge_id,connection_m:a.connection_distance_m,connection_model:a.properties.connection_model,source_ref:a.source_ref,
            ...bundle.context.walking_details?.facilities[a.id],evidence:'mapped; field checks separate'}))),
        transit:collection(bundle.context.transit.stops.map(({patterns, approach, ...s})=>feature({type:'Point',coordinates:[s.lng,s.lat]},
            {...s,routes:s.routes.join(';'),schedule_patterns:patterns?.length??0,approach_edge_id:approach?.edge_id??null,approach_distance_m:approach?.distance_m??null,entrance_checked:false}))),
        satellite:collection(bundle.context.environment.scenes.map(s=>feature({type:'Polygon',coordinates:[[[s.bbox[0],s.bbox[1]],[s.bbox[2],s.bbox[1]],[s.bbox[2],s.bbox[3]],[s.bbox[0],s.bbox[3]],[s.bbox[0],s.bbox[1]]]]},{id:s.id,date:s.date,collection:s.collection,cloud_percent:s.cloud_percent,evidence:'scene footprint; not measured footpath shade'}))),
    };
}
