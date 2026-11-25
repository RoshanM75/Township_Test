import { buildGraph, evaluateEdge, indexHazards, PROFILES, slotForHour, type PathNode, type PathEdge, type HazardReport, type Profile } from './routing.ts';
import type { WalkingData, WalkingAsset, PlanningInput, VerificationRecord, ObservationValue } from './walking.ts';
import { DEFAULT_NEEDS } from './walking.ts';
import { splitPathAnchors, type PathAnchor } from './path-anchors.ts';
import { projectPoint } from './walking-geometry.ts';
import { assetFacts, edgeRestrictions, observedEdge, usableAccess } from './route-conditions.ts';
import { openingAt, malaysiaHour } from './verification.ts';
import { placeHours } from './place-details.ts';
import { unavailableAssetIds } from './report-status.ts';
import type { MaintenanceDefect } from './types.ts';

export interface RepairScenario {
    id: string;
    name: string;
    target: 'edge' | 'asset';
    target_id: string;
    field: string;
    value: ObservationValue;
    kind: 'blocked'|'no_ramp'|'lift_out'|'broken_surface'|'steps';
    source: 'checked report' | 'mapped condition';
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

class Queue {
    private list: Array<[number,number]>=[];
    push(item:[number,number]){const a=this.list;a.push(item);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=a[i][0])break;[a[i],a[p]]=[a[p],a[i]];i=p;}}
    pop(){const a=this.list;if(!a.length)return undefined;const first=a[0],last=a.pop()!;if(a.length){a[0]=last;let i=0;for(;;){const l=i*2+1,r=l+1;let m=i;if(l<a.length&&a[l][0]<a[m][0])m=l;if(r<a.length&&a[r][0]<a[m][0])m=r;if(m===i)break;[a[i],a[m]]=[a[m],a[i]];i=m;}}return first;}
}

/** A bounded, directed walking-network catchment. Measures reachable mapped
 * destinations, not population, real users, or a new safety certification. */
export function impactCatchment(nodes:PathNode[],raw:PathEdge[],data:WalkingData,hazards:HazardReport[],request:Omit<ImpactRequest,'scenarios'>) {
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
    return destinations;
}

export function simulateRepair(data: WalkingData, edges: PathEdge[], hazards: HazardReport[], scenario: RepairScenario, at: string) {
    const target=scenario.target==='edge'?edges.find(e=>String(e.id)===scenario.target_id):data.assets.find(a=>a.id===scenario.target_id);
    if(!target)return null;
    const type= 'is_crossing' in target ? target.is_crossing?'crossing':'path' : target.kind==='entrance'?'entrance':'facility';
    const hypothetical:VerificationRecord={id:'simulation',target_type:type,target_id:scenario.target_id,status:'unverified',observed_at:at,created_at:at,
        valid_until:null,method:'operator_record',reviewer:'Hypothetical model',source_ref:'',notes:'Not a field check',attributes:{[scenario.field]:scenario.value}};
    const records=data.verifications.map(r=>{
        if(r.target_type!==type||r.target_id!==scenario.target_id||r.attributes[scenario.field]===undefined)return r;
        const attributes={...r.attributes};delete attributes[scenario.field];return {...r,attributes};
    }).filter(r=>Object.keys(r.attributes).length).concat(hypothetical);
    const remaining=hazards.filter(h=>!(h.kind===scenario.kind&&(scenario.target==='asset'?h.asset_id===scenario.target_id:!h.asset_id&&String(h.edge_id)===scenario.target_id)));
    return {data:{...data,verifications:records},hazards:remaining};
}
export function compareMaintenanceImpact(nodes:PathNode[],edges:PathEdge[],data:WalkingData,hazards:HazardReport[],request:ImpactRequest) {
    if(!Number.isFinite(Date.parse(request.departure_at))||![5,10,15,20].includes(request.minutes))throw Error('Choose a valid catchment.');
    const before=impactCatchment(nodes,edges,data,hazards,request);
    if(!before)return {baseline:0,results:[],reason:'Choose a starting point on the mapped pedestrian network.'};
    const results=request.scenarios.slice(0,8).flatMap(scenario=>{
        const model=simulateRepair(data,edges,hazards,scenario,request.departure_at);
        if(!model)return [];
        const after=impactCatchment(nodes,edges,model.data,model.hazards,request);
        if(!after)return [];
        const gained=[...after.values()].filter(a=>!before.has(a.id));
        const reduced=[...after.values()].flatMap(a=>{const old=before.get(a.id);return old&&old.minutes-a.minutes>=.5?[old.minutes-a.minutes]:[];});
        return [{scenario,before:before.size,after:after.size,gained,shorter:reduced.length,minutes_saved:reduced.reduce((n,v)=>n+v,0)}];
    }).sort((a,b)=>b.gained.length-a.gained.length||b.minutes_saved-a.minutes_saved);
    return {baseline:before.size,results,reason:''};
}
