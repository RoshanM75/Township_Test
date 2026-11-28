import type { PathEdge, PathNode } from './routing.ts';
import type { PilotId } from './pilots.ts';

export type LevelGroup = 'ground' | 'above' | 'below' | 'unknown';
export type MapLevel = 'all' | LevelGroup | `floor:${number}`;
export interface WorldWay {
    source: 'osm';
    sourceDate?:string; sourceArchive?:string;
    structure: 'bridge' | 'tunnel' | 'indoor' | 'surface';
    levels: number[];
    levelGroups: LevelGroup[];
    layer?: number;
    covered?: boolean;
    clearWidth?: number;
    slope?: number;
    kerb?: boolean;
    kerbHeight?: number;
    ramp?: boolean;
    stepCount?: number;
    tactile?: boolean;
    audible?: boolean;
    openingHours?: string;
    restricted: boolean;
    connector?: 'stairs' | 'ramp' | 'lift' | 'bridge' | 'underpass';
    incline?: string;
    /** A separately measured height above local ground, never a layer number. */
    elevationM?: number;
}
export interface WorldSource {
    id:string;name:string;url:string;license:string;records:number;data_at?:string;sha256?:string;attribution?:string;note?:string;
}
export interface PedestrianWorld {
    version:1; area:PilotId;
    geometry:Record<string,number>;heightCounts:Record<string,number>;
    shade:{buildings:number;crowns:number}; gaps:Record<string,number>; sources:WorldSource[];
    ways:Record<string,WorldWay>;
    shadeDatasetId?:string; shadeModelDate?:string;
    shadeByEdge?:Record<string,{shade_morning?:number;shade_midday?:number;shade_afternoon?:number}>;
}
export function mapLevelMatches(level:MapLevel,group?:string,floors?:string){
    if(level==='all')return true;
    if(level.startsWith('floor:'))return floors?.split(';').filter(Boolean).some(v=>Number(v)===Number(level.slice(6)))??false;
    return (group??'unknown').split('|').includes(level);
}
export function worldLevels(world:PedestrianWorld){return [...new Set(Object.values(world.ways).flatMap(w=>w.levels))].sort((a,b)=>a-b);}

/** Match by OSM way identity; representative sun samples additionally require
 * the exact source graph fingerprint. Reviewer records are applied afterwards. */
export function enrichWorldEdges(edges:PathEdge[],world:PedestrianWorld,datasetId?:string):PathEdge[]{
    const sharedShade=!!datasetId&&datasetId===world.shadeDatasetId;
    return edges.map(edge=>{
        const w=world.ways[String(edge.osm_way_id)], samples=world.shadeByEdge?.[edge.id];
        const mapped={...edge};
        if(w){
            mapped.world=w;
            mapped.covered=edge.covered??w.covered??null;
            mapped.clear_width_m=edge.clear_width_m??w.clearWidth??null;
            mapped.slope_pct=edge.slope_pct??w.slope??null;
            mapped.has_tactile=edge.has_tactile??w.tactile??null;
            mapped.audible_signal=edge.audible_signal??w.audible??null;
            // A single mapped kerb does not prove both ends of a crossing.
            if(edge.is_crossing&&w.kerb===false)mapped.has_kerb_ramp=edge.has_kerb_ramp??false;
        }
        if(sharedShade&&edge.shade_source!=='audited'){
            mapped.shared_shade=true;
            mapped.shade_morning=mapped.covered?1:samples?.shade_morning??null;
            mapped.shade_midday=mapped.covered?1:samples?.shade_midday??null;
            mapped.shade_afternoon=mapped.covered?1:samples?.shade_afternoon??null;
            mapped.shade_source=mapped.covered||samples?'modelled':null;
        }
        return mapped;
    });
}

/** Only split a shared node when source tags explicitly contradict each other.
 * Ordinary mapped bridge approaches remain connected. At an ambiguous junction
 * a multi-level way is not allowed to teleport between floors at one endpoint.
 * Stable edge IDs/geometry and audit targets are retained. */
export function separateExplicitLevels(nodes:PathNode[],edges:PathEdge[]){
    if(!edges.some(e=>e.world?.levels.length===1))return {nodes,edges};
    const incidents=new Map<number,PathEdge[]>();
    for(const edge of edges)for(const n of new Set([edge.from_node,edge.to_node])){
        const a=incidents.get(n);if(a)a.push(edge);else incidents.set(n,[edge]);
    }
    const floor=(edge:PathEdge)=>edge.world?.levels.length===1?String(edge.world.levels[0]):'unknown';
    const replacements=new Map<number,Map<string,number>>(),byId=new Map(nodes.map(n=>[n.id,n]));
    const added:PathNode[]=[];let next=nodes.reduce((n,v)=>Math.min(n,v.id-1),-1);
    for(const [id,connected] of incidents){
        const floors=[...new Set(connected.map(floor).filter(v=>v!=='unknown'))];
        const node=byId.get(id);if(floors.length<2||!node)continue;
        const groups=new Map<string,number>([[floors[0],id]]);
        for(const key of [...floors.slice(1),...(connected.some(e=>floor(e)==='unknown')?['unknown']:[])]){
            groups.set(key,next);added.push({...node,id:next--});
        }
        replacements.set(id,groups);
    }
    if(!added.length)return {nodes,edges};
    return {nodes:[...nodes,...added], edges:edges.map(e=>{
        const from=replacements.get(e.from_node)?.get(floor(e))??e.from_node,to=replacements.get(e.to_node)?.get(floor(e))??e.to_node;
        return from===e.from_node&&to===e.to_node?e:{...e,from_node:from,to_node:to};
    })};
}
