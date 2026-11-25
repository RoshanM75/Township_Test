'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Wrench, ArrowRight, RefreshCw } from 'lucide-react';
import { loadGraph,loadHazards,loadPilotContext,loadReports,loadWalkingData } from '@/lib/api';
import { buildGraph } from '@/lib/routing';
import { withMappedDetails } from '@/lib/pilot-walking-details';
import { presetStartPoints,type StartPoint } from '@/lib/start-points';
import { repairCandidates, type compareMaintenanceImpact, type ImpactRequest } from '@/lib/maintenance-impact';
import { usePlannerResult } from '@/lib/use-planner';
import type { PlanningSnapshot } from '@/lib/planning-dispatch';
import type { MaintenanceDefect } from '@/lib/types';
import type { PilotId } from '@/lib/pilots';
import { pointAt,metres } from '@/lib/walking-geometry';

const baseControl='mt-1 w-full rounded-lg border border-slate-400 min-h-11 bg-white px-3 text-sm';

export default function MaintenanceImpact({area,revision:parentRevision=0}:{area:PilotId;revision?:number}) {
    const [data,setData]=useState<{snapshot:PlanningSnapshot; reports:MaintenanceDefect[]; starts:StartPoint[]}|null>(null);
    const [error,setError]=useState('');
    const [revision,setRevision]=useState(0);
    const [originId,setOriginId]=useState('');
    const [profile,setProfile]=useState<ImpactRequest['profile']>('wheelchair');
    const [minutes,setMinutes]=useState(10);
    const [search,setSearch]=useState('');
    const [selected,setSelected]=useState<string[]>([]);
    const [command,setCommand]=useState<ImpactRequest|null>(null);
    const [limit,setLimit]=useState(12);
    useEffect(()=>{
        let cancelled=false;
        void Promise.all([loadGraph(area),loadHazards(area),loadReports('all',area),loadWalkingData(area),loadPilotContext(area)]).then(([graph,hazards,reports,walking,context])=>{
            const mapped=withMappedDetails(graph.edges,{...walking,area_id:area,dataset_id:walking.dataset_id??graph.source.dataset_id},context);
            const starts=presetStartPoints(context,mapped.walking.assets,buildGraph(graph.nodes,mapped.edges));
            if(!cancelled){
                setData({snapshot:{nodes:graph.nodes,edges:mapped.edges,walking:mapped.walking,hazards:hazards.hazards},reports:reports.reports,starts});setError('');
                setOriginId(starts[0]?.id??'');setSelected([]);setCommand(null);
            }
        }).catch(()=>{if(!cancelled)setError('Could not load the pedestrian map and case records. Refresh to try again.');});
        return()=>{cancelled=true;};
    },[area,revision,parentRevision]);
    const origin=data?.starts.find(start=>start.id===originId);
    const all=useMemo(()=>data?repairCandidates(data.snapshot.edges,data.snapshot.walking,data.reports):[],[data]);
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
        <p className="text-sm text-slate-700">Compare how each proposed repair could reconnect everyday destinations on the mapped pedestrian network. A comparison is hypothetical; it never modifies real conditions or work orders.</p>
        {error?<p role="alert" className="rounded-lg bg-amber-50 p-3">{error}</p>:!data?<p role="status">Loading map and repair candidates…</p>:<>
            <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm font-bold">Starting point<select className={baseControl} value={originId} onChange={e=>{setOriginId(e.target.value);invalidate();}}>
                    {data.starts.map(start=><option key={start.id} value={start.id}>{start.label}</option>)}
                </select></label>
                <label className="text-sm font-bold">Walking requirements<select className={baseControl} value={profile} onChange={e=>{setProfile(e.target.value as ImpactRequest['profile']);invalidate();}}>
                    <option value="wheelchair">Step-free / wheelchair</option><option value="everyday">Everyday walking</option>
                </select></label>
                <label className="text-sm font-bold">One-way walking time<select className={baseControl} value={minutes} onChange={e=>{setMinutes(Number(e.target.value));invalidate();}}>
                    {[5,10,15,20].map(n=><option key={n} value={n}>{n} min</option>)}
                </select></label>
            </div>
            <div className="rounded-xl border border-slate-300 p-3 space-y-3">
                <div className="flex flex-wrap justify-between gap-2 items-center"><h3 className="font-bold flex items-center gap-2"><Wrench size={18} aria-hidden/>Compare repairs</h3><span className="text-sm">{selected.length} of 8 selected</span></div>
                <p className="text-sm text-slate-600">Checked, unresolved reports first, then mapped steps and missing kerb ramps. A mapped condition is a candidate for investigation, not a confirmed repair need.</p>
                <label className="text-sm font-bold block">Find a mapped target<input className={baseControl} type="search" value={search} onChange={e=>{setSearch(e.target.value);setLimit(12);}} placeholder="Location, ramp, steps or ID"/></label>
                <ul className="grid sm:grid-cols-2 gap-2">{matching.slice(0,limit).map(candidate=><li key={candidate.id}>
                    <label className="flex gap-3 items-start min-h-12 border border-slate-200 p-2 rounded-lg cursor-pointer">
                        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={selected.includes(candidate.id)}
                            disabled={!selected.includes(candidate.id)&&selected.length>=8}
                            onChange={e=>{setSelected(before=>e.target.checked?[...before,candidate.id]:before.filter(id=>id!==candidate.id));invalidate();}}/>
                        <span className="min-w-0 break-words text-sm"><strong>{candidate.name}</strong><span className="block text-xs capitalize text-slate-600">{candidate.kind.replaceAll('_',' ')} · {candidate.source} · {candidate.target_id}</span></span>
                    </label>
                </li>)}</ul>
                {!matching.length&&<p className="text-sm">No mapped candidates match this search.</p>}
                <div className="flex gap-4 flex-wrap">{matching.length>limit&&<button className="min-h-11 font-bold underline" type="button" onClick={()=>setLimit(n=>n+12)}>Show more candidates</button>}
                    {selected.length>0&&<button className="min-h-11 font-bold underline" type="button" onClick={()=>{setSelected([]);invalidate();}}>Clear selection</button>}</div>
            </div>
            <button className="min-h-11 bg-[#902734] text-white px-4 py-2 rounded-xl font-bold disabled:opacity-50" disabled={!origin||!selected.length||result.pending} type="button" onClick={()=>origin&&setCommand({origin:origin.coordinates,profile,minutes,departure_at:new Date().toISOString(),scenarios:all.filter(s=>selected.includes(s.id))})}>{result.pending?'Comparing the walking network…':'Compare repair impact'}</button>
            {result.error&&<p role="alert">{result.error}</p>}
            {result.result&&<section ref={resultRef} tabIndex={-1} className="space-y-3 scroll-mt-44" aria-live="polite">
                {result.result.reason?<p>{result.result.reason}</p>:<>
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                    <p className="text-sm font-bold">Current mapped reach within {minutes} min</p><p className="text-3xl font-extrabold tabular-nums">{result.result.baseline}</p><p className="text-sm">Distinct mapped destinations and comfort facilities</p>
                </div>
                <ol className="space-y-3">{result.result.results.map((entry,index)=><li key={entry.scenario.id} className="rounded-xl border border-slate-300 p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-bold">{index+1}. {entry.scenario.name} — {entry.scenario.kind.replaceAll('_',' ')}</h3><span className="rounded-full bg-emerald-100 text-emerald-900 px-3 py-1 font-bold text-sm">+{entry.gained.length} places</span></div>
                    <p className="text-sm text-slate-600 capitalize">{entry.scenario.source} · simulated separately</p>
                    <p className="font-bold flex items-center gap-3"><span>{entry.before}</span><ArrowRight size={18} aria-hidden/><span>{entry.after} reachable</span></p>
                    <p className="text-sm">{entry.shorter} already-reachable places have a shorter estimated trip (at least 30 seconds).</p>
                    {entry.gained.length>0&&<details className="text-sm"><summary className="min-h-9 cursor-pointer font-bold">Places reconnected by this scenario</summary><ul className="mt-2 space-y-1">{entry.gained.map(place=><li className="flex items-start gap-2" key={place.id}><MapPin size={16} className="shrink-0 mt-1 text-emerald-800" aria-hidden/>{place.name} · {Math.ceil(place.minutes)} min</li>)}</ul></details>}
                </li>)}</ol>
                <p className="text-sm text-slate-600">Ranked by additional reachable mapped places, then modelled time savings. Unknown conditions remain unknown; no population or usage estimates are inferred. Actual repair design, costs and complete field accessibility checks are separate.</p>
                </>}
            </section>}
        </>}
    </section>;
}
