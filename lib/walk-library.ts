import { isWalkingProfile, type Profile, type PathEdge } from './routing.ts';
import type { JourneyRoute, WalkingNeeds, WalkingData, VerificationRecord, WalkingAsset } from './walking.ts';
import type { TrackState } from './walk-tracking.ts';
import { projectPoint } from './walking-geometry.ts';
import { isPilot,type PilotId } from './pilots.ts';

export const LIBRARY_KEY = 'townshipgo:walk-library:v1';
export type ComfortRating = 'easier' | 'as_expected' | 'harder' | 'not_sure';
export interface WalkFeedback { heat: ComfortRating; effort: ComfortRating; access: ComfortRating; notes: string; recorded_at: string }
export interface ConditionUpdate { id: string; kind: 'blocked' | 'light_out' | 'seat_unavailable'; target_type: 'path' | 'crossing' | 'facility'; target_id: string;
    area_id?:PilotId;dataset_id?:string;
    name: string; observed_at: string; valid_until: string; notes: string; shared_at?: string; report_id?: string }
export type PackCheck = Pick<VerificationRecord, 'id' | 'created_at' | 'target_type' | 'target_id' | 'status' | 'observed_at' | 'valid_until' | 'attributes'>;
export interface WalkPack { version: 1; id: string; saved_at: string; data_at: string; title: string; route: JourneyRoute; profile: Profile;
    area_id?:PilotId;dataset_id?:string;
    needs: WalkingNeeds; origin: [number, number]; network_snapshot_at?: string | null; facilities: WalkingAsset[]; edges: PathEdge[]; checks: PackCheck[] }
export interface CompletedWalk { id: string; title: string; started_at: string; finished_at: string; profile: Profile; active_ms: number; track: TrackState;
    area_id?:PilotId;
    planned_m: number; planned_min: number; feedback: WalkFeedback | null }
export interface WalkLibrary { version: 1; packs: WalkPack[]; history: CompletedWalk[]; updates: ConditionUpdate[] }
export interface WalkSession { id: string; pack: WalkPack; started_at: string; elapsed_ms: number; track: TrackState; restored?: boolean }
export const DRAFT_KEY = 'townshipgo:active-walk:v1';
export function readWalkDraft(storage: Pick<Storage, 'getItem'>): WalkSession | null {
    try {
        const draft = JSON.parse(storage.getItem(DRAFT_KEY) || 'null');
        return draft && packValid(draft.pack) && typeof draft.id === 'string' && Number.isFinite(draft.elapsed_ms) && draft.elapsed_ms >= 0
            && instant(draft.started_at) && trackValid(draft.track) ? { ...draft, restored: true, track: { ...draft.track, last: null } } : null;
    } catch { return null; }
}
export const emptyLibrary = (): WalkLibrary => ({ version: 1, packs: [], history: [], updates: [] });

const coordinate = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const trackValid = (track: TrackState) => track && Array.isArray(track.fixes) && ['distance_m','pace_distance_m','moving_s','rejected'].every(k => Number.isFinite(track[k as keyof TrackState]) && Number(track[k as keyof TrackState]) >= 0);
function packValid(p: WalkPack) {
    return p && p.version === 1 && (p.area_id===undefined||isPilot(p.area_id)) && typeof p.id === 'string' && typeof p.title === 'string' && coordinate(p.origin)
        && isWalkingProfile(p.profile) && instant(p.saved_at) && instant(p.data_at) && p.needs && p.route
        && Array.isArray(p.route.coordinates) && p.route.coordinates.length >= 2 && p.route.coordinates.every(coordinate)
        && ['length_m','total_min','rest_min'].every(k => Number.isFinite(p.route[k as keyof JourneyRoute]))
        && p.route.entrance && typeof p.route.entrance.name === 'string' && p.route.destination && typeof p.route.destination.name === 'string'
        && Array.isArray(p.edges) && p.edges.every(e => Number.isFinite(e.id) && Array.isArray(e.geometry))
        && Array.isArray(p.checks) && p.checks.every(c => c && c.attributes && typeof c.attributes === 'object' && instant(c.observed_at))
        && Array.isArray(p.facilities) && p.facilities.every(a => a && coordinate([a.lat,a.lng]) && typeof a.name === 'string');
}

export function readLibrary(storage: Pick<Storage, 'getItem'>): { library: WalkLibrary; warning: string | null } {
    try {
        const raw = storage.getItem(LIBRARY_KEY);
        if (!raw) return { library: emptyLibrary(), warning: null };
        const data = JSON.parse(raw);
        if (data.version !== 1 || ![data.packs, data.history, data.updates].every(Array.isArray)) throw Error();
        if (!data.packs.every(packValid)
            || !data.history.every((h: CompletedWalk) => (h.area_id===undefined||isPilot(h.area_id)) && typeof h.id === 'string' && typeof h.title === 'string' && instant(h.finished_at) && Number.isFinite(h.active_ms) && trackValid(h.track))
            || !data.updates.every((u: ConditionUpdate) => (u.area_id===undefined||isPilot(u.area_id)) && ['blocked', 'light_out', 'seat_unavailable'].includes(u.kind) && typeof u.target_id === 'string' && Number.isFinite(Date.parse(u.valid_until)))) throw Error();
        return { library: data, warning: null };
    } catch { return { library: emptyLibrary(), warning: 'Saved walks could not be read. Existing device data has not been overwritten.' }; }
}

export function writeLibrary(library: WalkLibrary, storage: Pick<Storage, 'setItem'>) {
    if (library.packs.length > 20 || library.history.length > 100 || library.updates.length > 100) throw new Error('Your walking collection is full. Remove an older item in Saved and try again.');
    try { storage.setItem(LIBRARY_KEY, JSON.stringify(library)); }
    catch { throw new Error('This browser could not save the item. Free some device storage or download a walk pack instead.'); }
}

export function createWalkPack(route: JourneyRoute, profile: Profile, needs: WalkingNeeds, origin: [number, number], edges: PathEdge[], data: WalkingData, now = new Date().toISOString(), networkSnapshot: string | null = null): WalkPack {
    const ids = new Set(route.edge_ids);
    const facilities = data.assets.filter(a => ['rest','shelter','water','toilet'].includes(a.kind) && (route.rest_stops.some(s => s.id === a.id)
        || projectPoint(route.coordinates.map(([lat,lng]) => [lng,lat]), [a.lng,a.lat]).distance <= 100));
    const assets = new Set([route.entrance.id, ...facilities.map(a => a.id)]);
    return { version: 1, id: crypto.randomUUID(), saved_at: now, data_at: data.as_of,area_id:data.area_id??'elmina',dataset_id:data.dataset_id, title: route.return_walk ? `Return walk · ${Math.ceil(route.total_min)} min` : route.destination.name,
        route, profile, needs, origin, network_snapshot_at: networkSnapshot, facilities, edges: edges.filter(e => ids.has(e.id)),
        checks: data.verifications.filter(v => (v.target_type === 'path' || v.target_type === 'crossing') ? ids.has(Number(v.target_id)) : assets.has(v.target_id))
            .map(({ id,created_at,target_type,target_id,status,observed_at,valid_until,attributes }) => ({ id,created_at,target_type,target_id,status,observed_at,valid_until,attributes })) };
}

export function updateRecord(update: ConditionUpdate): VerificationRecord {
    return { id: update.id, target_type: update.target_type, target_id: update.target_id, status: 'reported', observed_at: update.observed_at,
        valid_until: update.valid_until, reviewer: 'Personal condition report', method: 'site_visit', source_ref: '', notes: update.notes,
        attributes: update.kind === 'blocked' ? { path_open: false } : update.kind === 'light_out' ? { lit_ratio: 0 } : { available: false }, created_at: update.observed_at };
}

export function withPersonalUpdates(data: WalkingData, updates: ConditionUpdate[], at: string): WalkingData {
    const instant = Date.parse(at);
    const area=data.area_id??'elmina';
    return { ...data, verifications: [...data.verifications, ...updates.filter(u => (u.area_id??'elmina')===area
        &&(!u.dataset_id||!data.dataset_id||u.dataset_id===data.dataset_id)&&Date.parse(u.observed_at)<=instant).map(updateRecord)] };
}
