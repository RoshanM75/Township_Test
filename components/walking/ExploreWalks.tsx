'use client';
import { useMemo, useState } from 'react';
import { Armchair, Umbrella, Droplets, Toilet, RotateCcw } from 'lucide-react';
import { findFacilities, FACILITY_LABELS, type FacilityKind } from '@/lib/walk-tools';
import { usePlannerResult } from '@/lib/use-planner';
import { metres } from '@/lib/walking-geometry';
import type { PlanningInput, WalkingData, WalkingAsset } from '@/lib/walking';
import type { PathEdge, PathNode, HazardReport } from '@/lib/routing';

export default function ExploreWalks({ nodes, edges, data, request, hazards, onChoose, onReturn, onLocate, locating, locationLabel, locationMessage, onLastPosition }: { nodes: PathNode[]; edges: PathEdge[]; data: WalkingData | null;
    request: Omit<PlanningInput, 'destination' | 'entrance_id'>; hazards: HazardReport[]; onChoose: (a: WalkingAsset) => void; onReturn: (minutes: number) => void;
    onLocate: () => void; locating: boolean; locationLabel: string; locationMessage: string | null; onLastPosition?: () => void }) {
    const [kind, setKind] = useState<FacilityKind>('rest');
    const [unmatched, setUnmatched] = useState(false);
    const [limit,setLimit]=useState(8);
    const snapshot=useMemo(()=>data?{nodes,edges,walking:data,hazards}:null,[nodes,edges,data,hazards]);
    const candidates=useMemo(()=>data?.assets.filter(a=>a.kind===kind).sort((a,b)=>metres([a.lng,a.lat],[request.origin[1],request.origin[0]])-metres([b.lng,b.lat],[request.origin[1],request.origin[0]]))??[],[data,kind,request.origin]);
    const search=usePlannerResult<ReturnType<typeof findFacilities>>(snapshot,{type:'facilities',input:request,kind,ids:candidates.slice(0,limit).map(a=>a.id)});
    const items=search.result??[];
    const icons = { rest: Armchair, shelter: Umbrella, water: Droplets, toilet: Toilet };
    return <div className="tg-stack">
        <h1 className="tg-h2">What would help your walk?</h1>
        <section className="rounded-2xl border border-emerald-200 bg-[#edf5f1] p-4 text-slate-900">
            <h2 className="flex items-center gap-2 font-bold"><RotateCcw size={20} aria-hidden />A walk that brings you back</h2>
            <p className="mt-2 text-sm">Start and finish in the same place. Your budget includes the return, crossing waits and required rests.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">{[15,30].map(n => <button className="tg-btn" key={n} disabled={!data} onClick={() => onReturn(n)}>Up to {n} min</button>)}</div>
            <p className="mt-2 text-xs">Some paths may be retraced. Your walking requirements still apply.</p>
        </section>
        <h2 className="tg-h2 mt-2">Find a facility</h2>
        <p className="tg-small">Routes start from your planning location and use your walking needs. Mapped facilities may still need checking.</p>
        <div className="rounded-xl border border-slate-300 p-3"><p className="text-sm">From <strong>{locationLabel}</strong></p><button className="tg-btn mt-2" disabled={locating} onClick={onLocate}>{locating ? 'Finding your location…' : 'Search near my location'}</button>{onLastPosition && <button className="mt-2 min-h-11 text-sm font-bold underline" onClick={onLastPosition}>Use my last recorded GPS position</button>}{locationMessage&&<p className="mt-2 text-sm" role="status">{locationMessage}</p>}</div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Facility type">{(Object.keys(FACILITY_LABELS) as FacilityKind[]).map(value => {
            const Icon = icons[value]; return <button key={value} className="tg-btn" aria-pressed={kind === value} style={kind === value ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' } : {}} onClick={() => {setKind(value);setLimit(8);}}><Icon size={20} aria-hidden />{FACILITY_LABELS[value]}</button>;
        })}</div>
        {!data ? <p className="tg-note">Load the walking data to explore facilities.</p> : candidates.length === 0 ? <p className="tg-note">No {FACILITY_LABELS[kind].toLowerCase()} have been mapped in this pilot yet. Try another facility type or return to planning.</p> : search.pending?<p className="tg-note" role="status">Checking nearby facilities and pedestrian routes…</p>:search.error?<p role="alert">{search.error}</p>:<>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={unmatched} onChange={e => setUnmatched(e.target.checked)} className="h-5 w-5" />Show facilities without a matching route</label>
            {!items.some(i => i.route) && !unmatched && <p className="tg-note">No mapped {FACILITY_LABELS[kind].toLowerCase()} currently match your needs and budget. Show unmatched facilities to see why.</p>}
            <ul className="space-y-3">{items.filter(i => i.route || unmatched).map(({ asset, route, note, details, reasons }) => <li key={asset.id} className="rounded-xl border-2 border-slate-200 p-3">
                <h3 className="font-bold">{asset.name}</h3><p className="mt-1 text-sm">{note}</p>
                <ul className="mt-1 space-y-1 text-xs text-slate-700">{details.map(detail => <li key={detail}>{detail}</li>)}</ul>
                <p className="mt-1 text-sm">{route ? `${Math.ceil(route.total_min)} min including rests · ${Math.round(route.length_m)} m` : reasons[0] || 'No route meets the selected needs and current availability.'}</p>
                <button className="tg-btn mt-3" disabled={!route} onClick={() => onChoose(asset)}>Review route to this facility</button>
            </li>)}</ul>
            {candidates.length>limit&&<button className="min-h-11 font-bold underline" onClick={()=>setLimit(n=>n+8)}>Check more nearby facilities</button>}
            <p className="text-xs">Showing {Math.min(limit,candidates.length)} of {candidates.length} mapped candidates, nearest first.</p>
        </>}
    </div>;
}
