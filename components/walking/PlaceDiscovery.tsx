'use client';

import { useMemo, useState } from 'react';
import { MapPin, ChevronRight, Utensils, Cross, Toilet, Armchair, Umbrella, Search, SlidersHorizontal, Clock3, Footprints } from 'lucide-react';
import { usePlannerResult } from '@/lib/use-planner';
import { requiresStepFreeProfile, type Mode } from '@/lib/routing';
import { metres } from '@/lib/walking-geometry';
import { spotDetails } from '@/lib/shade-display';
import { solarModel } from '@/lib/solar-shade';
import type { ResidentLanguage } from '@/lib/resident-language';
import { placeHours } from '@/lib/place-details';
import { unavailableAssetIds } from '@/lib/report-status';
import { assetFacts, accessTerms, conditionState } from '@/lib/route-conditions';
import { evidenceFor } from '@/lib/verification';
import type { PlanningSnapshot } from '@/lib/planning-dispatch';
import { placeSearchText, type WalkingAsset, type JourneyRoute, type PlanningInput, type WalkingNeeds } from '@/lib/walking';
import { stateNames } from './JourneyReadiness';
import { PLACE_GOALS, matchesGoal } from '@/lib/place-goals';

interface Props {
    snapshot: PlanningSnapshot | null;
    request: Omit<PlanningInput, 'destination' | 'entrance_id'>;
    budget: number;
    onChoose: (asset: WalkingAsset, needs?:WalkingNeeds, mode?:Mode) => void;
    onReport: (asset: WalkingAsset) => void;
    language?: ResidentLanguage;
    warning?:boolean;
}
type PlaceResult = { destination: WalkingAsset; route: JourneyRoute | null; reasons: string[] };
const discoveryKind = ['destination', 'transit', 'toilet', 'water','rest','shelter'];

const termsName=(access:string)=>({public:'Public access recorded',customers:'Customers only',destination:'Destination access only',permission:'Permission required',private:'Private access',unknown:'Public access terms unknown'}[access]??'Access terms unknown');
function termsLabel(asset:WalkingAsset,snapshot:PlanningSnapshot,at:string){
    const facts=assetFacts(asset,snapshot.walking,at), terms=accessTerms(facts.values,at);
    return termsName(terms.access)+' · '+(terms.fee===null?'fee unknown':terms.fee?'fee recorded':'no fee recorded')+
        (terms.access==='unknown'?'':' · '+stateNames[conditionState(facts.evidence.public_access,facts.values.public_access)]);
}

export default function PlaceDiscovery({ snapshot, request, budget, onChoose, onReport, language = 'en', warning }: Props) {
    const [goal, setGoal] = useState('all');
    const [name, setName] = useState('');
    const [showUnavailable, setShowUnavailable] = useState(false);
    const [published, setPublished] = useState(false);
    const [limit, setLimit] = useState(8);
    const [openOnly,setOpenOnly]=useState(false);
    const [publicOnly,setPublicOnly]=useState(false);
    const [noFee,setNoFee]=useState(false);
    const [stepFree,setStepFree]=useState(false);
    const [checkedOnly,setCheckedOnly]=useState(false);
    const [cover,setCover]=useState(false);
    const needs=useMemo(()=>({...request.needs,step_free:request.needs.step_free||stepFree,verified_only:request.needs.verified_only||checkedOnly,
        comfort:[...new Set([...(request.needs.comfort??[]),...(cover?['shelter' as const]:[])])]}),[request.needs,stepFree,checkedOnly,cover]);
    const matching = useMemo(() => snapshot?.walking.assets.filter(asset => discoveryKind.includes(asset.kind) &&
        matchesGoal(asset,goal) && (!published || typeof asset.properties.official_source === 'string') &&
        placeSearchText(asset).includes(name.trim().toLowerCase()) &&
        (!publicOnly&&!noFee || (()=>{
            const {values}=assetFacts(asset,snapshot.walking,request.departure_at);
            const terms=accessTerms(values,request.departure_at);
            return (!publicOnly||terms.access==='public')&&(!noFee||terms.fee===false);
        })()))
        .sort((a, b) => metres([a.lng, a.lat], [request.origin[1], request.origin[0]]) -
            metres([b.lng, b.lat], [request.origin[1], request.origin[0]])) ?? [],
        [snapshot, goal, published, name, request.origin,request.departure_at,publicOnly,noFee]);
    const search = usePlannerResult<PlaceResult[]>(snapshot,
        { type: 'discover', input: {...request,needs}, ids: matching.slice(0, limit).map(asset => asset.id),
            modes: cover?['direct','sheltered']:['direct'] }, matching.length > 0);
    const shown = (search.result ?? []).filter(item => {
        if(!item.route)return showUnavailable&&!openOnly;
        if(!snapshot)return true;
        const hours=arrivalHours(item.route,snapshot);
        return (!openOnly||hours.open===true)&&(!checkedOnly||item.route.suitability==='green');
    });
    const mobility = needs.step_free || requiresStepFreeProfile(request.profile);
    const unavailable = useMemo(() => unavailableAssetIds(snapshot?.hazards ?? [], mobility), [snapshot?.hazards, mobility]);
    const facilities = useMemo(() => snapshot?.walking.assets.filter(asset =>
        (asset.kind === 'rest' || asset.kind === 'toilet') && asset.edge_id !== null && !unavailable.has(asset.id)) ?? [],
        [snapshot, unavailable]);
    const filterCount=[openOnly,publicOnly,noFee,stepFree,checkedOnly,cover,published,showUnavailable].filter(Boolean).length;
    return <section className="tg-discovery" aria-label="Reachable places & comfort">
        <div className="tg-stack">
            <div className="tg-discovery-intro"><span className="tg-kicker"><Footprints size={15} aria-hidden/> {budget} min on foot</span>
                <p>Find places you can reach with your current walking requirements, not just the nearest pin.</p></div>
            <div className="tg-category-chips" aria-label="Quick destination searches">
                {([{id:'food',label:'Lunch',Icon:Utensils},{id:'pharmacy',label:'Pharmacy',Icon:Cross},
                    {id:'toilet',label:'Toilet',Icon:Toilet},{id:'rest',label:'Rest',Icon:Armchair},{id:'shelter',label:'Rain cover',Icon:Umbrella}]).map(({id,label,Icon})=>
                    <button key={id} type="button" aria-pressed={goal===id} className="tg-filter-chip" onClick={()=>{setGoal(goal===id?'all':id);setLimit(8);}}><Icon size={17} aria-hidden />{label}</button>)}
            </div>
            <label className="tg-label">Name or street<span className="tg-icon-input"><Search size={19} aria-hidden/><input type="search" placeholder="e.g. pharmacy or café" value={name} onChange={event => {
                setName(event.target.value); setLimit(8);
            }} /></span></label>
            <label className="block text-sm font-semibold">What do you need?
                <select value={goal} onChange={event => { setGoal(event.target.value); setLimit(8); }} className="tg-input mt-1">
                    {PLACE_GOALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
            </label>
            <details className="tg-details tg-discovery-filters"><summary><SlidersHorizontal size={18} aria-hidden/>Access, opening and comfort filters{filterCount>0&&<span className="tg-count-pill">{filterCount}</span>}</summary><div className="mt-2 space-y-1">
                {([
                    ['Open at my arrival',openOnly,setOpenOnly],['Step-free access',stepFree,setStepFree],
                    ['Only routes with current required checks',checkedOnly,setCheckedOnly],['Prefer more roof cover',cover,setCover],
                    ['Recorded public access',publicOnly,setPublicOnly],['Recorded no fee',noFee,setNoFee],
                    ['Directory entries from venue or public agencies',published,setPublished],['Include unmatched places',showUnavailable,setShowUnavailable],
                ] as const).map(([label,checked,set])=><label key={label} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} onChange={e=>{set(e.target.checked); setLimit(8);}}/>{label}</label>)}
                {filterCount>0&&<button type="button" className="tg-text-action" onClick={()=>{setOpenOnly(false);setPublicOnly(false);setNoFee(false);setStepFree(false);setCheckedOnly(false);setCover(false);setPublished(false);setShowUnavailable(false);setLimit(8);}}>Clear filters</button>}
                <p className="tg-small">Unknown hours, fees and access are not assumed. Filters add to, rather than remove, your required conditions.</p>
            </div></details>
            {warning && goal==='shelter' && <p className="tg-note tg-warnbox">A weather warning affects this area. Look for an appropriate indoor location or delay the journey. Roof cover alone is not adequate storm protection.</p>}
            {search.pending && <p className="tg-loading-row" role="status"><span aria-hidden className="tg-loader"/>Checking walking routes and your needs…</p>}
            {search.error && <p role="alert">{search.error}</p>}
            {!search.pending && shown.length === 0 && <p className="text-sm">{matching.length
                ? 'No routes or arrival conditions matched these filters. Try other places or check more results.'
                : 'No mapped places match this search.'}</p>}
            {!!shown.length&&<div className="tg-result-heading"><h3>Nearby results</h3><span>{shown.length} shown</span></div>}
            <ul className="tg-result-list">{shown.map(({ destination, route, reasons }) => <li key={destination.id}
                className="tg-place-result">
                <button type="button" onClick={() => onChoose(destination,needs,route?.mode)} className="tg-place-result-title">
                    <span className="tg-place-result-icon"><MapPin size={20} aria-hidden/></span><strong>{destination.name}</strong>
                    <span className="tg-place-result-time">{route&&<><Clock3 size={15} aria-hidden/>{Math.ceil(route.total_min)} min</>}<ChevronRight size={18} aria-hidden/></span>
                </button>
                {typeof destination.properties.official_address === 'string' && <p className="text-sm">{destination.properties.official_address}</p>}
                {typeof destination.properties.official_visit_note === 'string' && <p className="text-sm">{destination.properties.official_visit_note}</p>}
                <p className="text-sm font-bold">{route ? `${Math.ceil(route.total_min)} min including rests · ${route.suitability === 'green'
                    ? 'Matches recorded requirements and checks' : 'Conditions need checking'}` : reasons[0]}</p>
                {snapshot&&<p className="tg-small">{termsLabel(destination,snapshot,route?.arrival_at??request.departure_at)}</p>}
                {route && snapshot && <PlaceArrival route={route} facilities={facilities} snapshot={snapshot} language={language} />}
                <div className="flex flex-wrap gap-x-3">
                    {typeof destination.properties.official_source === 'string' && <a className="inline-flex min-h-11 items-center text-sm font-bold underline"
                        href={destination.properties.official_source} target="_blank" rel="noreferrer">Directory source</a>}
                    {typeof destination.properties.official_phone === 'string' && <a className="inline-flex min-h-11 items-center text-sm font-bold underline"
                        href={`tel:${destination.properties.official_phone}`}>Call venue</a>}
                    {destination.source !== 'gtfs' && <button type="button" className="min-h-11 text-sm font-bold underline"
                        onClick={() => onReport(destination)}>Report a place update</button>}
                </div>
            </li>)}</ul>
            {matching.length > limit && <button className="min-h-11 font-bold underline" disabled={search.pending}
                onClick={() => setLimit(value => value + 8)}>Check more nearby places</button>}
            {matching.length > 0 && <p className="text-xs text-slate-600">Checking {Math.min(limit, matching.length)} of {matching.length} mapped places, nearest first.
                Results use your selected start, departure, pace and requirements.</p>}
        </div>
    </section>;
}

function arrivalHours(route:JourneyRoute,snapshot:PlanningSnapshot) {
    const place=placeHours(route.destination,route.arrival_at,snapshot.walking.verifications);
    const entrance=placeHours(route.entrance,route.arrival_at,snapshot.walking.verifications);
    // Require recorded open hours at both a venue and its separate access point
    // if both are known; never call a known closed place open.
    if(place.open===false)return place;
    if(entrance.open===false)return entrance;
    if(route.destination.id===route.entrance.id)return place;
    return place.open===true&&entrance.open===true?place:{...place,open:null};
}
function PlaceArrival({ route, facilities, snapshot, language }: { route: JourneyRoute; facilities: WalkingAsset[]; snapshot: PlanningSnapshot; language: ResidentLanguage }) {
    const records = snapshot.walking.verifications;
    const checked = evidenceFor(records, route.entrance.kind === 'entrance' ? 'entrance' : 'facility', route.entrance.id, route.arrival_at);
    const mapped = route.entrance.properties.connection_model;
    const access = checked.path_connection?.status === 'verified' && checked.path_connection.value === true ? 'Connection checked'
        : mapped === 'mapped_entrance' ? 'Mapped entrance' : mapped === 'approximate_approach' ? 'Approximate approach' : 'Mapped access point';
    const time = new Date(route.arrival_at).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
    const hours=arrivalHours(route,snapshot);
    const nearby = facilities.filter(asset => asset.id !== route.destination.id).map(asset => ({ asset,
        distance: metres([asset.lng, asset.lat], [route.entrance.lng, route.entrance.lat]) }))
        .filter(item => item.distance <= 120).sort((a, b) => a.distance - b.distance);
    const rest = nearby.find(item => item.asset.kind === 'rest');
    const toilet = nearby.find(item => item.asset.kind === 'toilet');
    const details=assetFacts(route.destination,snapshot.walking,route.arrival_at);
    return <div className="space-y-1 text-sm text-slate-700">
        <p>{route.entrance.name} · {access}</p>
        <p>{spotDetails(route.entrance, route.arrival_at, records, language, snapshot.shade && solarModel(snapshot.shade), route)[1]}</p>
        {checked.step_free?.status === 'verified' && <p>{checked.step_free.value === true ? 'Step-free access checked' : 'Steps or access barriers checked'}</p>}
        {route.destination.kind==='rest'&&<p>Seat: {details.values.has_seat===true?'recorded':details.values.has_seat===false?'unavailable':'unknown'} · {stateNames[conditionState(details.evidence.has_seat,details.values.has_seat)]}</p>}
        {route.destination.kind==='toilet'&&<p>Accessible toilet: {details.values.accessible_toilet===true?'recorded':details.values.accessible_toilet===false?'not accessible':'unknown'} · {stateNames[conditionState(details.evidence.accessible_toilet,details.values.accessible_toilet)]}</p>}
        <p>Arrive about {time} MYT · {hours.open === null ? 'hours uncertain' : hours.open ? `open in ${hours.source.toLowerCase()}` : 'closed at arrival'}
            {route.destination.properties.official_closed_holidays === true && ' · public holiday closures apply'}</p>
        {(rest || toilet) && <p>Mapped nearby
            {rest && ` · ${rest.asset.name} (${Math.round(rest.distance)} m)`}
            {toilet && ` · ${toilet.asset.name} (${Math.round(toilet.distance)} m)`}. Straight-line distance, not a checked walking connection.</p>}
    </div>;
}
