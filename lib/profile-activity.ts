import type { CompletedWalk, ConfirmedVisit, WalkPack } from './walk-library.ts';
import { isPilot, type PilotId } from './pilots.ts';
import { residentPlaceName } from './resident-walking.ts';

// An illustrative distance-based estimate, not a measurement of an individual's stride.
export const METRES_PER_ESTIMATED_STEP = 0.7;
// MITI's i-ESG Starter Kit, section 3.2.6.3, printed page 70.
// Passenger car factor (from US EPA 2022): vehicle-km, not passenger-km.
export const CAR_CO2E_KG_PER_KM = 0.20;
export const CAR_EMISSIONS_REFERENCE = 'https://www.miti.gov.my/miti/resources/IESG/Booklet_Stater_Kit.pdf';

export type ActivityPeriod = 'day' | 'week' | 'month';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
// All three pilots use contemporary Malaysia time (UTC+08:00, no DST).
const MYT_OFFSET_MS = 8 * HOUR_MS;

export function activityWindow(period: ActivityPeriod, now: number) {
    const local = new Date(now + MYT_OFFSET_MS);
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const monday = midnight - (local.getUTCDay() + 6) % 7 * DAY_MS;
    const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
    const nextMonth = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1);
    const start = period === 'week' ? monday : period === 'month' ? monthStart : midnight;
    const end = period === 'week' ? monday + 7 * DAY_MS : period === 'month' ? nextMonth : midnight + DAY_MS;
    return { start_ms: start - MYT_OFFSET_MS, end_ms: end - MYT_OFFSET_MS };
}

function distinctCompletedWalks(history: readonly CompletedWalk[], now: number) {
    const seen = new Set<string>();
    return history.filter(walk => {
        const finished = Date.parse(walk.finished_at);
        if (!Number.isFinite(finished) || finished > now || seen.has(walk.id)) return false;
        seen.add(walk.id);
        return true;
    });
}

const nonnegative = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
const stepModes = new Set(['everyday', 'senior', 'cane_walker', 'stroller']);

export function profileActivity(history: readonly CompletedWalk[], period: ActivityPeriod, now: number) {
    const range = activityWindow(period, now);
    const walks = distinctCompletedWalks(history, now).filter(walk => {
        const finished = Date.parse(walk.finished_at);
        return finished >= range.start_ms && finished < range.end_ms;
    });
    // Use recorded GPS distance only. No estimate is made from planned distance,
    // route length, or a timer-only walk.
    const distanceWalks = walks.filter(walk => nonnegative(walk.track.distance_m) > 0);
    const steppingWalks = distanceWalks.filter(walk => stepModes.has(walk.profile));
    const distance = distanceWalks.reduce((sum, walk) => sum + walk.track.distance_m, 0);
    const steppingDistance = steppingWalks.reduce((sum, walk) => sum + walk.track.distance_m, 0);
    return {
        ...range,
        completed_walks: walks.length,
        distance_walks: distanceWalks.length,
        active_ms: walks.reduce((sum, walk) => sum + nonnegative(walk.active_ms), 0),
        distance_m: distanceWalks.length ? distance : null,
        estimated_steps: steppingWalks.length ? Math.round(steppingDistance / METRES_PER_ESTIMATED_STEP) : null,
        potential_car_co2e_kg: distanceWalks.length ? distance / 1000 * CAR_CO2E_KG_PER_KM : null,
        // Wheelchair (and any unknown historical mobility mode) still contributes
        // to recorded distance and time, but not to a step estimate.
        has_nonstepping_distance: steppingWalks.length < distanceWalks.length,
    };
}

export function isConfirmedVisit(value: unknown): value is ConfirmedVisit {
    if (!value || typeof value !== 'object') return false;
    const visit = value as Partial<ConfirmedVisit>;
    return typeof visit.place_id === 'string' && !!visit.place_id.trim()
        && typeof visit.name === 'string' && !!visit.name.trim();
}

// The finish-walk screen can offer this named destination for confirmation.
// Return walks and community shortcut endpoints are not automatically visits.
export function destinationForVisit(pack: WalkPack): ConfirmedVisit | null {
    const { route } = pack;
    if (route.return_walk || route.community_id || !route.destination || route.destination.kind === 'entrance') return null;
    const destination = route.destination;
    const visit = { place_id: destination.external_id || destination.id, name: residentPlaceName(destination).trim() };
    return isConfirmedVisit(visit) ? visit : null;
}

export interface FrequentPlace extends ConfirmedVisit {
    area: PilotId;
    visits: number;
}

export function frequentlyVisitedPlaces(history: readonly CompletedWalk[], now: number): FrequentPlace[] {
    const places = new Map<string, FrequentPlace & { last_at: number }>();
    for (const walk of distinctCompletedWalks(history, now)) {
        if (!isConfirmedVisit(walk.confirmed_visit)) continue;
        const visit = walk.confirmed_visit;
        const area = isPilot(walk.area_id) ? walk.area_id : 'elmina';
        const key = JSON.stringify([area, visit.place_id]);
        const finished = Date.parse(walk.finished_at);
        const previous = places.get(key);
        if (!previous) places.set(key, { ...visit, area, visits: 1, last_at: finished });
        else {
            previous.visits++;
            if (finished > previous.last_at) {
                previous.last_at = finished;
                previous.name = visit.name;
            }
        }
    }
    return [...places.values()].sort((a, b) => b.visits - a.visits || b.last_at - a.last_at || a.name.localeCompare(b.name))
        .map(({ area, place_id, name, visits }) => ({ area, place_id, name, visits }));
}
