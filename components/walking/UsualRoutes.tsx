'use client';

import { useState } from 'react';
import { Bell, BellOff, RefreshCw, Bookmark, LockKeyhole, Clock } from 'lucide-react';
import { PILOTS, type PilotId } from '@/lib/pilots';
import { inspectRoutine, type RoutineFeed } from '@/lib/usual-routes';
import type { WalkPack } from '@/lib/walk-library';
import { malaysiaTimeLabel, residentText, type ResidentLanguage } from '@/lib/resident-language';

export function UsualRouteForm({ initialLabel, initialEnabled = false, onSave }: { initialLabel: string; initialEnabled?:boolean; onSave: (label:string, enabled:boolean) => void }) {
    const [label, setLabel] = useState(initialLabel.slice(0,80));
    const [enabled,setEnabled] = useState(initialEnabled);
    return <form className="tg-stack" onSubmit={event => { event.preventDefault(); if(label.trim())onSave(label.trim(),enabled); }}>
        <label className="tg-label">Private route name<input required className="tg-input" maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} /></label>
        <label className="tg-note flex min-h-11 items-start gap-3">
            <input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />
            <span><strong>Monitor condition changes</strong><span className="tg-small block">Show relevant reports, repaired barriers and overdue checks while the app is open.</span></span>
        </label>
        <p className="tg-small flex items-start gap-2"><LockKeyhole size={18} className="shrink-0" aria-hidden />Your route name, starting point and routine stay in this browser. Monitoring uses public area data, without background location tracking.</p>
        <button type="submit" className="tg-btn tg-btn-primary"><Bookmark size={19} aria-hidden />Save usual route</button>
    </form>;
}

export default function UsualRoutes({ packs, feeds, now, language, onMonitor, onReplan, onPlan, onRefresh }: {
    packs: WalkPack[]; feeds: Partial<Record<PilotId,RoutineFeed>>; now: string; language: ResidentLanguage;
    onMonitor: (id:string, enabled:boolean) => void; onReplan:(pack:WalkPack)=>void; onPlan:()=>void; onRefresh:()=>void;
}) {
    const usual = packs.filter(pack=>pack.routine);
    const statusText = { 'not-checked':'Waiting for area data', 'snapshot':'Snapshot only', unavailable:'Latest feed unavailable', review:'Review changes', current:'No changes found in feed' };
    return <section className="tg-reliability-card" aria-label="My usual routes">
        <div className="tg-reliability-line"><h2 className="tg-h2 flex items-center gap-2"><Bell size={20} aria-hidden />{residentText(language,'My usual routes')}</h2>
            <button type="button" className="tg-text-action" onClick={onRefresh}><RefreshCw size={16} aria-hidden />Refresh</button></div>
        <p className="tg-small">Private, familiar journeys and changes that matter to your walk. Monitors refresh while the app is open; no background notifications.</p>
        {!usual.length ? <>
            <p className="tg-note">Plan a familiar walk, then choose Save usual route. You can turn monitoring on for it when you are ready.</p>
            <button type="button" className="tg-btn" onClick={onPlan}>Plan a familiar walk</button>
        </> : usual.map(pack=>{
            const monitor=pack.routine!, area=pack.area_id??'elmina';
            const state=inspectRoutine(pack,monitor.enabled?feeds[area]:undefined,now);
            return <article key={pack.id} className="tg-reliability-item space-y-2">
                <div className="tg-reliability-line"><h3 className="font-bold">{monitor.label}</h3><span className={'tg-evidence-chip '+(!monitor.enabled?'':state.status==='review'||state.status==='unavailable'?'tg-evidence-warn':'')}>{monitor.enabled?statusText[state.status]:'Monitoring off'}</span></div>
                <p className="tg-small">{PILOTS[area].name} · {Math.ceil(pack.route.total_min)} min when saved</p>
                {state.checked_at&&<p className="tg-small"><Clock size={14} className="inline mr-1" aria-hidden />Feed received {malaysiaTimeLabel(state.checked_at,language,true)} MYT{feeds[area]?.snapshot?' · snapshot':''}</p>}
                {monitor.enabled && state.changes.length>0 && <ul className="tg-stack">{state.changes.slice(0,6).map(change=><li key={change.key} className="tg-note"><strong>{change.title}</strong><p className="tg-small">{change.detail}</p></li>)}
                    {state.changes.length>6&&<li className="tg-small">{state.changes.length-6} additional changes — review a fresh plan.</li>}</ul>}
                <div className="tg-reliability-actions">
                    <button type="button" role="switch" aria-checked={monitor.enabled} className="tg-btn" onClick={()=>onMonitor(pack.id,!monitor.enabled)}>{monitor.enabled?<Bell size={18} aria-hidden/>:<BellOff size={18} aria-hidden/>}Monitoring {monitor.enabled?'on':'off'}</button>
                    <button type="button" className="tg-btn tg-btn-primary" onClick={()=>onReplan(pack)}>Review journey</button>
                </div>
            </article>;
        })}
    </section>;
}
