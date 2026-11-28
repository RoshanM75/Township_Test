'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Wrench, ArrowRight, RefreshCw } from 'lucide-react';
import { loadGraph,loadHazards,loadPilotContext,loadReports,loadWalkingData,loadPedestrianWorld } from '@/lib/api';
import { buildGraph } from '@/lib/routing';
import { withMappedDetails } from '@/lib/pilot-walking-details';
import { presetStartPoints,type StartPoint } from '@/lib/start-points';
import { infrastructureCandidates, connectionScenario, repairCandidates, type compareMaintenanceImpact, type ImpactRequest, type RepairScenario, type InfrastructureProposal } from '@/lib/maintenance-impact';
import { usePlannerResult } from '@/lib/use-planner';
import type { PlanningSnapshot } from '@/lib/planning-dispatch';
import type { MaintenanceDefect } from '@/lib/types';
import type { PilotId } from '@/lib/pilots';
import { sitePath } from '@/lib/site';
import { malaysiaInput,fromMalaysiaInput } from '@/lib/comfort';
import type { ShadeDataset } from '@/lib/solar-shade';
import type { PedestrianWorld } from '@/lib/pedestrian-world';
import { pointAt,metres } from '@/lib/walking-geometry';

const baseControl='mt-1 w-full rounded-lg border border-slate-400 min-h-11 bg-white px-3 text-sm';

export default function MaintenanceImpact({area,revision:parentRevision=0}:{area:PilotId;revision?:number}) {
    const [data,setData]=useState<{snapshot:PlanningSnapshot; reports:MaintenanceDefect[]; starts:StartPoint[]; world:PedestrianWorld|null}|null>(null);
    const [error,setError]=useState('');
    const [revision,setRevision]=useState(0);
    const [originId,setOriginId]=useState('');
    const [profile,setProfile]=useState<ImpactRequest['profile']>('wheelchair');
    const [minutes,setMinutes]=useState(10);
    const [search,setSearch]=useState('');
    const [selected,setSelected]=useState<RepairScenario[]>([]);
    const [scenarioType,setScenarioType]=useState<'repair'|InfrastructureProposal|'new_connection'>('repair');
    const [fromNode,setFromNode]=useState(''),[toNode,setToNode]=useState('');
    const [departure,setDeparture]=useState(()=>malaysiaInput(new Date().toISOString()));
    const [roofWidth,setRoofWidth]=useState(2.5),[roofHeight,setRoofHeight]=useState(3),[crownDiameter,setCrownDiameter]=useState(6),[crownHeight,setCrownHeight]=useState(8);
    const [command,setCommand]=useState<ImpactRequest|null>(null);
    const [limit,setLimit]=useState(12);
    useEffect(()=>{
        let cancelled=false;
        void Promise.all([loadGraph(area),loadHazards(area),loadReports('all',area),loadWalkingData(area),loadPilotContext(area),loadPedestrianWorld(area),
            fetch(sitePath(`/map-area/${area}-shade.json`),{signal:AbortSignal.timeout(5000)}).then(r=>r.ok?r.json() as Promise<ShadeDataset>:undefined).catch(()=>undefined)]).then(([graph,hazards,reports,walking,context,world,shade])=>{
            const mapped=withMappedDetails(graph.edges,{...walking,area_id:area,dataset_id:walking.dataset_id??graph.source.dataset_id},context);
            const starts=presetStartPoints(context,mapped.walking.assets,buildGraph(graph.nodes,mapped.edges));
            if(!cancelled){
                setData({snapshot:{nodes:graph.nodes,edges:mapped.edges,walking:mapped.walking,hazards:hazards.hazards,shade},reports:reports.reports,starts,world});setError('');
                setOriginId(starts[0]?.id??'');setSelected([]);setCommand(null);
            }
        }).catch(()=>{if(!cancelled)setError('Could not load the pedestrian map and case records. Refresh to try again.');});
        return()=>{cancelled=true;};
    },[area,revision,parentRevision]);
    const origin=data?.starts.find(start=>start.id===originId);
    const all=useMemo(()=>data?scenarioType==='repair'?repairCandidates(data.snapshot.edges,data.snapshot.walking,data.reports):scenarioType==='new_connection'?[]:infrastructureCandidates(data.snapshot.edges,scenarioType):[],[data,scenarioType]);
    const connectionNodes=useMemo(()=>{
        if(!data||!origin)return [];
        const names=new Map<number,string>();
        for(const e of data.snapshot.edges){if(e.is_crossing||e.has_steps||e.world&&!e.world.levelGroups.includes('ground'))continue;for(const id of [e.from_node,e.to_node])if(!names.has(id))names.set(id,e.name||`Path ${e.id}`);}
        const point:[number,number]=[origin.coordinates[1],origin.coordinates[0]];
        return data.snapshot.nodes.filter(n=>names.has(n.id)).map(n=>({node:n,name:names.get(n.id),distance:metres(point,[n.lng,n.lat])})).sort((a,b)=>a.distance-b.distance).slice(0,160);
    },[data,origin]);
    const proposedLink=useMemo(()=>{const from=connectionNodes.find(v=>String(v.node.id)===fromNode)?.node,to=connectionNodes.find(v=>String(v.node.id)===toNode)?.node;return from&&to?connectionScenario(from,to):null;},[connectionNodes,fromNode,toNode]);
    const choose=(candidate:RepairScenario,checked:boolean)=>{setSelected(prev=>checked?prev.length<8&&!prev.some(s=>s.id===candidate.id)?[...prev,candidate]:prev:prev.filter(s=>s.id!==candidate.id));setCommand(null);};
    const matching=useMemo(()=>{
        if(!data||!origin)return [];
        const edges=new Map(data.snapshot.edges.map(edge=>[String(edge.id),edge])),assets=new Map(data.snapshot.walking.assets.map(asset=>[asset.id,asset]));
        const from:[number,number]=[origin.coordinates[1],origin.coordinates[0]];
        const distance=(scenario:typeof all[number])=>{
            const edge=scenario.target==='edge'?edges.get(scenario.target_id):undefined,asset=scenario.target==='asset'?assets.get(scenario.target_id):undefined;
            const point=edge?pointAt(edge.geometry,.5):asset?[asset.lng,asset.lat] as [number,number]:from;
            return metres(from,point);
        };
        return all.filter(s=>(s.name+' '+s.kind+' '+s.target_id+' '+s.source).toLowerCase().includes(search.trim().toLowerCase()))
            .sort((a,b)=>Number(b.source==='checked report')-Number(a.source==='checked report')||distance(a)-distance(b));
    },[data,origin,all,search]);
    const result=usePlannerResult<ReturnType<typeof compareMaintenanceImpact>>(data?.snapshot??null,command?{type:'impact',request:command}:null);
    const resultRef=useRef<HTMLElement>(null);
    useEffect(()=>{if(result.result){resultRef.current?.focus({preventScroll:true});resultRef.current?.scrollIntoView({block:'start',behavior:'auto'});}},[result.result]);
    const invalidate=()=>setCommand(null);
    return <section aria-label="Maintenance impact comparison" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs uppercase tracking-wider font-bold text-[#7F1D22]">Infrastructure intelligence</p><h2 className="text-xl font-extrabold">Maintenance impact</h2></div>
            <button type="button" className="min-h-11 flex gap-2 items-center font-bold underline" onClick={()=>{setData(null);setCommand(null);setRevision(v=>v+1);}}><RefreshCw size={18} aria-hidden/>Refresh area</button>
        </div>
        <p className="text-sm text-slate-700">Compare how each proposed repair or new pedestrian improvement could change access, roof cover, shade and rest opportunities. All comparisons are separate hypothetical designs; they never modify live routes, field checks or work orders.</p>
        {error?<p role="alert" className="rounded-lg bg-amber-50 p-3">{error}</p>:!data?<p role="status">Loading map and repair candidates…</p>:<>
            <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm font-bold">Starting point<select className={baseControl} value={originId} onChange={e=>{setOriginId(e.target.value);setFromNode('');setToNode('');invalidate();}}>
                    {data.starts.map(start=><option key={start.id} value={start.id}>{start.label}</option>)}
                </select></label>
                <label className="text-sm font-bold">Walking requirements<select className={baseControl} value={profile} onChange={e=>{setProfile(e.target.value as ImpactRequest['profile']);invalidate();}}>
                    <option value="wheelchair">Step-free / wheelchair</option><option value="everyday">Everyday walking</option>
                </select></label>
                <label className="text-sm font-bold">One-way walking time<select className={baseControl} value={minutes} onChange={e=>{setMinutes(Number(e.target.value));invalidate();}}>
                    {[5,10,15,20].map(n=><option key={n} value={n}>{n} min</option>)}
                </select></label>
            </div>
            {data.world&&<details className="rounded-xl border border-slate-200 p-3 text-sm"><summary className="font-bold min-h-9 cursor-pointer">Walking model &amp; survey gaps</summary><p>{Object.values(data.world.gaps).reduce((n,v)=>n+v,0).toLocaleString()} mapped survey targets. {data.world.shade.buildings} building shade shapes; {data.world.shade.crowns} canopy shapes. A mapped target is not a defect or an inspection.</p><div className="flex gap-3 flex-wrap mt-2"><a className="font-bold underline" href={sitePath(`/map-area/${area}-survey-gaps.csv`)} download>Survey CSV</a><a href={sitePath(`/map-area/${area}-survey-gaps.geojson`)} download className="font-bold underline">Survey GeoJSON</a></div></details>}
            <label className="text-sm font-bold block">Scenario time (Malaysia)<input className={baseControl} type="datetime-local" value={departure} onChange={e=>{setDeparture(e.target.value);invalidate();}}/></label>
            <div className="rounded-xl border border-slate-300 p-3 space-y-3">
                <div className="flex flex-wrap justify-between gap-2 items-center"><h3 className="font-bold flex items-center gap-2"><Wrench size={18} aria-hidden/>Compare improvements</h3><span className="text-sm">{selected.length} of 8 selected</span></div>
                <label className="text-sm font-bold block">Improvement type<select className={baseControl} value={scenarioType} onChange={e=>{setScenarioType(e.target.value as typeof scenarioType);setSearch('');setLimit(12);invalidate();}}>
                    <option value="repair">Repairs: closures, kerb ramps, stairs / lift</option><option value="roof_cover">Add a covered walkway</option><option value="tree_canopy">Add a proposed tree canopy</option><option value="rest_seat">Add a rest seat</option><option value="new_connection">Connect two mapped nodes</option>
                </select></label>
                {scenarioType==='repair'?<p className="text-sm text-slate-600">Checked, unresolved reports first, then mapped steps and missing kerbs. A replacement ramp assumes a feasible step-free design; actual gradient, land and clearance must be checked.</p>:<p className="text-sm text-slate-600">Choose a mapped path or two actual network nodes. The new feature is a hypothetical design, not an existing asset or verified connection.</p>}
                {scenarioType==='roof_cover'&&<div className="grid grid-cols-2 gap-2"><label className="text-sm font-bold">Proposed roof width (m)<input className={baseControl} type="number" min="1" max="12" step="0.5" value={roofWidth} onChange={e=>{setRoofWidth(Number(e.target.value));invalidate();}}/></label><label className="text-sm font-bold">Proposed roof height (m)<input className={baseControl} type="number" min="2" max="12" step="0.5" value={roofHeight} onChange={e=>{setRoofHeight(Number(e.target.value));invalidate();}}/></label></div>}
                {scenarioType==='tree_canopy'&&<div className="grid grid-cols-2 gap-2"><label className="text-sm font-bold">Proposed crown diameter (m)<input className={baseControl} type="number" min="1" max="25" step="0.5" value={crownDiameter} onChange={e=>{setCrownDiameter(Number(e.target.value));invalidate();}}/></label><label className="text-sm font-bold">Proposed canopy height (m)<input className={baseControl} type="number" min="2" max="30" step="1" value={crownHeight} onChange={e=>{setCrownHeight(Number(e.target.value));invalidate();}}/></label></div>}
                {scenarioType==='new_connection'?<>
                    <p className="text-xs text-slate-600">Select two nearby mapped ground-network nodes. The illustrative link is straight, step-free, 1.8 m wide and assumes a 5% grade. It does not establish a feasible real-world alignment.</p>
                    <div className="grid gap-2 sm:grid-cols-2">{([{id:'From mapped node',value:fromNode,set:setFromNode},{id:'To mapped node',value:toNode,set:setToNode}] as const).map(({id,value,set})=><label key={id} className="text-sm font-bold">{id}<select className={baseControl} value={value} onChange={e=>{set(e.target.value);invalidate();}}><option value="">Choose a node</option>{connectionNodes.map(v=><option key={v.node.id} value={v.node.id}>{v.name} · {Math.round(v.distance)} m from start · #{v.node.id}</option>)}</select></label>)}</div>
                    <button className="min-h-11 font-bold underline disabled:opacity-50" type="button" disabled={!proposedLink||selected.length>=8||selected.some(s=>s.id===proposedLink?.id)} onClick={()=>proposedLink&&choose(proposedLink,true)}>Add proposed link</button>
                    {fromNode&&toNode&&!proposedLink&&<p className="text-xs">Choose distinct nodes with a connection length of 1–500 m.</p>}
                </>:<>
                <label className="text-sm font-bold block">Find a mapped target<input className={baseControl} type="search" value={search} onChange={e=>{setSearch(e.target.value);setLimit(12);}} placeholder="Location, ramp, steps or ID"/></label>
                <ul className="grid sm:grid-cols-2 gap-2">{matching.slice(0,limit).map(candidate=><li key={candidate.id}>
                    <label className="flex gap-3 items-start min-h-12 border border-slate-200 p-2 rounded-lg cursor-pointer">
                        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={selected.some(s=>s.id===candidate.id)}
                            disabled={!selected.some(s=>s.id===candidate.id)&&selected.length>=8}
                            onChange={e=>choose(candidate,e.target.checked)}/>
                        <span className="min-w-0 break-words text-sm"><strong>{candidate.name}</strong><span className="block text-xs capitalize text-slate-600">{candidate.kind.replaceAll('_',' ')} · {candidate.source} · {candidate.target_id}</span></span>
                    </label>
                </li>)}</ul>
                {!matching.length&&<p className="text-sm">No mapped candidates match this search.</p>}
                </>}
                {!!selected.length&&<ul className="text-xs space-y-1" aria-label="Selected improvements">{selected.map(s=><li className="flex justify-between items-center gap-2" key={s.id}><span>{s.name} · {s.kind.replaceAll('_',' ')}</span><button type="button" className="min-h-9 font-bold underline" onClick={()=>choose(s,false)}>Remove</button></li>)}</ul>}
                <div className="flex gap-4 flex-wrap">{matching.length>limit&&<button className="min-h-11 font-bold underline" type="button" onClick={()=>setLimit(n=>n+12)}>Show more candidates</button>}
                    {selected.length>0&&<button className="min-h-11 font-bold underline" type="button" onClick={()=>{setSelected([]);invalidate();}}>Clear selection</button>}</div>
            </div>
            <button className="min-h-11 bg-[#902734] text-white px-4 py-2 rounded-xl font-bold disabled:opacity-50" disabled={!origin||!selected.length||result.pending||!fromMalaysiaInput(departure)||![roofWidth,roofHeight,crownDiameter,crownHeight].every(Number.isFinite)||roofWidth<1||roofWidth>12||roofHeight<2||roofHeight>12||crownDiameter<1||crownDiameter>25||crownHeight<2||crownHeight>30} type="button" onClick={()=>origin&&setCommand({origin:origin.coordinates,profile,minutes,departure_at:fromMalaysiaInput(departure)!,scenarios:selected.map(s=>s.kind==='roof_cover'?{...s,proposal:{width_m:roofWidth,height_m:roofHeight}}:s.kind==='tree_canopy'?{...s,proposal:{diameter_m:crownDiameter,height_m:crownHeight}}:s)})}>{result.pending?'Comparing the walking network…':'Compare repair impact'}</button>
            {result.error&&<p role="alert">{result.error}</p>}
            {result.result&&<section ref={resultRef} tabIndex={-1} className="space-y-3 scroll-mt-44" aria-live="polite">
                {result.result.reason?<p>{result.result.reason}</p>:<>
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                    <p className="text-sm font-bold">Current mapped reach within {minutes} min</p><p className="text-3xl font-extrabold tabular-nums">{result.result.baseline}</p><p className="text-sm">Distinct mapped destinations and comfort facilities</p>{result.result.baselineMetrics&&<p className="mt-2 text-xs">{result.result.baselineMetrics.roof_m} m mapped roof cover · {result.result.baselineMetrics.shade_m} m modelled shade · {result.result.baselineMetrics.unknown_shade_m} m unknown shade · {result.result.baselineMetrics.rest_places} rest places</p>}
                </div>
                <ol className="space-y-3">{result.result.results.map((entry,index)=><li key={entry.scenario.id} className="rounded-xl border border-slate-300 p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-bold">{index+1}. {entry.scenario.name} — {entry.scenario.kind.replaceAll('_',' ')}</h3><span className="rounded-full bg-emerald-100 text-emerald-900 px-3 py-1 font-bold text-sm">+{entry.gained.length} places</span></div>
                    <p className="text-sm text-slate-600 capitalize">{entry.scenario.source} · simulated separately</p>
                    <p className="font-bold flex items-center gap-3"><span>{entry.before}</span><ArrowRight size={18} aria-hidden/><span>{entry.after} reachable</span></p>
                    <p className="text-sm">{entry.shorter} already-reachable places have a shorter estimated trip (at least 30 seconds).</p>
                    <dl className="grid grid-cols-2 gap-2 text-sm"><div className="rounded-lg bg-slate-50 p-2"><dt>Roof-covered network</dt><dd className="font-bold">{entry.beforeMetrics.roof_m} → {entry.afterMetrics.roof_m} m</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt>Modelled shade</dt><dd className="font-bold">{entry.beforeMetrics.shade_m} → {entry.afterMetrics.shade_m} m</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt>Unknown shade</dt><dd className="font-bold">{entry.beforeMetrics.unknown_shade_m} → {entry.afterMetrics.unknown_shade_m} m</dd></div><div className="rounded-lg bg-slate-50 p-2"><dt>Reachable rest places</dt><dd className="font-bold">{entry.beforeMetrics.rest_places} → {entry.afterMetrics.rest_places}</dd></div></dl>
                    {entry.scenario.proposal&&<p className="text-xs text-slate-600">Design only · {entry.scenario.proposal.width_m?`width ${entry.scenario.proposal.width_m} m · `:''}{entry.scenario.proposal.diameter_m?`crown ${entry.scenario.proposal.diameter_m} m · `:''}{entry.scenario.proposal.height_m?`height ${entry.scenario.proposal.height_m} m`:''}</p>}
                    {entry.gained.length>0&&<details className="text-sm"><summary className="min-h-9 cursor-pointer font-bold">Places reconnected by this scenario</summary><ul className="mt-2 space-y-1">{entry.gained.map(place=><li className="flex items-start gap-2" key={place.id}><MapPin size={16} className="shrink-0 mt-1 text-emerald-800" aria-hidden/>{place.name} · {Math.ceil(place.minutes)} min</li>)}</ul></details>}
                </li>)}</ol>
                <p className="text-sm text-slate-600">Ranked by added reachable places, time savings and modelled shade gain. Shade is sampled on reachable full path segments at the chosen time using the same geometry model as the walking map. Night, missing heights and unverified canopy limit what can be inferred. Hypothetical facilities and links are not live data. Actual construction design, land permission and field accessibility checks are separate.</p>
                </>}
            </section>}
        </>}
    </section>;
}
