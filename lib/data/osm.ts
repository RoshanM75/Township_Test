import { createHash } from 'node:crypto';
import { metres, pointAt, projectPoint } from '../walking-geometry.ts';
import type { PathEdge, PathNode } from '../routing.ts';
import type { WalkingAsset, ObservationValue, PlaceCategory } from '../walking.ts';
import type { PilotId, PilotContext } from '../pilots.ts';
import { KL_CORE_BOUNDS, PILOTS, pointInBounds } from '../pilots.ts';

export interface OsmElement { type: 'node'|'way'|'relation'; id: number; lat?: number; lon?: number; nodes?: number[];
    geometry?: Array<{lat:number;lon:number}>; center?:{lat:number;lon:number}; tags?:Record<string,string>;
    members?:Array<{type:string;ref:number;geometry?:Array<{lat:number;lon:number}>}> }
export interface OsmSource { elements: OsmElement[]; osm3s?: { timestamp_osm_base?: string } }
export function sourceId(area: PilotId, key: string, offset = PILOTS[area].asset_offset) {
    return String(offset + parseInt(createHash('sha256').update(`${area}:${key}`).digest('hex').slice(0,11),16));
}

export function preparePilotGraph(graph: {nodes:PathNode[];edges:PathEdge[]}, raw: OsmSource, area: PilotId) {
    const tags=new Map(raw.elements.filter(e=>e.type==='way').map(e=>[String(e.id),e.tags??{}]));
    const seen=new Set<number>();
    const edges=graph.edges.map(edge=>{
        const way=(edge as PathEdge&{osm_way_id:number}).osm_way_id;
        const t=tags.get(String(way))??{};
        const id=area==='elmina'?edge.id:Number(sourceId(area,`way:${way}:${edge.from_node}:${edge.to_node}`,PILOTS[area].edge_offset));
        if(seen.has(id))throw new Error('Duplicate path identity; review the OSM segmentation before importing.');seen.add(id);
        const direction=t['oneway:foot']==='-1'||t.conveying==='backward'?'backward':t['oneway:foot']==='yes'||t.conveying==='forward'?'forward':'both';
        const covered = t.covered === 'no' ? false : t.covered === 'yes' || (area === 'um-campus' && t.tunnel === 'building_passage') ? true : null;
        return {...edge,id,covered,foot_direction:direction as 'both'|'forward'|'backward',
            source_ref:`https://www.openstreetmap.org/way/${way}`,level:t.level??'',layer:t.layer??'',bridge:t.bridge??'',tunnel:t.tunnel??''};
    });
    return {nodes:graph.nodes,edges};
}

export function representative(element: OsmElement): [number,number]|null {
    if(Number.isFinite(element.lat)&&Number.isFinite(element.lon))return [element.lat!,element.lon!];
    if(element.center&&Number.isFinite(element.center.lat)&&Number.isFinite(element.center.lon))return [element.center.lat,element.center.lon];
    const points=element.geometry??element.members?.flatMap(m=>m.geometry??[])??[];
    if(!points.length)return null;
    return [points.reduce((s,p)=>s+p.lat,0)/points.length,points.reduce((s,p)=>s+p.lon,0)/points.length];
}
function contains(line: Array<{lat:number;lon:number}>, p:[number,number]) {
    let inside=false;
    for(let i=0,j=line.length-1;i<line.length;j=i++){
        const a=line[i],b=line[j];if((a.lat>p[0])!==(b.lat>p[0])&&p[1]<(b.lon-a.lon)*(p[0]-a.lat)/(b.lat-a.lat)+a.lon)inside=!inside;
    }
    return inside;
}
function classification(t:Record<string,string>,area:PilotId): {kind:WalkingAsset['kind'];category:PlaceCategory;fallback:string}|null {
    if(t.entrance&&t.entrance!=='no')return null; // Associated with their actual place below.
    if(t.amenity==='bench')return {kind:'rest',category:'other',fallback:'Mapped seat'};
    if(t.amenity==='toilets')return {kind:'toilet',category:'other',fallback:'Mapped toilet'};
    if(t.amenity==='drinking_water')return {kind:'water',category:'other',fallback:'Mapped drinking water'};
    if(t.amenity==='shelter')return {kind:'shelter',category:'other',fallback:'Mapped shelter'};
    if(t.public_transport==='station'||t.railway==='station'||t.railway==='halt')return {kind:'transit',category:'transport',fallback:'Mapped station'};
    if(['clinic','hospital','pharmacy','doctors','dentist'].includes(t.amenity)||t.healthcare==='yes')return {kind:'destination',category:'healthcare',fallback:'Mapped healthcare'};
    if(['cafe','restaurant','fast_food','food_court','marketplace'].includes(t.amenity))return {kind:'destination',category:t.amenity==='marketplace'?'shopping':'food',fallback:'Mapped food place'};
    if(t.shop)return {kind:'destination',category:'shopping',fallback:'Mapped shop'};
    if(t.leisure==='park'||t.leisure==='garden')return {kind:'destination',category:'park',fallback:'Mapped park'};
    if(area==='um-campus' && (t.building||t.amenity==='college'||t.amenity==='university'||t.leisure==='sports_centre'))return {kind:'destination',category:'community',fallback:'Mapped campus place'};
    if(t.amenity==='community_centre'||t.amenity==='library'||t.amenity==='place_of_worship'||t.tourism||t.historic||t.place==='square')return {kind:'destination',category:'community',fallback:'Mapped place'};
    return null;
}

/** Spatial joins create labelled approaches. They never certify physical access. */
export function mappedAssets(raw:OsmSource, edges:PathEdge[], area:PilotId,
    bounds = area === 'pasar-seni' ? KL_CORE_BOUNDS : PILOTS[area].bounds) {
    const assets:WalkingAsset[]=[];const used=new Set<string>();
    const entranceElements=raw.elements.filter(e=>e.type==='node'&&e.tags?.entrance&&e.tags.entrance!=='no');
    const buildings=raw.elements.filter(e=>e.type==='way'&&e.tags?.building&&e.geometry&&e.nodes);
    const searchable = edges.filter(edge => edge.pedestrian_access !== false && edge.kind !== 'street').map(edge => {
        const lats = edge.geometry.map(p => p[1]), lngs = edge.geometry.map(p => p[0]);
        return { edge, bounds: [Math.min(...lats) - .001, Math.min(...lngs) - .001, Math.max(...lats) + .001, Math.max(...lngs) + .001] };
    });
    const nearest = (p: [number, number], level?: string) => searchable
        .filter(item => {
            const edgeLevel = (item.edge as PathEdge & {level?: string}).level;
            return pointInBounds(p, item.bounds) && (!level || !edgeLevel || edgeLevel === level);
        }).map(({edge}) => ({edge, ...projectPoint(edge.geometry, [p[1], p[0]])})).sort((a, b) => a.distance - b.distance)[0];
    const make=(element:OsmElement,p:[number,number],kind:WalkingAsset['kind'],category:PlaceCategory,name:string,key:string,parent:string|null=null):WalkingAsset=>{
        const t=element.tags??{},near=nearest(p,t.level),joined=near&&near.distance<=30?near:null;
        const properties:Record<string,ObservationValue>={osm_type:element.type,osm_id:String(element.id),...(t.opening_hours?{opening_hours:t.opening_hours}:{}),
            ...(t.name?{osm_name:t.name}:{}),...(t['name:ms']?{name_ms:t['name:ms']}:{}),...(t['name:en']?{name_en:t['name:en']}:{}),...(t.ref?{station_ref:t.ref}:{}),
            ...(t.tourism?{tourism_type:t.tourism}:{}),
            ...(t.wikidata?{wikidata:t.wikidata}:{}),...(t.wikipedia?{wikipedia:t.wikipedia}:{}),...(t.website?{website:t.website}:{}),
            ...(t.wheelchair?{osm_wheelchair:t.wheelchair}:{}),...(kind==='rest'?{has_seat:true}:{}),...(t.covered?{osm_covered:t.covered}:{}),
            ...(t.level?{osm_level:t.level}:{}), ...(t.amenity ? {osm_amenity:t.amenity}:{}), ...(t.shop?{osm_shop:t.shop}:{}),
            ...(['yes','public','permissive'].includes(t.access)?{public_access:'public'}:t.access==='customers'?{public_access:'customers'}:t.access==='destination'?{public_access:'destination'}:t.access==='permit'?{public_access:'permission'}:{}),
            ...(t.fee==='yes'||t.fee==='no'?{fee:t.fee==='yes'}:{}),connection_model:joined?'nearest_mapped_path':'unconnected'};
        return {id:sourceId(area,key),external_id:`${area}:${key}`,parent_id:parent,kind,category,name,lat:p[0],lng:p[1],source:'osm',
            source_ref:`https://www.openstreetmap.org/${element.type}/${element.id}`,properties,edge_id:joined?.edge.id??null,edge_fraction:joined?.fraction??null,
            connection_distance_m:joined?.distance??null,anchor_lat:joined?.point[1]??null,anchor_lng:joined?.point[0]??null};
    };
    for(const element of raw.elements){
        const t=element.tags??{},classificationResult=classification(t,area),p=representative(element);
        if(!classificationResult||!p||!pointInBounds(p,bounds)||['no','private'].includes(t.access))continue;
        if(!t.name&&!t['name:en']&&classificationResult.kind==='destination'&&!t.shop)continue;
        const {kind,category,fallback}=classificationResult,key=`osm:${element.type}:${element.id}`;
        if(used.has(key))continue;used.add(key);
        const name=t['name:en']||t.name||fallback;
        const place=make(element,p,kind,category,kind==='transit'&&t.ref&&!name.includes(t.ref)?`${name} · ${t.ref}`:name,key);
        if(kind==='destination'||kind==='transit'){
            place.edge_id=null;place.edge_fraction=null;place.connection_distance_m=null;place.anchor_lat=null;place.anchor_lng=null;
            const containing=element.nodes?element:buildings.find(b=>contains(b.geometry!,p));
            let doors=entranceElements.filter(e=>containing?.nodes?.includes(e.id)&&!['no','private'].includes(e.tags?.access??''));
            if(kind==='transit'){
                // A nearby metro entrance may serve a different station or paid concourse.
                // Accept only an explicit common OSM stop_area, never proximity alone.
                const stopAreas=raw.elements.filter(r=>r.type==='relation'&&r.tags?.public_transport==='stop_area'&&r.members?.some(m=>m.type===element.type&&m.ref===element.id));
                const subways=raw.elements.filter(e=>e.type==='node'&&e.tags?.railway==='subway_entrance'&&Number.isFinite(e.lat)&&Number.isFinite(e.lon)
                    &&!['no','private'].includes(e.tags.access??'')&&stopAreas.some(r=>r.members?.some(m=>m.type==='node'&&m.ref===e.id)));
                doors=[...doors,...subways.filter(e=>!doors.some(d=>d.id===e.id))];
            }
            assets.push(place);
            if(doors.length){for(const door of doors){const position=representative(door);if(!position||!pointInBounds(position,PILOTS[area].bounds))continue;const access=make(door,position,'entrance',category,`${place.name} · ${door.tags?.ref||door.tags?.name||'mapped entrance'}`,`${key}:door:${door.id}`,place.id);
                if(!door.tags?.opening_hours&&t.opening_hours){access.properties.opening_hours=t.opening_hours;access.properties.opening_hours_source=place.source_ref;}
                access.properties.connection_model='mapped_entrance';assets.push(access);}}
            else { const access=make(element,p,'entrance',category,`${place.name} · approximate approach`,`${key}:approach`,place.id);
                access.properties.connection_model='approximate_approach';assets.push(access); }
        } else assets.push(place);
    }
    const ids=new Set<string>();for(const asset of assets){if(ids.has(asset.id))throw new Error('Duplicate place identity.');ids.add(asset.id);}
    return assets;
}

export function networkCoverage(nodes:PathNode[],edges:PathEdge[],assets:WalkingAsset[]) {
    const adjacency=new Map<number,number[]>();
    for(const e of edges){for(const [a,b]of[[e.from_node,e.to_node],[e.to_node,e.from_node]]){if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a)!.push(b);}}
    const component=new Map<number,number>();let count=0;
    for(const n of nodes){if(component.has(n.id))continue;count++;const queue=[n.id];component.set(n.id,count);for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i])??[])if(!component.has(next)){component.set(next,count);queue.push(next);}}
    const sizes=new Map<number,number>(),lengths=new Map<number,number>();for(const e of edges){const key=component.get(e.from_node)!;sizes.set(key,(sizes.get(key)??0)+1);lengths.set(key,(lengths.get(key)??0)+e.length_m);}
    const largest=[...sizes].sort((a,b)=>b[1]-a[1]||(lengths.get(b[0])??0)-(lengths.get(a[0])??0))[0];
    const coverage:PilotContext['coverage']={nodes:nodes.length,paths:edges.length,crossings:edges.filter(e=>e.is_crossing).length,components:count,largest_component_paths:largest?.[1]??0,
        destinations:assets.filter(a=>a.kind==='destination'||a.kind==='transit').length,facilities:assets.filter(a=>['rest','water','toilet','shelter'].includes(a.kind)).length,
        entrances:assets.filter(a=>a.kind==='entrance'&&a.properties.connection_model==='mapped_entrance').length,
        approximate_approaches:assets.filter(a=>a.kind==='entrance'&&a.properties.connection_model==='approximate_approach').length,
        unconnected_places:assets.filter(a=>a.kind!=='destination'&&a.kind!=='transit'&&a.edge_id===null).length};
    return {coverage,component,largest:largest?.[0]};
}

export function pilotOrigin(nodes:PathNode[],edges:PathEdge[],area:PilotId) {
    const {component,largest}=networkCoverage(nodes,edges,[]),centre=PILOTS[area].centre;
    const nearest=nodes.filter(n=>component.get(n.id)===largest).sort((a,b)=>metres([a.lng,a.lat],[centre[1],centre[0]])-metres([b.lng,b.lat],[centre[1],centre[0]]))[0];
    if(!nearest)throw new Error('The pilot has no connected pedestrian graph.');
    return {coordinates:[nearest.lat,nearest.lng] as [number,number],label:PILOTS[area].origin_label,source_ref:`https://www.openstreetmap.org/node/${nearest.id}`};
}

export function lineGeometry(element:OsmElement) { return (element.geometry??[]).map(p=>[p.lon,p.lat] as [number,number]); }
export function linePoint(element:OsmElement) { const line=lineGeometry(element);return line.length?pointAt(line,.5):null; }
