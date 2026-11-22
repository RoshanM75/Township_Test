import { planJourney } from './journeys.ts';
import { evidenceFor, openingAt } from './verification.ts';
import type { PlanningInput, WalkingData, WalkingAsset } from './walking.ts';
import type { HazardReport, PathEdge, PathNode } from './routing.ts';

export const FACILITY_LABELS = { rest: 'Seats', toilet: 'Toilets', water: 'Drinking water', shelter: 'Shelters' } as const;
export type FacilityKind = keyof typeof FACILITY_LABELS;

const FACILITY_FACTS: Record<FacilityKind, Array<[string, string, string]>> = {
    rest: [['armrests', 'Armrests available', 'Seat without armrests'], ['backrest', 'Backrest available', 'Seat without a backrest']],
    toilet: [['accessible_toilet', 'Accessible toilet', 'Toilet access marked unsuitable']],
    water: [['water_available', 'Drinking water available', 'Drinking water unavailable']],
    shelter: [['sheltered', 'Sheltered facility', 'No shelter recorded']],
};

export function facilityDetails(asset: WalkingAsset, data: WalkingData, at: string) {
    const checks = evidenceFor(data.verifications, 'facility', asset.id, at);
    const details = (FACILITY_FACTS[asset.kind as FacilityKind] ?? []).map(([field, yes, no]) => {
        const check = checks[field];
        const label = check?.status === 'verified' ? 'checked' : check?.status === 'reported' ? 'reported' : 'mapped';
        const value = check?.value ?? asset.properties[field];
        if (check?.status === 'stale') return `${yes} · check overdue`;
        if (typeof value !== 'boolean') return `${yes} · unknown`;
        return `${value ? yes : no} · ${label}`;
    });
    const hours = checks.opening_hours;
    const time = hours?.value ?? asset.properties.opening_hours;
    if (hours?.status === 'stale') details.push('Hours check overdue');
    else if (typeof time === 'string') details.push(`${hours?.status === 'verified' ? 'Checked hours' : 'Recorded hours'} · ${time}`);
    return details;
}

export function findFacilities(nodes: PathNode[], edges: PathEdge[], data: WalkingData,
    request: Omit<PlanningInput, 'destination' | 'entrance_id'>, kind: FacilityKind, hazards: HazardReport[] = [],ids?:string[]) {
    return data.assets.filter(a => a.kind === kind&&(!ids||ids.includes(a.id))).map(asset => {
        const plan = planJourney(nodes, edges, data, { ...request, destination: asset }, hazards, null, ['direct']);
        let route = plan.routes.direct ?? null;
        const at = route?.arrival_at ?? request.departure_at;
        const checks = evidenceFor(data.verifications, 'facility', asset.id, at);
        const facts = { ...asset.properties, ...Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, v.value])) };
        const required = ['available', 'path_connection', 'opening_hours', ...(request.needs.step_free || request.profile === 'wheelchair' ? ['step_free'] : []),
            ...(kind === 'rest' ? [request.profile === 'wheelchair' ? 'wheelchair_space' : 'has_seat'] : []),
            ...(kind === 'water' ? ['water_available'] : []), ...(kind === 'shelter' ? ['sheltered'] : []),
            ...(kind === 'toilet' && (request.needs.step_free || request.profile === 'wheelchair') ? ['accessible_toilet'] : [])];
        const missing = required.filter(f => checks[f]?.status !== 'verified');
        const unavailable = required.some(field => field !== 'opening_hours' && facts[field] === false) || openingAt(facts.opening_hours, at) === false;
        if (unavailable || (request.needs.verified_only && missing.length)) route = null;
        return { asset, route, details: facilityDetails(asset, data, at), checked: !missing.length && !unavailable, note: unavailable ? 'Reported unavailable or closed at arrival'
            : missing.length ? 'Mapped facility · availability needs checking' : 'Current facility checks available', reasons: plan.reasons };
    }).sort((a, b) => (a.route?.total_min ?? Infinity) - (b.route?.total_min ?? Infinity));
}

export function facilityName(asset: WalkingAsset) { return asset.name || FACILITY_LABELS[asset.kind as FacilityKind] || 'Mapped facility'; }
