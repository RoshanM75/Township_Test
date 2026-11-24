import { DEFAULT_ORIGIN, DESTINATIONS } from './precinct.ts';
import type { PilotWalkingDetails } from './pilot-walking-details.ts';

export type PilotId = 'pasar-seni' | 'um-campus' | 'elmina';
// The Pages builder derives this public flag from the validated source files.
// The server version checks its imported datasets through its API instead.
export const KL_PILOT_AVAILABLE = process.env.NEXT_PUBLIC_SITE_MODE !== 'pages'
    || process.env.NEXT_PUBLIC_KL_PILOT_AVAILABLE === 'true';
const UM_PILOT_AVAILABLE = process.env.NEXT_PUBLIC_SITE_MODE !== 'pages'
    || process.env.NEXT_PUBLIC_UM_PILOT_AVAILABLE === 'true';
export const DEFAULT_PILOT: PilotId = KL_PILOT_AVAILABLE ? 'pasar-seni' : UM_PILOT_AVAILABLE ? 'um-campus' : 'elmina';
export const KL_CORE_BOUNDS: [number, number, number, number] = [3.133, 101.685, 3.157, 101.708];
export const PILOTS = {
    'pasar-seni': { id: 'pasar-seni' as const, name: 'Central Kuala Lumpur', short_name: 'Central KL pilot',
        description: 'Explore Pasar Seni, Masjid Jamek, Bangsar, Brickfields, Perdana Botanical Gardens, Pudu and Bukit Bintang.',
        bounds: [3.116, 101.665, 3.162, 101.720] as [number, number, number, number],
        centre: [3.1425, 101.6955] as [number, number], origin_label: 'Pasar Seni walking start', edge_offset: 1000000000, asset_offset: 2000000000,
        role: 'pilot', district: 'W.P. Kuala Lumpur', preferred_names: ['Central Market', 'Pasar Seni', 'Petaling Street', 'Masjid Jamek', 'Jamek Mosque', 'Dataran Merdeka'],
    },
    'um-campus': { id: 'um-campus' as const, name: 'Universiti Malaya campus', short_name: 'UM campus',
        description: 'Explore mapped campus paths, entrances and shelters around Universiti Malaya.',
        bounds: [3.109, 101.634, 3.136, 101.671] as [number, number, number, number],
        centre: [3.1212, 101.6535] as [number, number], origin_label: 'UM campus walking start', edge_offset: 3000000000, asset_offset: 4000000000,
        role: 'pilot', district: 'W.P. Kuala Lumpur', preferred_names: ['Main Library', 'Dewan Kuliah 3', 'Dewan Tunku Canselor', 'Faculty of Science', 'Perdanasiswa', 'Universiti'],
    },
    elmina: { id: 'elmina' as const, name: 'Elmina bridges example', short_name: 'Elmina example',
        description: 'Learn the planner with the original two mapped bridge destinations.',
        bounds: [3.16, 101.49, 3.20, 101.53] as [number, number, number, number],
        centre: DEFAULT_ORIGIN, origin_label: 'Elmina sample start', edge_offset: 0, asset_offset: 0,
        role: 'example', district: 'Petaling', preferred_names: DESTINATIONS.map(d => d.name),
    },
};

export function isPilot(value: unknown): value is PilotId {
    return typeof value === 'string' && Object.hasOwn(PILOTS, value);
}
export function isPilotAvailable(area: PilotId) {
    return area === 'elmina' || (area === 'um-campus' ? UM_PILOT_AVAILABLE : KL_PILOT_AVAILABLE);
}
export function pilotFromParams(params: Pick<URLSearchParams, 'get'>): PilotId {
    const requested = params.get('area');
    if (isPilot(requested)) return requested;
    // Existing shared bridge links continue to open their original example.
    return DESTINATIONS.some(d => d.id === params.get('destId')) ? 'elmina' : DEFAULT_PILOT;
}
export function pointInPilot(point: [number, number], area: PilotId) {
    return pointInBounds(point, PILOTS[area].bounds);
}

export function pointInBounds(point: [number, number], [south, west, north, east]: readonly number[]) {
    return point[0]>=south && point[0]<=north && point[1]>=west && point[1]<=east;
}

export interface SourceCoverage { id: string; name: string; url: string; license: string; status: 'loaded' | 'partial' | 'unavailable' | 'not_loaded';
    fetched_at: string | null; data_at: string | null; records: number; note: string; archive_url?: string | null }
export interface TransitPattern {
    route_id: string;
    service_id: string;
    headsign: string;
    times: number[];
    windows: Array<[start: number, end: number, interval: number]>;
}
export interface TransitCalendar {
    from: string;
    to: string;
    weekdays: boolean[];
    exceptions: Record<string, boolean>;
}
export interface TransitStop {
    id: string; name: string; lat: number; lng: number; agency: string;
    routes: string[]; parent_station: string; location_type: string;
    code?: string;
    boarding?: 'yes' | 'no';
    patterns?: TransitPattern[];
    walking_asset_id?: string;
    approach?: { lat: number; lng: number; edge_id: number; fraction: number; distance_m: number };
}
export interface PilotNeighbourhood {
    id: string;
    name: string;
    coordinates: [number, number];
    source_ref: string;
    // A mapped start belongs to a real pedestrian component near the landmark.
    start?: { coordinates: [number, number]; edge_id: number };
    local_paths: number;
    connected_to_core: boolean;
}
export interface PilotContext {
    area_id: PilotId; dataset_id: string; built_at: string;
    origin: { coordinates: [number, number]; label: string; source_ref: string };
    featured_ids: string[];
    coverage: { nodes: number; paths: number; crossings: number; components: number; largest_component_paths: number; destinations: number; facilities: number; entrances: number; approximate_approaches: number; unconnected_places: number };
    sources: SourceCoverage[];
    transit: {
        stops: TransitStop[]; routes: Array<{ id: string; name: string; agency: string }>; service_dates: string[];
        calendars?: Record<string, TransitCalendar>;
    };
    demand: { data_at: string | null; stations: Array<{ name: string; entries: number; exits: number }>; note: string };
    demographics: { district: string; year: string | null; population: number | null; older_population: number | null; older_share: number | null; note: string };
    landmarks: Array<{ id: string; name: string; description: string; url: string; coordinates: [number, number] }>;
    environment: { scenes: Array<{ id: string; date: string; cloud_percent: number | null; collection: string; bbox: number[]; url: string }>; note: string };
    walking_details?: PilotWalkingDetails;
    neighbourhoods?: PilotNeighbourhood[];
}
