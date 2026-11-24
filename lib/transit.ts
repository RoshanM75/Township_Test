import type { PilotContext, TransitCalendar, TransitStop } from './pilots.ts';
import type { WalkingAsset } from './walking.ts';

export const TRANSIT_LABELS: Record<string, string> = {
    'rapid-rail-kl': 'Rapid KL rail',
    'rapid-bus-kl': 'Rapid KL bus',
    'rapid-bus-mrtfeeder': 'MRT feeder bus',
    'um-shuttle': 'UM campus shuttle',
};

const MALAYSIA_OFFSET = 8 * 3600000;
const DAY = 86400000;

function runs(calendar: TransitCalendar | undefined, midnight: number) {
    if (!calendar) return false;
    const date = new Date(midnight);
    const key = date.toISOString().slice(0, 10).replaceAll('-', '');
    return calendar.exceptions[key] ?? (key >= calendar.from && key <= calendar.to && !!calendar.weekdays[date.getUTCDay()]);
}

export interface ScheduledService {
    route_id: string;
    headsign: string;
    time: string;
    frequency?: { start: string; end: string; interval_seconds: number };
}

export function scheduledService(transit: PilotContext['transit'], stop: TransitStop, instant: string) {
    const at = Date.parse(instant);
    const midnight = Math.floor((at + MALAYSIA_OFFSET) / DAY) * DAY;
    if (!Number.isFinite(midnight)) return { inCalendar: false, items: [] };
    const items: ScheduledService[] = [];
    let inCalendar = false;
    const iso = (time: number) => new Date(time).toISOString();
    for (const date of [midnight - DAY, midnight, midnight + DAY]) {
        const startOfService = date - MALAYSIA_OFFSET;
        for (const pattern of stop.patterns ?? []) {
            if (!runs(transit.calendars?.[pattern.service_id], date)) continue;
            if (date === midnight) inCalendar = true;
            const timeAt = (seconds: number) => startOfService + seconds * 1000;
            const common = { route_id: pattern.route_id, headsign: pattern.headsign };
            for (const departure of pattern.times) {
                const time = timeAt(departure);
                if (time >= at && time < at + 6 * 3600000) items.push({ ...common, time: iso(time) });
            }
            for (const [first, last, interval] of pattern.windows) {
                const start = timeAt(first), end = timeAt(last);
                if (end > at && start < at + 6 * 3600000) items.push({ ...common, time: iso(Math.max(start, at)),
                    frequency: { start: iso(start), end: iso(end), interval_seconds: interval } });
            }
        }
    }
    const ordered = [...new Map(items.map(item => [JSON.stringify(item), item])).values()]
        .sort((a, b) => a.time.localeCompare(b.time));
    return { inCalendar, items: ordered.slice(0, 5) };
}

export function transitDestinationId(stop: TransitStop) {
    return stop.walking_asset_id ?? (stop.approach ? `gtfs:${stop.id}` : null);
}

/** An approximate link ends on the mapped path. GTFS cannot verify crossing or boarding access. */
export function transitApproachAssets(context: PilotContext, includeUnlinkedRail = false): WalkingAsset[] {
    return context.transit.stops.flatMap(stop => {
        if (stop.walking_asset_id || (!stop.approach && (!includeUnlinkedRail || stop.agency !== 'rapid-rail-kl'))) return [];
        const { approach } = stop;
        const id = `gtfs:${stop.id}`;
        const base: WalkingAsset = {
            id, external_id: id, parent_id: null, kind: 'transit', category: 'transport', name: stop.name,
            lat: stop.lat, lng: stop.lng, source: 'gtfs',
            source_ref: context.sources.find(source => stop.agency === 'um-shuttle' && source.id === 'um-shuttle')?.url
                ?? 'https://developer.data.gov.my/realtime-api/gtfs-static.en',
            properties: { gtfs_stop: true, ...(stop.code ? { station_ref: stop.code } : {}) },
            edge_id: null, edge_fraction: null, connection_distance_m: null, anchor_lat: null, anchor_lng: null,
        };
        return approach ? [base, {
            ...base, id: `${id}:approach`, external_id: `${id}:approach`, parent_id: id, kind: 'entrance',
            name: `Footpath near ${stop.name}`, lat: approach.lat, lng: approach.lng,
            edge_id: approach.edge_id, edge_fraction: approach.fraction, connection_distance_m: 0,
            anchor_lat: approach.lat, anchor_lng: approach.lng,
            properties: { connection_model: 'approximate_approach', stop_offset_m: Math.round(approach.distance_m) },
        }] : [base];
    });
}
