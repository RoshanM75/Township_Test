import { forecastAt, type WalkingWeather } from './comfort.ts';
import { environmentSegments } from './environment.ts';
import type { ResidentLabel } from './resident-language.ts';
import type { Mode, PathEdge } from './routing.ts';
import { placeSearchText, type JourneyRoute, type VerificationRecord, type WalkingAsset } from './walking.ts';
import { metres, projectPoint } from './walking-geometry.ts';

export const ROUTE_MODES: Mode[] = ['direct', 'sheltered', 'coolest', 'safest'];
export const routeLabel = (mode: Mode, night: boolean, fastest: Mode = 'direct'): ResidentLabel =>
    mode === fastest ? 'Quickest' : mode === 'direct' ? 'Direct route' : mode === 'sheltered' ? 'More shelter'
        : mode === 'coolest' ? 'More shade' : night ? 'Better lit' : 'Crossings';

export function residentPlaceName(place: WalkingAsset) {
    const station = String(place.properties.station_ref ?? '');
    const name = place.name;
    if (/^n[uo][ -]?sentral$/i.test(name) && place.category === 'shopping') return 'NU Sentral';
    if (place.kind !== 'transit') return name;
    if (/\bpasar seni\b/i.test(name)) {
        if (/\b(?:KG16|MRT)\b/i.test(`${name} ${station}`)) return 'Pasar Seni MRT';
        if (/\b(?:KJ14|LRT)\b/i.test(`${name} ${station}`)) return 'Pasar Seni LRT';
    }
    if (/^kl sentral$/i.test(name)) {
        const sourceName = String(place.properties.osm_name ?? '');
        if (/\b(?:MR1|monorail)\b/i.test(sourceName)) return 'KL Sentral Monorail';
        if (/^KJ15\b/i.test(sourceName)) return 'KL Sentral LRT';
    }
    if (/^pudu$/i.test(name) || (/\bpudu\b/i.test(name) && /\b(?:AG10|SP10|LRT)\b/i.test(`${name} ${station}`))) return 'Pudu LRT';
    return name;
}

function searchName(value: string) {
    return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function searchResidentPlaces(places: WalkingAsset[], query: string, featured: string[], connected: ReadonlySet<string>) {
    const term = searchName(query);
    const words = term.split(' ');
    const ranks = new Map(featured.map((id, index) => [id, index]));
    return places.flatMap(place => {
        const label = searchName(residentPlaceName(place));
        const text = searchName(`${label} ${placeSearchText(place)}`);
        if (!words.every(word => text.includes(word))) return [];
        return [{ place, label, match: !term ? 0 : label === term ? 0 : label.startsWith(term) ? 1 : label.includes(term) ? 2 : 3 }];
    }).sort((a, b) => a.match - b.match || Number(connected.has(b.place.id)) - Number(connected.has(a.place.id)) ||
        (ranks.get(a.place.id) ?? Infinity) - (ranks.get(b.place.id) ?? Infinity) || a.label.localeCompare(b.label))
        .map(result => result.place);
}

export const walkMinutes = (route: JourneyRoute) => Math.max(1, Math.ceil(route.total_min));
export const roofMetres = (route: JourneyRoute) => Math.max(0, Math.round(route.length_m - route.unsheltered_m));

export function routeRoofLines(route: JourneyRoute, edges: PathEdge[], records: VerificationRecord[]): [number, number][][] {
    const ids = new Set(route.edge_ids);
    const covered = new Set(environmentSegments(edges.filter(edge => ids.has(edge.id)), records, route.departure_at, 'cover')
        .filter(segment => segment.value === true && segment.source !== 'reported').map(segment => segment.id));
    return (route.steps ?? []).flatMap(step => step.edge_id !== undefined && covered.has(step.edge_id) && step.coordinates.length > 1
        ? [step.coordinates] : []);
}

export function walkWeather(weather: WalkingWeather | null, departure: string, minutes: number) {
    const first = forecastAt(weather, departure);
    if (!first || !weather) return null;
    const from = Date.parse(departure), to = from + minutes * 60000;
    const hours = weather.hourly.filter(hour => {
        const start = Date.parse(hour.time);
        return start < to && start + 3600000 > from;
    });
    if (hours.some(hour => (hour.rain_probability ?? 0) >= 50 || (hour.precipitation_mm ?? 0) > 0)) return 'rain';
    if (hours.some(hour => (hour.feels_like_c ?? 0) >= 32)) return 'heat';
    return null;
}

export type NearbyFacility = 'toilet' | 'rest' | 'clinic';
export const nearbyFacility = (place: WalkingAsset, type: NearbyFacility) => type === 'clinic'
    ? place.kind === 'destination' && place.category === 'healthcare' : place.kind === type;

export function nearestFacilities(assets: WalkingAsset[], type: NearbyFacility, [lat, lng]: [number, number]) {
    return assets.filter(asset => nearbyFacility(asset, type)).map(asset => ({
        asset, distance: metres([lng, lat], [asset.lng, asset.lat]),
    })).filter(item => item.distance <= 1500).sort((a, b) => a.distance - b.distance).slice(0, 5);
}

/** Match a usable GPS fix to a nearby section of the plan, preserving progress on return walks. */
export function routeStepAt(route: JourneyRoute, point: [number, number], previous: number) {
    const steps = route.steps ?? [];
    let best = null, distance = 26;
    for (let index = Math.max(0, previous); index < steps.length; index++) {
        const step = steps[index];
        if (step.coordinates.length < 2 || step.kind === 'rest') continue;
        const line = step.coordinates.map(([lat, lng]): [number, number] => [lng, lat]);
        const fix = projectPoint(line, [point[1], point[0]]);
        // Favour the first matching section where outward and return lines overlap.
        if (fix.distance < distance - 1) {
            best = index;
            distance = fix.distance;
        }
    }
    return best;
}
