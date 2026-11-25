import type { JourneyRoute, WalkingData, WalkingAsset, WalkingNeeds, VerificationTarget } from './walking.ts';
import type { Profile, PathEdge, HazardReport } from './routing.ts';
import { requiresStepFreeProfile, indexHazards } from './routing.ts';
import type { MaintenanceDefect } from './types.ts';
import { placeHours } from './place-details.ts';
import { evidenceFor, isConfirmed } from './verification.ts';
import { assetFacts, arrivalFields, barrierAtAsset, barrierOnEdge, conditionState, edgeRestrictions, observedEdge, requiredEdgeFields, CONDITION_LABELS, type RouteBarrier, type ConditionState } from './route-conditions.ts';

type Counts = Record<ConditionState, number>;
const counts = (): Counts => ({ checked: 0, reported: 0, overdue: 0, mapped: 0, estimated: 0, unknown: 0 });

export function journeyTargets(route: JourneyRoute) {
    return new Set([route.destination.id, route.entrance.id, ...route.rest_stops.map(rest => rest.id), ...(route.start_asset_id ? [route.start_asset_id] : []),
        ...(route.errand_stops ?? []).flatMap(stop => [stop.destination.id, stop.entrance.id])]);
}
export function reportsOnJourney(route: JourneyRoute, reports: MaintenanceDefect[]) {
    const assets = journeyTargets(route), edges = new Set(route.edge_ids);
    return reports.filter(report => report.asset_id ? assets.has(report.asset_id) : report.edge_id != null && edges.has(report.edge_id));
}

/** Readiness is evidence, not a numerical safety score or an accessibility guarantee. */
export function journeyReadiness(route: JourneyRoute, profile: Profile, needs: WalkingNeeds, edges: PathEdge[], data: WalkingData, hazards: HazardReport[], reports: MaintenanceDefect[], at = route.arrival_at) {
    const path = new Map(edges.map(edge => [edge.id, edge])), indexed = indexHazards(hazards);
    const checks = counts(), barriers: RouteBarrier[] = [];
    const latestDates: string[] = [], expiryDates: string[] = [];
    const stepStates: ConditionState[] = [];
    const input = { profile, needs, departure_at: route.departure_at };
    const stepFree = needs.step_free || requiresStepFreeProfile(profile);
    const remember = (type: VerificationTarget, id: string | number, field: string, value?: unknown, estimated = false) => {
        const evidence = evidenceFor(data.verifications, type, id, at)[field];
        const state = conditionState(evidence, value, estimated);
        checks[state]++;
        if (evidence) {
            latestDates.push(evidence.observed_at);
            if (state === 'checked' && evidence.valid_until) expiryDates.push(evidence.valid_until);
        }
        return state;
    };
    let knownSteps = false;
    for (const id of new Set(route.edge_ids)) {
        const source = path.get(id);
        if (!source) { checks.unknown++; stepStates.push('unknown'); continue; }
        const edge = observedEdge(source, data.verifications, at);
        const kind = edge.is_crossing ? 'crossing' : 'path';
        const fields = requiredEdgeFields(edge, input, route.mode, at, data.verifications);
        for (const field of new Set([...fields, 'has_steps', ...(edge.is_crossing ? ['has_kerb_ramp'] : [])])) {
            const value = (edge as unknown as Record<string,unknown>)[field];
            const state = remember(kind, id, field, value, (field.startsWith('shade_') && edge.shade_source !== 'audited') || (field === 'lit_ratio' && edge.lighting_source !== 'audited'));
            if (field === 'has_steps' || field === 'has_kerb_ramp') {
                stepStates.push(state);
                if ((field === 'has_steps' && value === true) || (field === 'has_kerb_ramp' && value === false)) knownSteps = true;
            }
        }
        barriers.push(...edgeRestrictions(edge, { ...input, departure_at: at }, data.verifications, route.mode, indexed.get(id) ?? []).map(issue => barrierOnEdge(edge, issue)));
    }
    const assets = new Map(data.assets.map(asset => [asset.id, asset]));
    const entrance = assets.get(route.entrance.id);
    const requiredAssets = new Map<string, WalkingAsset>();
    const start = route.start_asset_id && assets.get(route.start_asset_id);
    if (start) requiredAssets.set(start.id,start);
    if (entrance && !route.return_walk) requiredAssets.set(entrance.id, entrance);
    else if (!route.return_walk && !route.community_id && !route.errand_returns) { checks.unknown++; stepStates.push('unknown'); }
    for (const asset of [...route.rest_stops, ...(route.errand_stops ?? []).map(stop => stop.entrance)]) {
        const current = assets.get(asset.id);
        if (current) requiredAssets.set(current.id, current);
        else checks.unknown++;
    }
    for (const asset of requiredAssets.values()) {
        const { values, evidence } = assetFacts(asset, data, at);
        for (const field of new Set([...arrivalFields(asset, input, !!evidence.lift_available), 'step_free'])) {
            const state = remember(asset.kind === 'entrance' ? 'entrance' : 'facility', asset.id, field, values[field]);
            if (field === 'step_free' || field === 'lift_available') {
                stepStates.push(state);
                if (values[field] === false) knownSteps = true;
            }
            if (field !== 'opening_hours' && values[field] === false && (field !== 'step_free' || stepFree))
                barriers.push(barrierAtAsset(asset, field, 'Recorded condition conflicts with the journey', data, at));
        }
        for (const hazard of hazards.filter(h => h.asset_id === asset.id && h.status !== 'fixed')) {
            if (hazard.kind === 'blocked' || (stepFree && ['lift_out','no_ramp'].includes(hazard.kind)))
                barriers.push({ ...barrierAtAsset(asset, hazard.kind === 'lift_out' ? 'lift_available' : 'available',
                    'Active report affects this access point', data, at), state: hazard.status === 'verified' ? 'checked' : 'reported' });
        }
    }
    const currentDestination = assets.get(route.destination.id) ?? route.destination;
    const hours = route.return_walk || route.community_id || route.errand_stops ? null : placeHours(currentDestination, route.arrival_at, data.verifications);
    const lift = entrance ? assetFacts(entrance, data, at).evidence.lift_available : undefined;
    const liftMapped = entrance ? assetFacts(entrance, data, at).values.lift_available : undefined;
    const reportsHere = reportsOnJourney(route, reports).filter(r => r.status !== 'fixed' && !r.dismissed_at && r.kind !== 'check_requested');
    const pendingFields = Object.entries(checks).filter(([state]) => state !== 'checked').reduce((sum, [, n]) => sum + n, 0);
    // Never certify step-free end-to-end when the path start is an approximate connection.
    const approximateStart = route.steps?.[0]?.kind === 'connection';
    return {
        checks, pendingFields, barriers: barriers.slice(0, 8), activeReports: reportsHere,
        stepFree: knownSteps ? 'barriers' as const : stepStates.length > 0 && stepStates.every(s => s === 'checked') && !approximateStart && !route.community_id
            ? 'checked' as const : 'needs-checking' as const,
        hours, lift: { state: conditionState(lift, liftMapped), value: lift?.value ?? liftMapped },
        lastObservation: latestDates.sort().at(-1) ?? null,
        nextReview: expiryDates.sort()[0] ?? null,
        mappedCoverPercent: route.length_m > 0 ? Math.round(Math.max(0, Math.min(1, 1 - route.unsheltered_m / route.length_m)) * 100) : 0,
        incomplete: route.suitability !== 'green' || pendingFields > 0 || reportsHere.length > 0 || barriers.length > 0,
        entranceChecked: !!entrance && isConfirmed(assetFacts(entrance, data, at).evidence, 'path_connection') && assetFacts(entrance, data, at).values.path_connection === true,
        routeLabels: CONDITION_LABELS,
    };
}
