'use client';

import { useMemo, useState } from 'react';
import { BusFront, MapPin } from 'lucide-react';
import { scheduledService, transitDestinationId, TRANSIT_LABELS } from '@/lib/transit';
import { metres } from '@/lib/walking-geometry';
import type { PilotContext } from '@/lib/pilots';
import type { WalkingAsset } from '@/lib/walking';

const clock = new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });
const serviceTime = (time: string) => clock.format(new Date(time));

export default function TransitNearby({ context, assets, origin, at, onChoose, onFocus }: {
    context: PilotContext; assets: WalkingAsset[]; origin: [number, number]; at: string;
    onChoose: (asset: WalkingAsset) => void; onFocus: (point: [number, number]) => void;
}) {
    const [mode, setMode] = useState('');
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [limit, setLimit] = useState(6);
    const { transit } = context;
    const stopTypes = [...new Set(transit.stops.map(stop => stop.agency))];
    const routeNames = useMemo(() => new Map(transit.routes.map(route => [route.id, route.name])), [transit.routes]);
    const candidates = useMemo(() => {
        const term = search.trim().toLowerCase();
        const from: [number, number] = [origin[1], origin[0]];
        return transit.stops.filter(stop => (!mode || stop.agency === mode) &&
            [stop.name, stop.code, ...stop.routes.map(id => routeNames.get(id))].some(value => value?.toLowerCase().includes(term)))
            .sort((a, b) => metres(from, [a.lng, a.lat]) - metres(from, [b.lng, b.lat]));
    }, [mode, search, transit.stops, origin, routeNames]);
    const selected = candidates.find(stop => stop.id === selectedId);
    const destinationId = selected ? transitDestinationId(selected) : null;
    const destination = destinationId ? assets.find(asset => asset.id === destinationId) : null;
    const scheduled = selected ? scheduledService(transit, selected, at) : null;
    const agencyName = (agency: string) => TRANSIT_LABELS[agency] ?? agency;
    const shuttleSource = context.sources.find(source => source.id === 'um-shuttle');
    const feedSource = selected ? context.sources.find(source =>
        (selected.agency === 'um-shuttle' && source.id === 'um-shuttle') || source.name.endsWith(`· ${selected.agency}`)) : null;
    return <details className="tg-details">
        <summary><span className="inline-flex items-center gap-2"><BusFront size={18} aria-hidden /> Walk to transit</span></summary>
        <div className="tg-stack mt-3 text-sm">
            {context.area_id === 'um-campus' && shuttleSource && <a href={shuttleSource.url} target="_blank" rel="noreferrer"
                className="inline-flex min-h-11 items-center font-bold underline">UM campus shuttle information</a>}
            {transit.stops.length ? <>
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="tg-label">Service
                        <select className="tg-input w-full" value={mode} onChange={e => { setMode(e.target.value); setLimit(6); setSelectedId(''); }}>
                            <option value="">All services</option>
                            {stopTypes.map(agency => <option value={agency} key={agency}>{agencyName(agency)}</option>)}
                        </select>
                    </label>
                    <label className="tg-label">Find a stop or route
                        <input className="tg-input w-full" value={search} onChange={e => { setSearch(e.target.value); setLimit(6); setSelectedId(''); }} />
                    </label>
                </div>
                {candidates.length ? <ul className="divide-y divide-slate-200">
                    {candidates.slice(0, limit).map(stop => <li key={stop.id}>
                        <button type="button" aria-expanded={selected?.id === stop.id} className="min-h-11 w-full py-2 text-left"
                            onClick={() => setSelectedId(current => current === stop.id ? '' : stop.id)}>
                            <strong>{stop.name}</strong><span className="block text-xs text-slate-600">{agencyName(stop.agency)}{stop.code ? ` · ${stop.code}` : ''}</span>
                        </button>
                        {selected?.id === stop.id && <div className="mb-3 space-y-2 rounded-lg bg-slate-50 p-2">
                            <p>{stop.routes.map(route => routeNames.get(route)).filter(Boolean).join(' · ') || 'Routes unavailable for this stop.'}</p>
                            <p className="text-xs">{stop.boarding === 'yes' ? 'Wheelchair boarding indicated by the feed.' :
                                stop.boarding === 'no' ? 'Wheelchair boarding unavailable according to the feed.' : 'Boarding accessibility needs checking.'}</p>
                            {feedSource?.data_at && <p className="text-xs">Feed date {feedSource.data_at} · check with the operator before travelling.</p>}
                            {scheduled?.items.length ? <>
                                <h3 className="font-bold">Scheduled service · Malaysia time</h3>
                                <ul className="space-y-1">{scheduled.items.map((item, i) => <li key={i}>
                                    {item.frequency
                                        ? `About every ${Math.max(1, Math.round(item.frequency.interval_seconds / 60))} min, ${serviceTime(item.frequency.start)}–${serviceTime(item.frequency.end)}`
                                        : serviceTime(item.time)}
                                    {' · '}{item.headsign || routeNames.get(item.route_id) || 'Scheduled service'}
                                </li>)}</ul>
                            </> : <p className="text-xs">{scheduled?.inCalendar
                                ? 'No departures scheduled in the next six hours from the selected time.'
                                : 'No timetable for the selected day in this snapshot.'}</p>}
                            {stop.approach && <p className="text-xs">The walk ends at the nearby mapped footpath. Check the final connection and boarding point on site.</p>}
                            {!destination && <p className="text-xs">A walking access point has yet to be matched.</p>}
                            <div className="grid gap-2 sm:grid-cols-2">
                                <button type="button" className="tg-btn" onClick={() => onFocus([stop.lat, stop.lng])}><MapPin size={16} aria-hidden /> Show on map</button>
                                {destination && <button type="button" className="tg-btn tg-btn-primary" onClick={() => onChoose(destination)}>
                                    {stop.approach ? 'Walk to nearby footpath' : 'Plan a walk to transit'}
                                </button>}
                            </div>
                        </div>}
                    </li>)}
                </ul> : <p role="status">No stops match this search.</p>}
                {candidates.length > limit && <button type="button" className="tg-btn" onClick={() => setLimit(value => value + 6)}>More stops</button>}
                <a href="https://developer.data.gov.my/realtime-api/gtfs-static.en" target="_blank" rel="noreferrer" className="text-xs underline">Prasarana via data.gov.my · CC BY 4.0</a>
            </> : <p role="status">Timetable stops are unavailable for this area.</p>}
        </div>
    </details>;
}
