'use client';

import { useMemo, useState } from 'react';
import { Plus, MapPin, ListChecks } from 'lucide-react';
import { placeSearchText, WALK_BUDGETS, type WalkingAsset, type JourneyRoute, type JourneyPlan } from '@/lib/walking';
import type { ErrandRequest, ErrandStop } from '@/lib/errand-planner';
import { PLACE_GOALS,type PlaceGoal } from '@/lib/place-goals';
import { metres } from '@/lib/walking-geometry';
import { malaysiaTimeLabel, type ResidentLanguage } from '@/lib/resident-language';

const emptyStop=():ErrandStop=>({place_id:'',dwell_min:5});
function StopPicker({ stop, index, places, onChange, removable, onRemove }: { stop:ErrandStop; index:number; places:WalkingAsset[]; onChange:(part:ErrandStop)=>void; removable:boolean; onRemove:()=>void }) {
    const [term,setTerm]=useState('');
    const candidates=places.filter(asset=>placeSearchText(asset).includes(term.trim().toLowerCase())).slice(0,30);
    const chosen=places.find(asset=>asset.id===stop.place_id||asset.external_id===stop.place_id);
    const choices=chosen&&!candidates.some(a=>a.id===chosen.id)?[chosen,...candidates]:candidates;
    return <fieldset className="tg-reliability-item space-y-2"><legend className="font-bold">Stop {index+1}</legend>
        <label className="tg-label">Choose a place or purpose<select className="tg-input" value={stop.goal??''} onChange={e=>onChange({...stop,place_id:'',goal:e.target.value?e.target.value as PlaceGoal:undefined})}>
            <option value="">I&rsquo;ll pick a place</option>
            {PLACE_GOALS.filter(([goal])=>goal!=='all').map(([goal,name])=><option key={goal} value={goal}>Choose: {name}</option>)}
        </select></label>
        {stop.goal?<p className="tg-small">Compare up to two nearby mapped candidates for this purpose.</p>:<>
        <label className="tg-label">Name, shop or purpose<input className="tg-input" type="search" value={term} placeholder="e.g. pharmacy, parcel, lunch" onChange={event=>setTerm(event.target.value)} /></label>
        <label className="tg-label">Choose place<select className="tg-input" required value={chosen?.id??''} onChange={event=>onChange({...stop,place_id:event.target.value})}>
            <option value="">Select a mapped place</option>{choices.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select></label></>}
        <label className="tg-label">Minutes at stop<select className="tg-input" value={stop.dwell_min} onChange={e=>onChange({...stop,dwell_min:Number(e.target.value)})}>
            {[...new Set([0,5,10,15,20,30,45,60,stop.dwell_min])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n} min</option>)}
        </select></label>
        {removable&&<button type="button" className="tg-text-action" onClick={onRemove}>Remove stop</button>}
    </fieldset>;
}

export default function ErrandPlanner({ places, origin, initial, initialBudget, onPlan }: {
    places:WalkingAsset[]; origin:[number,number]; initial:ErrandRequest|null; initialBudget:number; onPlan:(errands:ErrandRequest,budget:number)=>void;
}) {
    const [stops,setStops]=useState<ErrandStop[]>(initial?.stops??[emptyStop(),emptyStop()]);
    const [returns,setReturns]=useState(initial?.return_to_start??true);
    const [compare,setCompare]=useState(initial?.compare_order??true);
    const [budget,setBudget]=useState(Math.max(5,initialBudget));
    const ordered=useMemo(()=>places.slice().sort((a,b)=>metres([a.lng,a.lat],[origin[1],origin[0]])-metres([b.lng,b.lat],[origin[1],origin[0]])),[places,origin]);
    const explicit=stops.map(s=>s.place_id).filter(Boolean);
    const valid=stops.every(s=>s.place_id||s.goal)&&new Set(explicit).size===explicit.length;
    return <form className="tg-stack" onSubmit={e=>{e.preventDefault();if(valid)onPlan({stops,return_to_start:returns,compare_order:compare},budget);}}>
        <p className="tg-small">Combine two or three everyday stops or purposes in the time you have. Walking, crossing waits, required rests, visits and your return all count towards the budget.</p>
        {stops.map((stop,index)=><StopPicker key={index} stop={stop} index={index} places={ordered} onChange={part=>setStops(before=>before.map((s,i)=>i===index?part:s))} removable={stops.length>2} onRemove={()=>setStops(before=>before.filter((_,i)=>i!==index))}/>)}
        {stops.length<3&&<button type="button" className="tg-btn" onClick={()=>setStops(before=>[...before,emptyStop()])}><Plus size={17} aria-hidden/>Add stop</button>}
        <label className="tg-label">Total available time (minutes)<input className="tg-input" type="number" min={5} max={WALK_BUDGETS.at(-1)} value={budget} onChange={e=>setBudget(Math.max(5,Math.min(120,Number(e.target.value))))}/></label>
        <label className="flex items-center gap-3 min-h-11"><input className="h-5 w-5 shrink-0" type="checkbox" checked={returns} onChange={e=>setReturns(e.target.checked)}/>Return to the original start</label>
        <label className="flex items-center gap-3 min-h-11"><input className="h-5 w-5 shrink-0" type="checkbox" checked={compare} onChange={e=>setCompare(e.target.checked)}/>Compare stop order</label>
        <button type="submit" className="tg-btn tg-btn-primary" disabled={!valid}><ListChecks size={20} aria-hidden/>Plan errands</button>
    </form>;
}
export function ErrandItinerary({route, compared, language, onEdit, onFocus}: {route:JourneyRoute; compared?:JourneyPlan['compared_itineraries']; language:ResidentLanguage; onEdit:()=>void; onFocus:(point:[number,number])=>void}) {
    return <section className="tg-reliability-card">
        <div className="tg-reliability-line"><h3 className="tg-h2">Your errand itinerary</h3><button type="button" className="tg-text-action" onClick={onEdit}>Edit stops</button></div>
        <ol className="tg-stack">{route.errand_stops?.map((stop,i)=><li className="tg-reliability-item" key={stop.destination.id}><strong>{i+1}. {stop.destination.name}</strong>
            <p className="tg-small">{malaysiaTimeLabel(stop.arrival_at,language)}–{malaysiaTimeLabel(stop.leave_at,language)} MYT · {stop.dwell_min} min at stop</p>
            <p className="tg-small">{stop.hours_state==='open'?'Recorded hours cover the visit':'Opening or entrance hours need confirmation'}</p>
            <button className="tg-text-action" type="button" onClick={()=>onFocus([stop.entrance.lat,stop.entrance.lng])}><MapPin size={16} aria-hidden/>{stop.entrance.name}</button>
        </li>)}</ol>
        {route.errand_returns&&<p className="tg-note">Return about {malaysiaTimeLabel(route.arrival_at,language)} MYT.</p>}
        <p className="tg-small">Total {Math.ceil(route.total_min)} min including visits, walking and required rests. Times are estimates; an errand stop is not automatically a verified rest.</p>
        {!!compared&&compared.length>1&&<details className="tg-details"><summary>Compared feasible orders</summary><ul className="tg-evidence-list mt-2">{compared.map((alt,i)=><li key={i}><span>{alt.places.join(' → ')}{i===0?' · selected':''}</span><strong>{Math.ceil(alt.total_min)} min</strong></li>)}</ul></details>}
    </section>;
}
