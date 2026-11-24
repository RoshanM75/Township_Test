'use client';

import { useMemo, useState } from 'react';
import { usePlannerResult } from '@/lib/use-planner';
import { metres } from '@/lib/walking-geometry';
import { spotDetails } from '@/lib/shade-display';
import { solarModel } from '@/lib/solar-shade';
import type { ResidentLanguage } from '@/lib/resident-language';
import { placeHours } from '@/lib/place-details';
import { unavailableAssetIds } from '@/lib/report-status';
import { evidenceFor } from '@/lib/verification';
import type { PlanningSnapshot } from '@/lib/planning-dispatch';
import { placeSearchText, type WalkingAsset, type JourneyRoute, type PlanningInput } from '@/lib/walking';

interface Props {
    snapshot: PlanningSnapshot | null;
    request: Omit<PlanningInput, 'destination' | 'entrance_id'>;
    budget: number;
    onChoose: (asset: WalkingAsset) => void;
    onReport: (asset: WalkingAsset) => void;
    language?: ResidentLanguage;
}
type PlaceResult = { destination: WalkingAsset; route: JourneyRoute | null; reasons: string[] };
const categories = [
    ['all', 'All places'], ['healthcare', 'Clinics & healthcare'], ['food', 'Food & markets'],
    ['shopping', 'Shops'], ['community', 'Libraries & community places'], ['park', 'Parks'],
    ['transport', 'Transit stops'], ['facilities', 'Toilets & water'],
];
const discoveryKind = ['destination', 'transit', 'toilet', 'water'];

export default function PlaceDiscovery({ snapshot, request, budget, onChoose, onReport, language = 'en' }: Props) {
    const [category, setCategory] = useState('all');
    const [name, setName] = useState('');
    const [showUnavailable, setShowUnavailable] = useState(false);
    const [published, setPublished] = useState(false);
    const [opened, setOpened] = useState(false);
    const [limit, setLimit] = useState(8);
    const matching = useMemo(() => snapshot?.walking.assets.filter(asset => discoveryKind.includes(asset.kind) &&
        (category === 'all' || (category === 'facilities' ? asset.kind === 'toilet' || asset.kind === 'water' : asset.category === category)) &&
        (!published || typeof asset.properties.official_source === 'string') &&
        placeSearchText(asset).includes(name.trim().toLowerCase()))
        .sort((a, b) => metres([a.lng, a.lat], [request.origin[1], request.origin[0]]) -
            metres([b.lng, b.lat], [request.origin[1], request.origin[0]])) ?? [],
        [snapshot, category, published, name, request.origin]);
    const search = usePlannerResult<PlaceResult[]>(snapshot,
        { type: 'discover', input: request, ids: matching.slice(0, limit).map(asset => asset.id) }, opened && matching.length > 0);
    const shown = (search.result ?? []).filter(item => item.route || showUnavailable);
    const mobility = request.needs.step_free || request.profile === 'wheelchair';
    const unavailable = useMemo(() => unavailableAssetIds(snapshot?.hazards ?? [], mobility), [snapshot?.hazards, mobility]);
    const facilities = useMemo(() => snapshot?.walking.assets.filter(asset =>
        (asset.kind === 'rest' || asset.kind === 'toilet') && asset.edge_id !== null && !unavailable.has(asset.id)) ?? [],
        [snapshot, unavailable]);
    return <details className="rounded-xl border-2 border-slate-300 bg-white p-3 text-slate-900"
        onToggle={event => setOpened(event.currentTarget.open)}>
        <summary className="min-h-8 cursor-pointer font-bold">Find nearby places <span className="text-sm font-normal">· {budget} min on foot</span></summary>
        <div className="mt-3 space-y-3">
            <label className="block text-sm font-semibold">Name or street<input type="search" className="tg-input mt-1" value={name} onChange={event => {
                setName(event.target.value); setLimit(8);
            }} /></label>
            <label className="block text-sm font-semibold">Everyday destinations
                <select value={category} onChange={event => { setCategory(event.target.value); setLimit(8); }} className="tg-input mt-1">
                    {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0"
                checked={published} onChange={event => { setPublished(event.target.checked); setLimit(8); }} />Directory entries from venue or public agencies</label>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0"
                checked={showUnavailable} onChange={event => setShowUnavailable(event.target.checked)} />Include places with no matching route</label>
            {search.pending && <p role="status">Checking walking routes and your needs…</p>}
            {search.error && <p role="alert">{search.error}</p>}
            {!search.pending && shown.length === 0 && <p className="text-sm">{matching.length
                ? 'No routes met your needs for these places. Include unmatched places to see the reasons.'
                : 'No mapped places match this search.'}</p>}
            <ul className="space-y-2">{shown.map(({ destination, route, reasons }) => <li key={destination.id}
                className="space-y-1 rounded-lg border border-slate-200 p-3">
                <button type="button" onClick={() => onChoose(destination)} className="min-h-11 w-full text-left font-bold underline">{destination.name}</button>
                {typeof destination.properties.official_address === 'string' && <p className="text-sm">{destination.properties.official_address}</p>}
                {typeof destination.properties.official_visit_note === 'string' && <p className="text-sm">{destination.properties.official_visit_note}</p>}
                <p className="text-sm">{route ? `${Math.ceil(route.total_min)} min including rests · ${route.suitability === 'green'
                    ? 'Meets needs and current checks' : 'Conditions need checking'}` : reasons[0]}</p>
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
                Results use the departure time, walking pace, and access requirements you selected.</p>}
        </div>
    </details>;
}

function PlaceArrival({ route, facilities, snapshot, language }: { route: JourneyRoute; facilities: WalkingAsset[]; snapshot: PlanningSnapshot; language: ResidentLanguage }) {
    const records = snapshot.walking.verifications;
    const checked = evidenceFor(records, route.entrance.kind === 'entrance' ? 'entrance' : 'facility', route.entrance.id, route.arrival_at);
    const mapped = route.entrance.properties.connection_model;
    const access = checked.path_connection?.status === 'verified' && checked.path_connection.value === true ? 'Connection checked'
        : mapped === 'mapped_entrance' ? 'Mapped entrance' : mapped === 'approximate_approach' ? 'Approximate approach' : 'Mapped access point';
    const time = new Date(route.arrival_at).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
    let hours = placeHours(route.destination, route.arrival_at, records);
    if (hours.open === null) hours = placeHours(route.entrance, route.arrival_at, records);
    const nearby = facilities.filter(asset => asset.id !== route.destination.id).map(asset => ({ asset,
        distance: metres([asset.lng, asset.lat], [route.entrance.lng, route.entrance.lat]) }))
        .filter(item => item.distance <= 120).sort((a, b) => a.distance - b.distance);
    const rest = nearby.find(item => item.asset.kind === 'rest');
    const toilet = nearby.find(item => item.asset.kind === 'toilet');
    return <div className="space-y-1 text-sm text-slate-700">
        <p>{route.entrance.name} · {access}</p>
        <p>{spotDetails(route.entrance, route.arrival_at, records, language, snapshot.shade && solarModel(snapshot.shade), route)[1]}</p>
        {checked.step_free?.status === 'verified' && <p>{checked.step_free.value === true ? 'Step-free access checked' : 'Steps or access barriers checked'}</p>}
        <p>Arrive about {time} MYT · {hours.open === null ? 'hours uncertain' : hours.open ? `open in ${hours.source.toLowerCase()}` : 'closed at arrival'}
            {route.destination.properties.official_closed_holidays === true && ' · public holiday closures apply'}</p>
        {(rest || toilet) && <p>Mapped nearby
            {rest && ` · ${rest.asset.name} (${Math.round(rest.distance)} m)`}
            {toilet && ` · ${toilet.asset.name} (${Math.round(toilet.distance)} m)`}. Distances from the arrival point are straight-line estimates.</p>}
    </div>;
}
