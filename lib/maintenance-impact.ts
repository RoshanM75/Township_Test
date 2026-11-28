import { buildGraph, evaluateEdge, indexHazards, PROFILES, slotForHour, type PathNode, type PathEdge, type HazardReport, type Profile } from './routing.ts';
import type { WalkingData, WalkingAsset, PlanningInput, VerificationRecord, ObservationValue } from './walking.ts';
import { DEFAULT_NEEDS } from './walking.ts';
import { splitPathAnchors, type PathAnchor } from './path-anchors.ts';
import { corridorRing,crownRing } from './pedestrian-geometry.ts';
import { solarModel,type ShadeDataset } from './solar-shade.ts';
import { pathShade,groupShadeChecks } from './route-shade.ts';
import { projectPoint,pointAt,metres } from './walking-geometry.ts';
import { assetFacts, edgeRestrictions, observedEdge, usableAccess } from './route-conditions.ts';
import { openingAt, malaysiaHour } from './verification.ts';
import { placeHours } from './place-details.ts';
import { unavailableAssetIds } from './report-status.ts';
import type { MaintenanceDefect } from './types.ts';

export interface RepairScenario {
    id: string;
    name: string;
    target: 'edge' | 'asset' | 'connection';
    target_id: string;
    field: string;
    value: ObservationValue;
    kind: 'blocked'|'no_ramp'|'lift_out'|'broken_surface'|'steps'|'roof_cover'|'tree_canopy'|'rest_seat'|'new_connection';
    source: 'checked report' | 'mapped condition' | 'hypothetical design';
    proposal?: { width_m?:number;height_m?:number;diameter_m?:number;from_node?:number;to_node?:number };
}
export interface ImpactRequest { origin: [number,number]; departure_at: string; profile: 'everyday'|'wheelchair'; minutes: number; scenarios: RepairScenario[] }

export function repairCandidates(edges: PathEdge[], data: WalkingData, reports: MaintenanceDefect[]): RepairScenario[] {
    const edgeMap=new Map(edges.map(e=>[e.id,e])), assets=new Map(data.assets.map(a=>[a.id,a]));
    const found=new Map<string,RepairScenario>();
    const add=(s:RepairScenario)=>{const key=s.target+':'+s.target_id+':'+s.field;if(!found.has(key))found.set(key,s);};
    for (const report of reports.filter(r=>r.checked_at && r.status!=='fixed' && !r.dismissed_at)) {
        const asset=report.asset_id?assets.get(report.asset_id):undefined;
        const edge=report.edge_id!=null?edgeMap.get(report.edge_id):undefined;
        if ((!asset && !edge) || !['blocked','no_ramp','lift_out','broken_surface'].includes(report.kind??'')) continue;
        const kind=report.kind as RepairScenario['kind'];
        const field = kind==='blocked' ? asset?'available':'path_open' : kind==='lift_out'?'lift_available':kind==='no_ramp'?asset?'step_free':'has_kerb_ramp':'surface_rating';
        if (kind==='lift_out'&&!asset) continue;
        if (kind==='broken_surface'&&asset) continue;
        add({id:`case:${report.id}`,name:report.location_name??asset?.name??edge?.name??'Mapped target',target:asset?'asset':'edge',target_id:asset?.id??String(edge!.id),field,
            value:kind==='broken_surface'?1:true,kind,source:'checked report'});
    }
    for (const raw of edges) {
        const edge=observedEdge(raw,data.verifications,data.as_of);
        if (edge.is_crossing && edge.has_kerb_ramp===false) add({id:`ramp:${edge.id}`,name:edge.name||`Crossing ${edge.id}`,target:'edge',target_id:String(edge.id),field:'has_kerb_ramp',value:true,kind:'no_ramp',source:'mapped condition'});
        if (edge.has_steps) add({id:`steps:${edge.id}`,name:edge.name||`Steps ${edge.id}`,target:'edge',target_id:String(edge.id),field:'has_steps',value:false,kind:'steps',source:'mapped condition'});
    }
    return [...found.values()];
}

export type InfrastructureProposal='roof_cover'|'tree_canopy'|'rest_seat';
export function infrastructureCandidates(edges:PathEdge[],kind:InfrastructureProposal):RepairScenario[]{
    return edges.filter(e=>e.pedestrian_access!==false&&e.kind!=='street'&&!e.is_crossing&&!e.has_steps&&e.geometry.length>=2&&e.length_m>=2&&
        (!e.world||e.world.levelGroups.includes('ground'))&&(kind!=='roof_cover'||e.covered!==true)).map(edge=>({
        id:`${kind}:${edge.id}`,name:edge.name||`Footpath ${edge.id}`,target:'edge',target_id:String(edge.id),field:kind,value:true,kind,source:'hypothetical design',
        ...(kind==='roof_cover'?{proposal:{width_m:Math.min(6,Math.max(1,edge.clear_width_m??2.5)),height_m:3}}:kind==='tree_canopy'?{proposal:{diameter_m:6,height_m:8}}:{})
    }));
}
export function connectionScenario(from:PathNode,to:PathNode):RepairScenario|null{
    const distance=metres([from.lng,from.lat],[to.lng,to.lat]);
    if(from.id===to.id||!Number.isFinite(distance)||distance<1||distance>500)return null;
    return {id:`connection:${from.id}:${to.id}`,name:`New pedestrian link · ${Math.round(distance)} m`,target:'connection',target_id:`${from.id}:${to.id}`,
        field:'new_connection',value:true,kind:'new_connection',source:'hypothetical design',proposal:{from_node:from.id,to_node:to.id,width_m:1.8}};
}
export interface CatchmentMetrics { full_path_m:number;roof_m:number;shade_m:number;unknown_shade_m:number;rest_places:number }

class Queue {
    private list: Array<[number,number]>=[];
    push(item:[number,number]){const a=this.list;a.push(item);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=a[i][0])break;[a[i],a[p]]=[a[p],a[i]];i=p;}}
    pop(){const a=this.list;if(!a.length)return undefined;const first=a[0],last=a.pop()!;if(a.length){a[0]=last;let i=0;for(;;){const l=i*2+1,r=l+1;let m=i;if(l<a.length&&a[l][0]<a[m][0])m=l;if(r<a.length&&a[r][0]<a[m][0])m=r;if(m===i)break;[a[i],a[m]]=[a[m],a[i]];i=m;}}return first;}
}

/** A bounded, directed walking-network catchment. Measures reachable mapped
 * destinations, not population, real users, or a new safety certification. */
function detailedCatchment(nodes:PathNode[],raw:PathEdge[],data:WalkingData,hazards:HazardReport[],request:Omit<ImpactRequest,'scenarios'>,shade?:ShadeDataset) {
    const at=request.departure_at,profile:Profile=request.profile,speed=PROFILES[profile].speed_mps;
    const needs={...DEFAULT_NEEDS, max_slope_pct:profile==='wheelchair'?8.33:20, step_free:profile==='wheelchair', budget_min:request.minutes};
    const input:Pick<PlanningInput,'profile'|'needs'|'departure_at'>={profile,needs,departure_at:at};
    const limit=request.minutes*60;
    const edges=raw.filter(e=>e.kind!=='street'&&e.pedestrian_access!==false&&e.geometry.length>=2).map(edge=>observedEdge(edge,data.verifications,at));
    const closest=edges.map(edge=>({edge,...projectPoint(edge.geometry,[request.origin[1],request.origin[0]])})).sort((a,b)=>a.distance-b.distance)[0];
    if(!closest || closest.distance>50)return null;
    if(!Number.isFinite(limit)||limit<=0)return null;
    const anchors:PathAnchor[]=[{key:'start',edge_id:closest.edge.id,fraction:closest.fraction}];
    for(const a of data.assets)if(a.edge_id!==null&&a.edge_fraction!==null)anchors.push({key:a.id,edge_id:a.edge_id,fraction:a.edge_fraction});
    const split=splitPathAnchors(nodes,edges,anchors),graph=buildGraph(split.nodes,split.edges);
    const indexed=indexHazards(hazards);
    const allowed=new Set(edges.filter(edge=>!edgeRestrictions(edge,input,data.verifications,'direct',indexed.get(edge.id)??[]).length).map(e=>e.id));
    const ctx={profile,mode:'direct' as const,slot:slotForHour(malaysiaHour(at)),hazards:indexed,speedMps:speed};
    const start=split.anchors.get('start')!;
    const distance=new Map<number,number>([[start,closest.distance/speed]]),queue=new Queue();queue.push([closest.distance/speed,start]);
    const cost=new Map<number,number>();
    for(let next=queue.pop();next;next=queue.pop()){
        const [seconds,node]=next;if(seconds!==distance.get(node)||seconds>limit)continue;
        for(const {edge,to} of graph.adj.get(node)??[]){
            if(!allowed.has(edge.source_edge_id!))continue;
            let duration=cost.get(edge.id);
            if(duration===undefined){const ev=evaluateEdge(edge,ctx);duration=ev.hard.length?Infinity:ev.walk_s+ev.wait_s;cost.set(edge.id,duration);}
            const value=seconds+duration;
            const hours=edge.path_opening_hours??edge.world?.openingHours;
            if(hours&&Number.isFinite(value)&&(openingAt(hours,new Date(Date.parse(at)+seconds*1000).toISOString())===false||openingAt(hours,new Date(Date.parse(at)+value*1000).toISOString())===false))continue;
            if(value<=limit&&value<(distance.get(to)??Infinity)){distance.set(to,value);queue.push([value,to]);}
        }
    }
    const unavailable=unavailableAssetIds(hazards,needs.step_free), assets=new Map(data.assets.map(a=>[a.id,a]));
    const destinations=new Map<string,{id:string;name:string;kind:WalkingAsset['kind'];minutes:number}>();
    for(const entrance of data.assets){
        // For buildings and rail stations, evaluate their actual access points,
        // never count the place centroid as a second entrance.
        if(entrance.kind==='destination'||entrance.kind==='transit')continue;
        const node=split.anchors.get(entrance.id);
        if(node===undefined||unavailable.has(entrance.id))continue;
        const place=entrance.kind==='entrance'?assets.get(entrance.parent_id??''):entrance;
        if(!place||!['destination','transit','toilet','rest','water','shelter'].includes(place.kind)||unavailable.has(place.id))continue;
        const edge=entrance.edge_id===null?undefined:allowed.has(entrance.edge_id);
        if(!edge)continue;
        const facts=assetFacts(entrance,data,at);
        const connection=typeof facts.values.connection_length_m==='number'?Math.max(entrance.connection_distance_m??0,facts.values.connection_length_m):entrance.connection_distance_m??0;
        const seconds=(distance.get(node)??Infinity)+connection/speed;
        if(seconds>limit||!usableAccess(entrance,facts,input))continue;
        const arrival=new Date(Date.parse(at)+seconds*1000).toISOString();
        const placeFacts=assetFacts(place,data,arrival);
        if (placeFacts.values.available===false||['private','permission'].includes(String(placeFacts.values.public_access))||
            openingAt(facts.values.opening_hours,arrival)===false||placeHours(place,arrival,data.verifications).open===false)continue;
        const previous=destinations.get(place.id);
        if(!previous||seconds/60<previous.minutes)destinations.set(place.id,{id:place.id,name:place.name,kind:place.kind,minutes:seconds/60});
    }
    const metrics:CatchmentMetrics={full_path_m:0,roof_m:0,shade_m:0,unknown_shade_m:0,rest_places:[...destinations.values()].filter(a=>a.kind==='rest').length};
    const model=shade&&solarModel(shade),checks=groupShadeChecks(data.verifications),originals=new Map(raw.map(e=>[e.id,e]));
    for(const edge of graph.edges.values()){
        if(!allowed.has(edge.source_edge_id!))continue;
        let duration=cost.get(edge.id);
        if(duration===undefined){const ev=evaluateEdge(edge,ctx);duration=ev.hard.length?Infinity:ev.walk_s+ev.wait_s;}
        const entry=Math.min(edge.foot_direction!=='backward'?distance.get(edge.from_node)??Infinity:Infinity,edge.foot_direction!=='forward'?distance.get(edge.to_node)??Infinity:Infinity);
        if(entry+duration>limit)continue;
        metrics.full_path_m+=edge.length_m;
        if(edge.covered===true)metrics.roof_m+=edge.length_m;
        const original=originals.get(edge.source_edge_id!)??edge;
        const reading=model?pathShade(original,checks.get(`${original.is_crossing?'crossing':'path'}:${original.id}`)??[],Date.parse(at)+(entry+duration/2)*1000,pointAt(edge.geometry,.5),model):null;
        if(reading?.condition==='covered'||reading?.condition==='shade')metrics.shade_m+=edge.length_m;
        else if(!reading||reading.condition==='unknown')metrics.unknown_shade_m+=edge.length_m;
    }
    for(const key of Object.keys(metrics) as Array<keyof CatchmentMetrics>)metrics[key]=Math.round(metrics[key]);
    return {destinations,metrics};
}
export function impactCatchment(nodes:PathNode[],raw:PathEdge[],data:WalkingData,hazards:HazardReport[],request:Omit<ImpactRequest,'scenarios'>){
    return detailedCatchment(nodes,raw,data,hazards,request)?.destinations??null;
}

export function simulateRepair(data: WalkingData, edges: PathEdge[], hazards: HazardReport[], scenario: RepairScenario, at: string) {
    const target=scenario.target==='edge'?edges.find(e=>String(e.id)===scenario.target_id):data.assets.find(a=>a.id===scenario.target_id);
    if(!target)return null;
    const type= 'is_crossing' in target ? target.is_crossing?'crossing':'path' : target.kind==='entrance'?'entrance':'facility';
    const changedFields:Record<string,ObservationValue>={[scenario.field]:scenario.value,...(scenario.kind==='steps'?{slope_pct:8}: {})};
    const hypothetical:VerificationRecord={id:'simulation',target_type:type,target_id:scenario.target_id,status:'unverified',observed_at:at,created_at:at,
        valid_until:null,method:'operator_record',reviewer:'Hypothetical model',source_ref:'',notes:'Not a field check',attributes:changedFields};
    const records=data.verifications.map(r=>{
        if(r.target_type!==type||r.target_id!==scenario.target_id||!Object.keys(changedFields).some(field=>r.attributes[field]!==undefined))return r;
        const attributes={...r.attributes};for(const field of Object.keys(changedFields))delete attributes[field];return {...r,attributes};
    }).filter(r=>Object.keys(r.attributes).length).concat(hypothetical);
    const remaining=hazards.filter(h=>!(h.kind===scenario.kind&&(scenario.target==='asset'?h.asset_id===scenario.target_id:!h.asset_id&&String(h.edge_id)===scenario.target_id)));
    return {data:{...data,verifications:records},hazards:remaining};
}
function simulateDesign(nodes:PathNode[],edges:PathEdge[],data:WalkingData,hazards:HazardReport[],scenario:RepairScenario,shade?:ShadeDataset){
    if(scenario.kind==='new_connection'){
        const a=nodes.find(n=>n.id===scenario.proposal?.from_node),b=nodes.find(n=>n.id===scenario.proposal?.to_node);
        if(!a||!b||!connectionScenario(a,b))return null;
        const geometry:[[number,number],[number,number]]=[[a.lng,a.lat],[b.lng,b.lat]],id=edges.reduce((n,e)=>Math.max(n,e.id+1),1);
        const link:PathEdge={id,from_node:a.id,to_node:b.id,geometry,length_m:metres(geometry[0],geometry[1]),kind:'footway',name:'Illustrative new link',pedestrian_access:true,
            has_steps:false,slope_pct:5,surface_rating:1,clear_width_m:1.8,is_crossing:false,crossing_type:null,crossing_width_m:null,ped_green_s:null,cycle_s:null,has_kerb_ramp:null,
            shade_morning:null,shade_midday:null,shade_afternoon:null,shade_source:null,lit_ratio:null,lighting_source:null};
        return {nodes,edges:[...edges,link],data,hazards,shade};
    }
    const edge=edges.find(e=>String(e.id)===scenario.target_id);
    if(!edge||edge.is_crossing||edge.has_steps||edge.geometry.length<2)return null;
    if(scenario.kind==='rest_seat'){
        const [lng,lat]=pointAt(edge.geometry,.5);
        const rest:WalkingAsset={id:`simulation-rest:${edge.id}`,name:'Illustrative accessible rest seat',external_id:null,parent_id:null,kind:'rest',category:'community',lat,lng,source:'survey',source_ref:'',
            properties:{available:true,path_connection:true,public_access:'public',step_free:true,has_seat:true,wheelchair_space:true},edge_id:edge.id,edge_fraction:.5,connection_distance_m:0,anchor_lat:lat,anchor_lng:lng};
        return {nodes,edges,data:{...data,assets:[...data.assets,rest]},hazards,shade};
    }
    if(scenario.kind==='roof_cover'||scenario.kind==='tree_canopy'){
        const roof=scenario.kind==='roof_cover',height=scenario.proposal?.height_m??(roof?3:8),width=roof?scenario.proposal?.width_m??2.5:scenario.proposal?.diameter_m??6;
        if(!Number.isFinite(height)||height<2||height>30||!Number.isFinite(width)||width<1||width>25)return null;
        const ring=roof?corridorRing(edge.geometry,width):crownRing(pointAt(edge.geometry,.5),width);
        if(!ring)return null;
        const centre=pointAt(edge.geometry,.5);
        const solar:ShadeDataset={...(shade??{centre,objects:[],coverage:'partial' as const}),objects:[...(shade?.objects??[]),{ring:ring.slice(0,-1),height,base:roof?height-.25:height,source:'hypothetical design'}]};
        const spansPath=width>=(edge.clear_width_m??2);
        const updated=roof&&spansPath?edges.map(e=>e.id===edge.id?{...e,covered:true,shade_morning:1,shade_midday:1,shade_afternoon:1,shade_source:'modelled' as const}:e):edges;
        const records=roof&&spansPath?data.verifications.map(record=>{if(record.target_id!==String(edge.id)||record.target_type!=='path')return record;const attributes={...record.attributes};delete attributes.covered;delete attributes.shade_morning;delete attributes.shade_midday;delete attributes.shade_afternoon;return {...record,attributes};}):data.verifications;
        return {nodes,edges:updated,data:{...data,verifications:records},hazards,shade:solar};
    }
    return null;
}
export function compareMaintenanceImpact(nodes:PathNode[],edges:PathEdge[],data:WalkingData,hazards:HazardReport[],request:ImpactRequest,shade?:ShadeDataset) {
    if(!Number.isFinite(Date.parse(request.departure_at))||![5,10,15,20].includes(request.minutes))throw Error('Choose a valid catchment.');
    const before=detailedCatchment(nodes,edges,data,hazards,request,shade);
    if(!before)return {baseline:0,baselineMetrics:null,results:[],reason:'Choose a starting point on the mapped pedestrian network.'};
    const results=request.scenarios.slice(0,8).flatMap(scenario=>{
        const design=scenario.source==='hypothetical design'?simulateDesign(nodes,edges,data,hazards,scenario,shade):null;
        const repair=scenario.source!=='hypothetical design'?simulateRepair(data,edges,hazards,scenario,request.departure_at):null;
        const model=design??(repair?{...repair,nodes,edges,shade}:null);
        if(!model)return [];
        const after=detailedCatchment(model.nodes,model.edges,model.data,model.hazards,request,model.shade);
        if(!after)return [];
        const gained=[...after.destinations.values()].filter(a=>!before.destinations.has(a.id));
        const reduced=[...after.destinations.values()].flatMap(a=>{const old=before.destinations.get(a.id);return old&&old.minutes-a.minutes>=.5?[old.minutes-a.minutes]:[];});
        return [{scenario,before:before.destinations.size,after:after.destinations.size,gained,shorter:reduced.length,minutes_saved:reduced.reduce((n,v)=>n+v,0),beforeMetrics:before.metrics,afterMetrics:after.metrics}];
    }).sort((a,b)=>b.gained.length-a.gained.length||b.minutes_saved-a.minutes_saved||b.afterMetrics.shade_m-b.beforeMetrics.shade_m-(a.afterMetrics.shade_m-a.beforeMetrics.shade_m));
    return {baseline:before.destinations.size,baselineMetrics:before.metrics,results,reason:''};
}
