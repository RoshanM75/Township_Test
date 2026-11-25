import { isConfirmed, evidenceFor, malaysiaHour, openingAt } from './verification.ts';
import { requiresStepFreeProfile, slotForHour, type PathEdge, type HazardReport, type Mode } from './routing.ts';
import type { WalkingAsset, WalkingData, PlanningInput, VerificationTarget, FieldEvidence, ObservationValue } from './walking.ts';

export type ConditionState = 'checked' | 'reported' | 'overdue' | 'mapped' | 'estimated' | 'unknown';
export interface RouteBarrier {
    target_type: VerificationTarget;
    target_id: string;
    name: string;
    point: [number, number];
    field: string;
    reason: string;
    state: ConditionState;
}

export const CONDITION_LABELS: Record<string, string> = {
    path_open: 'Path passability', has_steps: 'Steps', slope_pct: 'Slope', surface_rating: 'Surface',
    has_kerb_ramp: 'Kerb ramps', clear_width_m: 'Clear width', crossing_type: 'Crossing type',
    has_tactile: 'Tactile paving', audible_signal: 'Audible signal', lit_ratio: 'Lighting',
    covered: 'Roof cover', shade_morning: 'Morning shade', shade_midday: 'Midday shade', shade_afternoon: 'Afternoon shade',
    available: 'Availability', path_connection: 'Path connection', step_free: 'Step-free access', lift_available: 'Lift availability',
    opening_hours: 'Opening hours', has_seat: 'Seating', wheelchair_space: 'Wheelchair space', backrest: 'Backrest',
    armrests: 'Armrests', sheltered: 'Shelter', accessible_toilet: 'Toilet accessibility', water_available: 'Drinking water',
    public_access: 'Public access terms', fee: 'Fee', connection_length_m: 'Measured connection',
};
export function conditionState(fact?: FieldEvidence, mapped?: unknown, estimated = false): ConditionState {
    if (fact) return fact.status === 'verified' ? 'checked' : fact.status === 'reported' ? 'reported' : fact.status === 'stale' ? 'overdue' : 'mapped';
    return mapped == null ? 'unknown' : estimated ? 'estimated' : 'mapped';
}

export function assetFacts(asset: WalkingAsset, data: WalkingData, at: string) {
    const evidence = evidenceFor(data.verifications, asset.kind === 'entrance' ? 'entrance' : 'facility', asset.id, at);
    const values = { ...asset.properties, ...Object.fromEntries(Object.entries(evidence).map(([key, v]) => [key, v.value])) };
    return { evidence, values };
}

export function observedEdge(edge: PathEdge, records: WalkingData['verifications'], at: string): PathEdge {
    const evidence = evidenceFor(records, edge.is_crossing ? 'crossing' : 'path', edge.id, at);
    const values = Object.fromEntries(Object.entries(evidence).map(([key, v]) => [key, v.value]));
    const result = { ...edge, ...values } as PathEdge;
    if (evidence.covered && evidence.covered.status !== 'verified') result.covered = null;
    const shade = `shade_${slotForHour(malaysiaHour(at))}`;
    if (isConfirmed(evidence, shade)) result.shade_source = 'audited';
    if (isConfirmed(evidence, 'lit_ratio')) result.lighting_source = 'audited';
    if (result.covered === true) {
        result.shade_morning = result.shade_midday = result.shade_afternoon = 1;
        if (isConfirmed(evidence, 'covered')) result.shade_source = 'audited';
    }
    return result;
}

type Requirements = Pick<PlanningInput, 'profile' | 'needs' | 'departure_at'>;

export function requiredEdgeFields(edge: PathEdge, input: Requirements, mode: Mode, at = input.departure_at, records: WalkingData['verifications'] = []) {
    const e = evidenceFor(records, edge.is_crossing ? 'crossing' : 'path', edge.id, at);
    const needed = ['path_open', 'surface_rating', 'slope_pct'];
    if (input.needs.min_clear_width_m !== null) needed.push('clear_width_m');
    if (input.needs.step_free || requiresStepFreeProfile(input.profile)) needed.push('has_steps');
    if (edge.is_crossing) {
        needed.push('crossing_type');
        if (input.needs.require_tactile_crossings) needed.push('has_tactile');
        if (input.needs.require_audible_crossings) needed.push('audible_signal');
        if (input.needs.step_free || requiresStepFreeProfile(input.profile)) needed.push('has_kerb_ramp');
    }
    const slot = slotForHour(malaysiaHour(input.departure_at));
    if (mode === 'coolest' && slot !== 'night' && !(edge.covered && isConfirmed(e, 'covered'))) needed.push(`shade_${slot}`);
    if (mode === 'sheltered') needed.push('covered');
    if (slot === 'night') needed.push('lit_ratio');
    return needed;
}

export function arrivalFields(asset: WalkingAsset, input: Requirements, liftRecorded = false) {
    if (['community_path_endpoint','errand_return_endpoint'].includes(String(asset.properties.connection_model))) return [];
    const stepFree = input.needs.step_free || requiresStepFreeProfile(input.profile);
    return ['available', 'path_connection', 'opening_hours', ...(stepFree ? ['step_free'] : []),
        ...(stepFree && liftRecorded ? ['lift_available'] : []),
        ...(asset.kind === 'rest' ? [input.profile === 'wheelchair' ? 'wheelchair_space' : 'has_seat'] : []),
        ...(asset.kind === 'water' ? ['water_available'] : []), ...(asset.kind === 'shelter' ? ['sheltered'] : []),
        ...(asset.kind === 'toilet' && stepFree ? ['accessible_toilet'] : [])];
}
export function usableAccess(asset: WalkingAsset, facts: ReturnType<typeof assetFacts>, input: Requirements) {
    const { evidence, values } = facts;
    const { needs } = input;
    const stepFree = needs.step_free || requiresStepFreeProfile(input.profile);
    if (['private', 'permission'].includes(String(values.public_access))) return false;
    if (stepFree && (values.step_free === false || values.lift_available === false)) return false;
    if (needs.min_clear_width_m !== null && typeof values.clear_width_m === 'number' && values.clear_width_m < needs.min_clear_width_m) return false;
    return !arrivalFields(asset, input, !!evidence.lift_available).some(f => f !== 'opening_hours' && values[f] === false);
}

/** Same eligibility rules used for normal routing, diagnostics and the operator comparison. */
export function edgeRestrictions(edge: PathEdge, input: Requirements, records: WalkingData['verifications'], mode: Mode, hazards: HazardReport[]) {
    const { needs, profile } = input;
    const facts = evidenceFor(records, edge.is_crossing ? 'crossing' : 'path', edge.id, input.departure_at);
    const stepFree = needs.step_free || requiresStepFreeProfile(profile);
    const issues = new Map<string, { field: string; reason: string; state: ConditionState }>();
    const add = (field: string, reason: string, state?: ConditionState) => {
        if (!issues.has(field)) issues.set(field, { field, reason, state: state ?? conditionState(facts[field], (edge as unknown as Record<string,unknown>)[field]) });
    };
    const reportState = (h: HazardReport) => h.status === 'verified' ? 'checked' as const : 'reported' as const;
    if (facts.path_open?.value === false) add('path_open', 'Path recorded as closed or blocked');
    if (stepFree && edge.has_steps) add('has_steps', 'Steps conflict with step-free access');
    if (stepFree && edge.is_crossing && edge.has_kerb_ramp === false) add('has_kerb_ramp', 'Kerb ramp recorded as missing');
    if (needs.min_clear_width_m !== null && (typeof edge.clear_width_m !== 'number' || edge.clear_width_m < needs.min_clear_width_m || facts.clear_width_m?.status === 'stale'))
        add('clear_width_m', `Current clear width of at least ${needs.min_clear_width_m} m needed`);
    if (edge.is_crossing && needs.require_tactile_crossings && (edge.has_tactile !== true || facts.has_tactile?.status === 'stale'))
        add('has_tactile', 'Required tactile paving needs checking');
    if (edge.is_crossing && needs.require_audible_crossings && (edge.audible_signal !== true || facts.audible_signal?.status === 'stale'))
        add('audible_signal', 'Required audible signal needs checking');
    if ((needs.avoid_uneven_surfaces && edge.surface_rating != null && edge.surface_rating > 1) || (profile === 'wheelchair' && edge.surface_rating === 3))
        add('surface_rating', 'Recorded surface conflicts with walking requirements');
    if (edge.slope_pct != null && Math.abs(edge.slope_pct) > Math.min(needs.max_slope_pct, profile === 'wheelchair' ? 8.33 : 100))
        add('slope_pct', 'Recorded slope exceeds walking requirements');
    if (needs.avoid_uncontrolled_crossings && edge.is_crossing && edge.crossing_type !== 'signalised' && edge.crossing_type !== 'zebra')
        add('crossing_type', 'Required controlled or marked crossing is missing or unknown');
    for (const h of hazards.filter(h => h.status !== 'fixed' && !h.asset_id)) {
        if (h.kind === 'blocked') add('path_open', 'Active blockage report', reportState(h));
        if (h.kind === 'no_ramp' && stepFree) add('has_kerb_ramp', 'Active missing-ramp report', reportState(h));
        if (h.kind === 'broken_surface' && (profile === 'wheelchair' || needs.avoid_uneven_surfaces)) add('surface_rating', 'Active damaged-surface report', reportState(h));
    }
    if (needs.verified_only) for (const field of requiredEdgeFields(edge, input, mode, input.departure_at, records)) {
        if (!isConfirmed(facts, field)) add(field, `Current check needed: ${CONDITION_LABELS[field] ?? field}`);
    }
    if (stepFree && edge.is_crossing && edge.has_kerb_ramp == null && needs.verified_only) add('has_kerb_ramp', 'Current kerb-ramp check needed');
    return [...issues.values()];
}

export function barrierOnEdge(edge: PathEdge, issue: ReturnType<typeof edgeRestrictions>[number]): RouteBarrier {
    const point = edge.geometry[Math.floor(edge.geometry.length / 2)];
    return { ...issue, target_type: edge.is_crossing ? 'crossing' : 'path', target_id: String(edge.id),
        name: edge.name || `Mapped footpath ${edge.id}`, point: [point[1], point[0]] };
}

export function barrierAtAsset(asset: WalkingAsset, field: string, reason: string, data: WalkingData, at: string): RouteBarrier {
    const { evidence, values } = assetFacts(asset, data, at);
    return { target_type: asset.kind === 'entrance' ? 'entrance' : 'facility', target_id: asset.id, name: asset.name,
        point: [asset.lat, asset.lng], field, reason, state: conditionState(evidence[field], values[field]) };
}

export function accessTerms(values: Record<string, ObservationValue>, at: string) {
    const access = ['public', 'customers', 'destination', 'permission', 'private'].includes(String(values.public_access)) ? String(values.public_access) : 'unknown';
    return { access, fee: typeof values.fee === 'boolean' ? values.fee : null, open: openingAt(values.opening_hours, at) };
}
