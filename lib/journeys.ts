import { buildGraph, buildRoute, evaluateEdge, indexHazards, MODE_WEIGHTS, PROFILES, slotForHour,
    type Graph, type PathEdge, type PathNode, type Mode, type HazardReport, type CostContext, type PathResult } from './routing.ts';
import { DEFAULT_NEEDS, type WalkingNeeds, type WalkingAsset, type WalkingData, type PlanningInput, type JourneyPlan, type JourneyRoute, type JourneyStep } from './walking.ts';
import { evidenceFor, isConfirmed, malaysiaHour, openingAt } from './verification.ts';
import { metres, pointAt, projectPoint } from './walking-geometry.ts';
import { splitPathAnchors, type PathAnchor } from './path-anchors.ts';
import { unavailableAssetIds } from './report-status.ts';
import type { CommunityRoute } from './community-routes.ts';
import { placeHours } from './place-details.ts';
import { groupShadeChecks, journeyShade, pathShade } from './route-shade.ts';
import type { SolarModel } from './solar-shade.ts';

const MODES: Mode[] = ['direct', 'coolest', 'sheltered', 'safest'];
// Suppress sub-millisecond spherical interpolation noise at exact rest boundaries.
const TIME_EPS = .001;
const FIELD_LABELS: Record<string, string> = { path_open: 'path condition', surface_rating: 'surface condition', has_steps: 'steps',
    slope_pct: 'slope', crossing_type: 'crossing type', has_kerb_ramp: 'kerb ramps', shade_morning: 'morning shade',
    shade_midday: 'midday shade', shade_afternoon: 'afternoon shade', lit_ratio: 'lighting', covered: 'roof cover',
    clear_width_m: 'clear width', has_tactile: 'tactile paving', audible_signal: 'audible signal' };

export function normaliseNeeds(value: unknown): WalkingNeeds {
    const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const number = (key: keyof WalkingNeeds, min: number, max: number) => typeof input[key] === 'number' && Number.isFinite(input[key])
        ? Math.max(min, Math.min(max, input[key] as number)) : DEFAULT_NEEDS[key] as number;
    return {
        step_free: input.step_free === true, verified_only: input.verified_only === true,
        avoid_uncontrolled_crossings: input.avoid_uncontrolled_crossings === true, require_rests: input.require_rests === true,
        avoid_uneven_surfaces: input.avoid_uneven_surfaces === true,
        min_clear_width_m: typeof input.min_clear_width_m === 'number' && Number.isFinite(input.min_clear_width_m)
            ? Math.max(.5, Math.min(3, input.min_clear_width_m)) : null,
        require_tactile_crossings: input.require_tactile_crossings === true,
        require_audible_crossings: input.require_audible_crossings === true,
        rest_backrest: input.rest_backrest === true, rest_armrests: input.rest_armrests === true, rest_shelter: input.rest_shelter === true,
        max_slope_pct: number('max_slope_pct', 0, 20), rest_interval_min: number('rest_interval_min', 1, 30),
        rest_duration_min: number('rest_duration_min', 1, 10), budget_min: number('budget_min', 5, 120),
        speed_mps: typeof input.speed_mps === 'number' && Number.isFinite(input.speed_mps) ? Math.max(0.3, Math.min(1.8, input.speed_mps)) : null,
    };
}

function assetFacts(asset: WalkingAsset, data: WalkingData, at: string) {
    const evidence = evidenceFor(data.verifications, asset.kind === 'entrance' ? 'entrance' : 'facility', asset.id, at);
    return { evidence, values: { ...asset.properties, ...Object.fromEntries(Object.entries(evidence).map(([key, v]) => [key, v.value])) } };
}

function arrivalFields(asset: WalkingAsset, input: PlanningInput, liftRecorded = false) {
    if (asset.properties.connection_model === 'community_path_endpoint') return [];
    const stepFree = input.needs.step_free || input.profile === 'wheelchair';
    return ['available', 'path_connection', 'opening_hours', ...(stepFree ? ['step_free'] : []), ...(stepFree && liftRecorded ? ['lift_available'] : []),
        ...(asset.kind === 'rest' ? [input.profile === 'wheelchair' ? 'wheelchair_space' : 'has_seat'] : []),
        ...(asset.kind === 'water' ? ['water_available'] : []), ...(asset.kind === 'shelter' ? ['sheltered'] : []),
        ...(asset.kind === 'toilet' && stepFree ? ['accessible_toilet'] : [])];
}

function usableAccess(asset: WalkingAsset, facts: ReturnType<typeof assetFacts>, input: PlanningInput) {
    const { evidence, values } = facts;
    const { needs } = input;
    const stepFree = needs.step_free || input.profile === 'wheelchair';
    if (stepFree && (values.step_free === false ||
        (evidence.lift_available?.status === 'verified' && values.lift_available === false))) return false;
    if (needs.min_clear_width_m !== null && typeof values.clear_width_m === 'number' &&
        values.clear_width_m < needs.min_clear_width_m) return false;
    return !arrivalFields(asset, input).some(f => f !== 'opening_hours' && values[f] === false);
}

function connectionLength(asset: WalkingAsset, facts: ReturnType<typeof assetFacts>) {
    const straight = asset.connection_distance_m ?? 0;
    return isConfirmed(facts.evidence, 'connection_length_m') && typeof facts.values.connection_length_m === 'number'
        ? Math.max(straight, facts.values.connection_length_m) : straight;
}

interface Prepared {
    graph: Graph;
    origin: number;
    offset: number;
    assets: Map<string, number>;
    originals: Map<number, PathEdge>;
    shade?: { model: SolarModel; checks: ReturnType<typeof groupShadeChecks>; edges: Map<number, PathEdge> };
}
function prepare(nodes: PathNode[], rawEdges: PathEdge[], data: WalkingData, input: PlanningInput, model?: SolarModel): Prepared | null {
    const projected = rawEdges.filter(e => e.pedestrian_access !== false && e.kind !== 'street').map(edge => {
        const evidence = evidenceFor(data.verifications, edge.is_crossing ? 'crossing' : 'path', edge.id, input.departure_at);
        const values = Object.fromEntries(Object.entries(evidence).map(([key, v]) => [key, v.value]));
        const result = { ...edge, ...values } as PathEdge;
        if (evidence.covered && evidence.covered.status !== 'verified') result.covered = null;
        const shade = `shade_${slotForHour(malaysiaHour(input.departure_at))}`;
        if (isConfirmed(evidence, shade)) result.shade_source = 'audited';
        if (isConfirmed(evidence, 'lit_ratio')) result.lighting_source = 'audited';
        if (result.covered === true) {
            result.shade_morning = result.shade_midday = result.shade_afternoon = 1;
            if (isConfirmed(evidence, 'covered')) result.shade_source = 'audited';
        }
        return result;
    });
    let closest: { edge: PathEdge; fraction: number; distance: number } | null = null;
    for (const edge of projected) {
        if (edge.geometry.length < 2) continue;
        const projection = projectPoint(edge.geometry, [input.origin[1], input.origin[0]]);
        if (!closest || projection.distance < closest.distance) closest = { edge, ...projection };
    }
    if (!closest || closest.distance > 50) return null;
    const anchors: PathAnchor[] = [{ key: 'origin', edge_id: closest.edge.id, fraction: closest.fraction }];
    for (const asset of data.assets) if (asset.edge_id !== null && asset.edge_fraction !== null) {
        anchors.push({ key: asset.id, edge_id: asset.edge_id, fraction: asset.edge_fraction });
    }
    const split = splitPathAnchors(nodes, projected, anchors);
    return { graph: buildGraph(split.nodes, split.edges), origin: split.anchors.get('origin')!, offset: closest.distance,
        assets: split.anchors, originals: new Map(projected.map(e => [Number(e.id), e])),
        shade: model && { model, checks: groupShadeChecks(data.verifications), edges: new Map(rawEdges.map(e => [Number(e.id), e])) } };
}

function missingFor(edge: PathEdge, input: PlanningInput, data: WalkingData, mode: Mode, validAt = input.departure_at) {
    const e = evidenceFor(data.verifications, edge.is_crossing ? 'crossing' : 'path', edge.id, validAt);
    const needed = ['path_open', 'surface_rating', 'slope_pct'];
    if (input.needs.min_clear_width_m !== null) needed.push('clear_width_m');
    if (input.needs.step_free || input.profile === 'wheelchair') needed.push('has_steps');
    if (edge.is_crossing) {
        needed.push('crossing_type');
        if (input.needs.require_tactile_crossings) needed.push('has_tactile');
        if (input.needs.require_audible_crossings) needed.push('audible_signal');
        if (input.needs.step_free || input.profile === 'wheelchair') needed.push('has_kerb_ramp');
    }
    const slot = slotForHour(malaysiaHour(input.departure_at));
    if (mode === 'coolest' && slot !== 'night' && !(edge.covered && isConfirmed(e, 'covered'))) needed.push(`shade_${slot}`);
    if (mode === 'sheltered') needed.push('covered');
    if (slot === 'night') needed.push('lit_ratio');
    return needed.filter(field => !isConfirmed(e, field)).map(field => FIELD_LABELS[field] ?? field);
}

interface Label {
    node: number; cost: number; elapsed: number; sinceRest: number; longest: number;
    via?: boolean; outbound?: Set<number>;
    previous?: Label; edge?: PathEdge; rest?: WalkingAsset; active: boolean;
}
class Queue {
    items: Label[] = [];
    push(value: Label) {
        const a = this.items; a.push(value); let i = a.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= a[i].cost) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
        const a = this.items, first = a[0], last = a.pop()!;
        if (a.length) { a[0] = last; let i = 0;
            for (;;) { const l = i * 2 + 1, r = l + 1; let m = i;
                if (l < a.length && a[l].cost < a[m].cost) m = l;
                if (r < a.length && a[r].cost < a[m].cost) m = r;
                if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
            }
        }
        return first;
    }
}

function search(prepared: Prepared, destination: number, entrance: WalkingAsset, data: WalkingData,
    input: PlanningInput, ctx: CostContext, returning = false, unavailable = new Set<string>()): { final: Label; ctx: CostContext } | { limited: true } | null {
    const speed = ctx.speedMps!, budget = input.needs.budget_min * 60, interval = input.needs.rest_interval_min * 60;
    const startSeconds = prepared.offset / speed;
    const endSeconds = returning ? startSeconds : connectionLength(entrance, assetFacts(entrance, data, input.departure_at)) / speed;
    const restNodes = new Map<number, WalkingAsset[]>();
    for (const asset of data.assets) if (asset.kind === 'rest' && prepared.assets.has(asset.id) && !unavailable.has(asset.id)) {
        const { evidence: e, values: v } = assetFacts(asset, data, input.departure_at);
        const required = ['available', 'path_connection', input.profile === 'wheelchair' ? 'wheelchair_space' : 'has_seat'];
        if (input.needs.step_free || input.profile === 'wheelchair') required.push('step_free');
        if (input.needs.rest_backrest) required.push('backrest');
        if (input.needs.rest_armrests) required.push('armrests');
        if (input.needs.rest_shelter) required.push('sheltered');
        if (!required.every(field => isConfirmed(e, field) && v[field] === true)) continue;
        const node = prepared.assets.get(asset.id)!;
        if (!restNodes.has(node)) restNodes.set(node, []); restNodes.get(node)!.push(asset);
    }
    const missing = new Map<number, string[]>();
    const permitted = new Map<number, boolean>();
    for (const edge of prepared.graph.edges.values()) {
        const id = edge.source_edge_id!, original = prepared.originals.get(id)!;
        if (permitted.has(id)) continue;
        const facts = evidenceFor(data.verifications, original.is_crossing ? 'crossing' : 'path', id, input.departure_at);
        const hazards = ctx.hazards.get(id) ?? [];
        const absent = missingFor(original, input, data, ctx.mode); missing.set(id, absent);
        const stepFree = input.needs.step_free || input.profile === 'wheelchair';
        const blocked = facts.path_open?.value === false || (stepFree && original.has_steps)
            || (stepFree && original.is_crossing && original.has_kerb_ramp === false)
            || (input.needs.min_clear_width_m !== null && (typeof original.clear_width_m !== 'number' ||
                original.clear_width_m < input.needs.min_clear_width_m || facts.clear_width_m?.status === 'stale'))
            || (original.is_crossing && input.needs.require_tactile_crossings &&
                (original.has_tactile !== true || facts.has_tactile?.status === 'stale'))
            || (original.is_crossing && input.needs.require_audible_crossings &&
                (original.audible_signal !== true || facts.audible_signal?.status === 'stale'))
            || (input.needs.avoid_uneven_surfaces && original.surface_rating != null && original.surface_rating > 1)
            || (original.slope_pct != null && Math.abs(original.slope_pct) > Math.min(input.needs.max_slope_pct, input.profile === 'wheelchair' ? 8.33 : 100))
            || (input.needs.avoid_uncontrolled_crossings && original.is_crossing && original.crossing_type !== 'signalised' && original.crossing_type !== 'zebra')
            || (input.needs.verified_only && absent.length > 0)
            || hazards.some(h => h.kind === 'blocked' || (stepFree && h.kind === 'no_ramp') || ((input.profile === 'wheelchair' || input.needs.avoid_uneven_surfaces) && h.kind === 'broken_surface'));
        permitted.set(id, !blocked);
    }
    const queue = new Queue(), fronts = new Map<string, Label[]>();
    const offer = (label: Label) => {
        if (returning && label.node === destination && !label.via) {
            label.via = true; label.outbound = new Set<number>();
            for (let p: Label | undefined = label; p; p = p.previous) if (p.edge) label.outbound.add(p.edge.source_edge_id!);
        }
        if (label.elapsed + endSeconds > budget + TIME_EPS || (input.needs.require_rests && label.sinceRest > interval + TIME_EPS)) return;
        const key = `${label.node}:${label.via ? 1 : 0}`;
        const old = (fronts.get(key) ?? []).filter(l => l.active);
        if (old.some(l => l.cost <= label.cost + 1e-7 && (!input.needs.require_rests || l.sinceRest <= label.sinceRest + 1e-7) && l.elapsed <= label.elapsed + 1e-7)) return;
        for (const l of old) if (label.cost <= l.cost && (!input.needs.require_rests || label.sinceRest <= l.sinceRest) && label.elapsed <= l.elapsed) l.active = false;
        fronts.set(key, [...old.filter(l => l.active), label]); queue.push(label);
    };
    offer({ node: prepared.origin, cost: startSeconds, elapsed: startSeconds, sinceRest: startSeconds, longest: startSeconds, active: true });
    const cache = new Map<number, ReturnType<typeof evaluateEdge>>();
    const solar = ctx.mode === 'coolest' && ctx.slot !== 'night' ? prepared.shade : undefined;
    const solarCost = new Map<string, number>();
    const departureAt = Date.parse(input.departure_at);
    const heatWeight = MODE_WEIGHTS[ctx.mode].heat * (ctx.heatMultiplier ?? 1);
    let examined = 0;
    while (queue.items.length) {
        const label = queue.pop(); if (!label.active) continue;
        if (++examined > 100000) return { limited: true };
        if (label.node === (returning ? prepared.origin : destination) && (!returning || label.via) && (!input.needs.require_rests || label.sinceRest + endSeconds <= interval + TIME_EPS)) return { final: label, ctx };
        for (const rest of input.needs.require_rests ? restNodes.get(label.node) ?? [] : []) {
            const atAnchor = new Date(Date.parse(input.departure_at) + label.elapsed * 1000).toISOString();
            const detour = connectionLength(rest, assetFacts(rest, data, atAnchor)) / speed;
            const arrivalAtRest = new Date(Date.parse(input.departure_at) + (label.elapsed + detour) * 1000).toISOString();
            const facts = assetFacts(rest, data, arrivalAtRest), { values, evidence } = facts;
            const required = ['available', 'path_connection', input.profile === 'wheelchair' ? 'wheelchair_space' : 'has_seat',
                ...(input.needs.step_free || input.profile === 'wheelchair' ? ['step_free'] : []),
                ...(input.needs.rest_backrest ? ['backrest'] : []), ...(input.needs.rest_armrests ? ['armrests'] : []), ...(input.needs.rest_shelter ? ['sheltered'] : [])];
            if (!required.every(f => isConfirmed(evidence, f) && values[f] === true) || openingAt(values.opening_hours, arrivalAtRest) === false) continue;
            if (label.sinceRest > TIME_EPS && (!input.needs.require_rests || label.sinceRest + detour <= interval + TIME_EPS)) {
                const seconds = detour * 2 + input.needs.rest_duration_min * 60;
                offer({ node: label.node, cost: label.cost + seconds, elapsed: label.elapsed + seconds, sinceRest: detour,
                    longest: Math.max(label.longest, label.sinceRest + detour), previous: label, rest, active: true, via: label.via, outbound: label.outbound });
            }
        }
        for (const { edge, to } of prepared.graph.adj.get(label.node) ?? []) {
            if (!permitted.get(edge.source_edge_id!)) continue;
            let evaluation = cache.get(edge.id);
            if (!evaluation) { evaluation = evaluateEdge(edge, ctx); cache.set(edge.id, evaluation); }
            if (evaluation.hard.length) continue;
            const seconds = evaluation.walk_s + evaluation.wait_s;
            let cost = evaluation.cost;
            if (solar && !ctx.hazards.get(edge.source_edge_id!)?.some(hazard => hazard.kind === 'no_shade')) {
                const original = solar.edges.get(edge.source_edge_id!)!;
                const forward = edge.from_node === label.node;
                // Minute buckets keep adjacent candidate arrivals reusable. The final itinerary
                // samples the full geometry in travel order, including waits and rests.
                const minute = Math.floor((departureAt + (label.elapsed + evaluation.wait_s) * 1000) / 60000);
                const key = `${edge.id}:${minute}:${forward}`;
                let timed = solarCost.get(key);
                if (timed === undefined) {
                    const records = solar.checks.get(`${original.is_crossing ? 'crossing' : 'path'}:${original.id}`) ?? [];
                    const samples = Math.min(5, Math.max(1, Math.ceil(edge.length_m / 15)));
                    let exposed = 0;
                    for (let i = 0; i < samples; i++) {
                        const fraction = (i + .5) / samples;
                        const point = pointAt(edge.geometry, forward ? fraction : 1 - fraction);
                        const reading = pathShade(original, records, minute * 60000 + fraction * evaluation.walk_s * 1000, point, solar.model);
                        if (reading.condition === 'sun' || reading.condition === 'unknown') exposed++;
                    }
                    timed = (evaluation.walk_s * exposed / samples - evaluation.sun_s) * heatWeight;
                    solarCost.set(key, timed);
                }
                cost += timed;
            }
            offer({ node: to, cost: label.cost + cost + (label.via && label.outbound?.has(edge.source_edge_id!) ? seconds * .8 : 0), elapsed: label.elapsed + seconds,
                sinceRest: label.sinceRest + seconds, longest: Math.max(label.longest, label.sinceRest + seconds),
                previous: label, edge, active: true, via: label.via, outbound: label.outbound });
        }
    }
    return null;
}

function summarise(prepared: Prepared, final: Label, entrance: WalkingAsset, input: PlanningInput,
    data: WalkingData, ctx: CostContext, returning = false): JourneyRoute {
    const steps: Label[] = []; for (let l: Label | undefined = final; l?.previous; l = l.previous) steps.push(l); steps.reverse();
    const path: PathResult = { nodes: [prepared.origin], edges: [] };
    for (const step of steps) if (step.edge) { path.nodes.push(step.node); path.edges.push(step.edge); }
    const result = buildRoute(prepared.graph, path, ctx), speed = ctx.speedMps!;
    const rests = steps.filter(l => l.rest).map(l => l.rest!);
    const restMetres = rests.reduce((sum, a) => sum + connectionLength(a, assetFacts(a, data, input.departure_at)) * 2, 0);
    const endMetres = returning ? prepared.offset : connectionLength(entrance, assetFacts(entrance, data, input.departure_at));
    const connectors = prepared.offset + endMetres + restMetres;
    const totalSeconds = final.elapsed + endMetres / speed;
    const arrival = new Date(Date.parse(input.departure_at) + totalSeconds * 1000).toISOString();
    const originalIDs = path.edges.map(e => e.source_edge_id!).filter((id, i, all) => i === 0 || id !== all[i - 1]);
    const evidence = [...new Set(originalIDs)].map(id => ({ edge_id: id, name: prepared.originals.get(id)?.name || `Footpath ${id}`,
        missing: missingFor(prepared.originals.get(id)!, input, data, ctx.mode, arrival) }));
    const unchecked = evidence.filter(e => e.missing.length > 0);
    const unverifiedCrossings = evidence.filter(e => prepared.originals.get(e.edge_id)?.is_crossing && e.missing.length > 0).length;
    const facts = assetFacts(entrance, data, arrival);
    const entranceMissing = (returning ? [] : arrivalFields(entrance, input, !!facts.evidence.lift_available))
        .filter(f => !isConfirmed(facts.evidence, f));
    const explanations: string[] = [];
    if (unchecked.length) explanations.push(`${unchecked.length} path segment${unchecked.length === 1 ? '' : 's'} need current checks.`);
    if (unverifiedCrossings) explanations.push(`${unverifiedCrossings} crossing${unverifiedCrossings === 1 ? '' : 's'} not fully checked.`);
    if (entranceMissing.length) explanations.push(`Access point checks needed: ${entranceMissing.map(f => f.replaceAll('_', ' ')).join(', ')}.`);
    if (entrance.source === 'gtfs') explanations.push('The selected footpath is near the stop. Check the final connection and boarding point on site.');
    if (!returning && openingAt(facts.values.opening_hours, arrival) === null) explanations.push('Opening hours at arrival are not confirmed.');
    if (returning) explanations.push('Returns to your starting point. Some paths may be retraced; the budget includes the return and all planned rests.');
    if (prepared.offset > 3) explanations.push('The connection from your start to the mapped path is approximate.');
    if (input.needs.require_rests) explanations.push(`Verified rests keep continuous walking within ${input.needs.rest_interval_min} minute${input.needs.rest_interval_min === 1 ? '' : 's'}.`);
    const unknownComfort = result.quality.assumed > 0 || result.quality.modelled > 0;
    if (unknownComfort) explanations.push('Shade or lighting includes mapped/modelled assumptions.');
    const restHoursUnknown = rests.some(a => {
        const f = assetFacts(a, data, arrival);
        return !isConfirmed(f.evidence, 'opening_hours') || openingAt(f.values.opening_hours, arrival) === null;
    });
    if (restHoursUnknown) explanations.push('Hours for a planned rest facility need confirmation.');
    const green = !unchecked.length && !entranceMissing.length && !restHoursUnknown && prepared.offset <= 3
        && (returning || openingAt(facts.values.opening_hours, arrival) === true);
    const coords: [number, number][] = [[...input.origin]];
    const trace: JourneyStep[] = [];
    const origin = prepared.graph.nodes.get(prepared.origin)!;
    if (prepared.offset > .01) trace.push({ kind: 'connection', name: 'Join the mapped path', coordinates: [input.origin, [origin.lat, origin.lng]], distance_m: prepared.offset, start_min: 0, end_min: prepared.offset / speed / 60 });
    let node = prepared.origin;
    for (const step of steps) {
        if (step.edge) {
            const line = step.edge.from_node === node ? step.edge.geometry : [...step.edge.geometry].reverse();
            trace.push({ kind: 'path', name: step.edge.name || `Footpath ${step.edge.source_edge_id}`, edge_id: step.edge.source_edge_id,
                coordinates: line.map(([lng, lat]) => [lat, lng]), distance_m: step.edge.length_m, wait_s: evaluateEdge(step.edge, ctx).wait_s, start_min: step.previous!.elapsed / 60, end_min: step.elapsed / 60 });
            coords.push(...line.map(([lng, lat]) => [lat, lng] as [number, number])); node = step.node;
        } else if (step.rest) {
            const p = prepared.graph.nodes.get(node)!;
            trace.push({ kind: 'rest', name: step.rest.name, asset_id: step.rest.id, coordinates: [[p.lat,p.lng],[step.rest.lat,step.rest.lng],[p.lat,p.lng]],
                distance_m: connectionLength(step.rest, assetFacts(step.rest, data, input.departure_at)) * 2, start_min: step.previous!.elapsed / 60, end_min: step.elapsed / 60 });
            coords.push([step.rest.lat, step.rest.lng], [p.lat, p.lng]);
        }
        if (returning && step.via && !step.previous?.via) trace.push({ kind: 'turn', name: 'Begin your return',
            coordinates: [coords.at(-1)!], distance_m: 0, start_min: step.elapsed / 60, end_min: step.elapsed / 60 });
    }
    coords.push([entrance.lat, entrance.lng]);
    if (endMetres > .01) trace.push({ kind: 'connection', name: returning ? 'Return to your starting point' : entrance.name,
        coordinates: [coords.at(-2)!, coords.at(-1)!], distance_m: endMetres, start_min: final.elapsed / 60, end_min: totalSeconds / 60 });
    const exposed = path.edges.reduce((n, edge) => n + edge.length_m * (1 - evaluateEdge(edge, ctx).shade), 0);
    const sun = prepared.shade && journeyShade(trace, input.departure_at, { ...prepared.shade, speed, assets: data.assets });
    const unsheltered = path.edges.reduce((n, e) => n + (e.covered === true ? 0 : e.length_m), 0);
    return { ...result, steps: trace, return_walk: returning, coordinates: coords, edge_ids: originalIDs, destination: input.destination, entrance,
        length_m: result.length_m + connectors, walk_min: result.walk_min + connectors / speed / 60,
        total_min: totalSeconds / 60, rest_min: rests.length * input.needs.rest_duration_min, rest_stops: rests,
        verified_rest_stops: rests.length, longest_without_rest_min: Math.max(final.longest, final.sinceRest + endMetres / speed) / 60,
        uncovered_m: sun ? sun.sun_m + sun.unknown_m : ctx.slot === 'night' ? 0 : exposed + connectors,
        ...(sun ? { sun_exposure: sun } : {}),
        unsheltered_m: unsheltered + connectors, unverified_crossings: unverifiedCrossings, unchecked_segments: unchecked.length,
        evidence_coverage: evidence.length ? (evidence.length - unchecked.length) / evidence.length : 0,
        suitability: green ? 'green' : 'yellow', explanations, evidence,
        departure_at: input.departure_at, arrival_at: new Date(Date.parse(input.departure_at) + totalSeconds * 1000).toISOString() };
}

export function planJourney(nodes: PathNode[], edges: PathEdge[], data: WalkingData,
    request: PlanningInput, hazards: HazardReport[] = [], feelsLike?: number | null, modes: Mode[] = MODES, solar?: SolarModel): JourneyPlan {
    const input = { ...request, needs: normaliseNeeds(request.needs) };
    if (!Number.isFinite(Date.parse(input.departure_at))) return { routes: {}, recommended: null, reasons: ['Choose a valid departure time.'] };
    const prepared = prepare(nodes, edges, data, input, solar);
    if (!prepared) return { routes: {}, recommended: null, reasons: ['Your start is more than 50 metres from a mapped pedestrian path.'] };
    const unavailable = unavailableAssetIds(hazards, input.needs.step_free || input.profile === 'wheelchair');
    if (unavailable.has(input.destination.id)) {
        return { routes: {}, recommended: null, reasons: ['A checked report says this place is currently unavailable.'] };
    }
    const entrances = input.destination.kind === 'destination' || input.destination.kind === 'transit'
        ? data.assets.filter(a => a.kind === 'entrance' && a.parent_id === input.destination.id) : [input.destination];
    const connected = entrances.filter(a => (!input.entrance_id || a.id === input.entrance_id) && prepared.assets.has(a.id));
    let candidates = connected.filter(a => !unavailable.has(a.id));
    if (!input.entrance_id && input.destination.kind === 'transit') {
        const mapped = candidates.filter(a => a.properties.connection_model === 'mapped_entrance');
        if (mapped.length) candidates = mapped;
    }
    if (!candidates.length) return { routes: {}, recommended: null, reasons: [connected.length
        ? 'A checked report says the matching access points are currently unavailable.'
        : 'This place has no mapped access point connected to the walking network.'] };
    const routes: JourneyPlan['routes'] = {};
    let searchLimited = false, closedAtArrival = false;
    const requestFacts = assetFacts(input.destination, data, input.departure_at);
    if (requestFacts.evidence.available?.status === 'verified' && requestFacts.values.available === false) {
        return { routes: {}, recommended: null, reasons: ['The current place check says it is unavailable.'] };
    }
    const accessCandidates = candidates.filter(entrance => usableAccess(entrance, assetFacts(entrance, data, input.departure_at), input));
    if (!accessCandidates.length) return { routes: {}, recommended: null, reasons: [
        'The mapped access points do not meet your selected entrance requirements. Try another place or review the recorded entrances.',
    ] };
    const speed = input.needs.speed_mps ?? PROFILES[input.profile].speed_mps;
    const slot = slotForHour(malaysiaHour(input.departure_at));
    const hasCover = [...prepared.graph.edges.values()].some(edge => edge.covered === true);
    for (const mode of modes) {
        if (mode === 'sheltered' && !hasCover) continue;
        let bestCost = Infinity;
        for (const entrance of accessCandidates) {
            const facts = assetFacts(entrance, data, input.departure_at);
            const { evidence } = facts;
            if (input.needs.verified_only && !arrivalFields(entrance, input, !!evidence.lift_available)
                .every(f => isConfirmed(evidence, f))) continue;
            const ctx: CostContext = { mode, profile: input.profile, slot, speedMps: speed,
                strictUnknown: input.needs.verified_only, hazards: indexHazards(hazards), heatMultiplier: feelsLike != null && feelsLike >= 32 ? 1.5 : 1 };
            const found = search(prepared, prepared.assets.get(entrance.id)!, entrance, data, input, ctx, false, unavailable);
            if (!found) continue;
            if ('limited' in found) { searchLimited = true; continue; }
            const route = summarise(prepared, found.final, entrance, input, data, ctx);
            if (mode === 'sheltered' && route.length_m - route.unsheltered_m < 1) continue;
            if (input.needs.verified_only && route.suitability !== 'green') continue;
            // An entrance's opening window must also cover actual arrival.
            const arrival = assetFacts(entrance, data, route.arrival_at);
            if (!usableAccess(entrance, arrival, input)) continue;
            if (openingAt(arrival.values.opening_hours, route.arrival_at) === false || placeHours(input.destination, route.arrival_at, data.verifications).open === false) { closedAtArrival = true; continue; }
            const rank = found.final.cost + (route.suitability === 'green' ? 0 : 100000);
            if (rank < bestCost) { routes[mode] = route; bestCost = rank; }
        }
    }
    const available = MODES.filter(m => routes[m] && !(slot === 'night' && m === 'coolest'));
    const standard = available.filter(mode => mode !== 'sheltered');
    const recommended = (standard.length ? standard : available).sort((a, b) => {
        const ra = routes[a]!, rb = routes[b]!;
        const score = (r: JourneyRoute) => (r.suitability === 'green' ? 0 : 10000) + r.unchecked_segments * 10
            + r.total_min + (slot === 'night' ? r.dark_m / 10 : r.uncovered_m / (feelsLike != null && feelsLike >= 32 ? 20 : 50));
        return score(ra) - score(rb);
    })[0] ?? null;
    const reasons = available.length ? [] : searchLimited ? ['The route search could not complete for these settings. No recommendation is available; try a smaller trip budget.'] : closedAtArrival ? ['The matching routes arrive outside the access points’ opening hours. Choose a different departure time or place.'] : [
        input.needs.require_rests ? `No connected route meets your ${input.needs.rest_interval_min}-minute interval with verified rest facilities.`
            : 'No connected route meets the selected needs and walking budget, or its access points are closed.',
        ...(input.needs.verified_only ? ['Current verification records are required for the path, crossings and access point.'] : []),
        ...(input.needs.min_clear_width_m !== null || input.needs.require_tactile_crossings || input.needs.require_audible_crossings
            ? ['Some paths or crossings may lack recorded width, tactile paving or audible signal information.'] : []),
    ];
    return { routes, recommended, reasons };
}

export function reachablePlaces(nodes: PathNode[], edges: PathEdge[], data: WalkingData,
    request: Omit<PlanningInput, 'destination'>, hazards: HazardReport[] = [],ids?:string[]) {
    return data.assets.filter(a => ['destination', 'transit', 'toilet', 'water'].includes(a.kind)&&(!ids||ids.includes(a.id))).map(destination => {
        const plan = planJourney(nodes, edges, data, { ...request, destination }, hazards, null, ['direct']);
        const route = plan.recommended ? plan.routes[plan.recommended]! : null;
        return { destination, route, reasons: plan.reasons };
    }).sort((a, b) => (a.route?.total_min ?? Infinity) - (b.route?.total_min ?? Infinity));
}

/** A single search spans both legs, so turning around never resets the rest clock.
 * Turning points are graph locations, not invented seats or destination entrances. */
export function planReturnWalk(nodes: PathNode[], edges: PathEdge[], data: WalkingData,
    request: Omit<PlanningInput, 'destination' | 'entrance_id'>, hazards: HazardReport[] = [], feelsLike?: number | null,
    solar?: SolarModel, modes: Mode[] = MODES): JourneyPlan {
    const needs = normaliseNeeds(request.needs);
    if (!Number.isFinite(Date.parse(request.departure_at))) return { routes: {}, recommended: null, reasons: ['Choose a valid departure time.'] };
    const speed = needs.speed_mps ?? PROFILES[request.profile].speed_mps;
    const radius = speed * needs.budget_min * 60 / 2;
    const fractions = [.3, .65, .9, ...(needs.require_rests ? [Math.min(.98, needs.rest_interval_min / needs.budget_min * .95)] : [])];
    const candidates: Array<{ key: string; edge: PathEdge; fraction: number; lat: number; lng: number; distance: number; bearing: number }> = [];
    for (const edge of edges.filter(e => e.pedestrian_access !== false && e.kind !== 'street' && e.geometry.length >= 2)) {
        const projection = projectPoint(edge.geometry, [request.origin[1], request.origin[0]]);
        if (projection.distance > radius) continue;
        // Mid-path turning points allow useful short walks on long ways. Never turn in the middle of a crossing or steps.
        const samples = edge.is_crossing || edge.kind === 'steps' ? [0, 1] : [0, .25, .5, .75, 1,
            ...fractions.flatMap(f => [projection.fraction - radius * f / edge.length_m, projection.fraction + radius * f / edge.length_m])];
        for (const fraction of [...new Set(samples.filter(f => Number.isFinite(f) && f >= 0 && f <= 1).map(f => Math.round(f * 1e8) / 1e8))]) {
            const [lng,lat] = pointAt(edge.geometry, fraction), distance = metres([request.origin[1],request.origin[0]],[lng,lat]);
            if (distance < 5 || distance > radius) continue;
            candidates.push({ key: `${edge.id}:${fraction}`, edge, fraction, lat, lng, distance,
                bearing: Math.atan2(lat-request.origin[0],(lng-request.origin[1])*Math.cos(request.origin[0]*Math.PI/180)) });
        }
    }
    const picked = new Map<string, typeof candidates[number]>();
    for (let sector = 0; sector < 4; sector++) for (const fraction of fractions) {
        const centre = -Math.PI + (sector + .5) * Math.PI / 2;
        const best = candidates.filter(n => Math.abs(Math.atan2(Math.sin(n.bearing - centre), Math.cos(n.bearing - centre))) <= Math.PI / 4)
            .sort((a, b) => Math.abs(a.distance - radius * fraction) - Math.abs(b.distance - radius * fraction))[0];
        if (best) picked.set(best.key, best);
    }
    const turns: WalkingAsset[] = [...picked.values()].map(({ key, edge, fraction, lat, lng }) => {
        return { id: `turn:${key}`, external_id: null, parent_id: null, kind: 'entrance', category: 'other', name: 'Mapped turning point',
            lat, lng, source: 'osm', source_ref: '', properties: {}, edge_id: edge.id, edge_fraction: fraction,
            connection_distance_m: 0, anchor_lat: lat, anchor_lng: lng };
    });
    if (!turns.length) return { routes: {}, recommended: null, reasons: ['No mapped return walk fits this budget near your start. Try another start or a longer budget.'] };
    const destination: WalkingAsset = { ...turns[0], id: 'return:start', name: 'Return to your starting point',
        kind: 'destination', lat: request.origin[0], lng: request.origin[1], edge_id: null, edge_fraction: null };
    const finish = { ...destination, kind: 'entrance' as const, name: 'Your starting point' };
    const input: PlanningInput = { ...request, destination, needs };
    const extended = { ...data, assets: [...data.assets, ...turns] };
    const prepared = prepare(nodes, edges, extended, input, solar);
    if (!prepared) return { routes: {}, recommended: null, reasons: ['Your start is more than 50 metres from a mapped pedestrian path.'] };
    const routes: JourneyPlan['routes'] = {};
    const slot = slotForHour(malaysiaHour(request.departure_at));
    for (const mode of modes.filter(m => m !== 'sheltered' && !(slot === 'night' && m === 'coolest'))) {
        let best = Infinity;
        const ctx: CostContext = { mode, profile: input.profile, slot, speedMps: speed, strictUnknown: needs.verified_only,
            hazards: indexHazards(hazards), heatMultiplier: feelsLike != null && feelsLike >= 32 ? 1.5 : 1 };
        for (const turn of turns) {
            const found = search(prepared, prepared.assets.get(turn.id)!, finish, extended, input, ctx, true, unavailableAssetIds(hazards, needs.step_free || input.profile === 'wheelchair'));
            if (!found || 'limited' in found) continue;
            const route = summarise(prepared, found.final, finish, input, extended, ctx, true);
            if (route.total_min < .25 || (needs.verified_only && route.suitability !== 'green')) continue;
            const rank = (route.suitability === 'green' ? 0 : 10000) + (needs.budget_min - route.total_min) * 5
                + (mode === 'coolest' ? route.uncovered_m : mode === 'safest' ? route.dark_m : 0) / 200;
            if (rank < best) { best = rank; routes[mode] = route; }
        }
    }
    const recommended = (slot === 'night' && routes.safest ? 'safest' : routes.direct ? 'direct' : Object.keys(routes)[0] ?? null) as Mode | null;
    return { routes, recommended, reasons: recommended ? [] : ['No return walk meets your current walking needs, continuous rest interval and total budget. Your requirements have not been relaxed.'] };
}


export function planCommunityJourney(nodes: PathNode[], edges: PathEdge[], data: WalkingData,
    request: Omit<PlanningInput, 'destination' | 'entrance_id'>, route: CommunityRoute,
    hazards: HazardReport[] = [], solar?: SolarModel): JourneyPlan {
    const path = route.path;
    if (route.status !== 'verified' || !path || route.dataset_id !== data.dataset_id ||
        !route.valid_until || Date.parse(route.valid_until) <= Date.parse(request.departure_at)) {
        return { routes: {}, recommended: null, reasons: ['This community route needs a current field check before it can be used for navigation.'] };
    }
    if (openingAt(route.opening_hours, request.departure_at) !== true) {
        return { routes: {}, recommended: null, reasons: ['The community path is outside its checked public access hours at your departure.'] };
    }
    const [lat, lng] = path.coordinates.at(-1)!;
    const end: WalkingAsset = { id: `community-end:${route.id}`, external_id: null, parent_id: null,
        kind: 'entrance', category: 'other', name: route.title, lat, lng, source: 'community', source_ref: '',
        properties: { connection_model: 'community_path_endpoint' }, edge_id: path.end.edge_id,
        edge_fraction: path.end.fraction, connection_distance_m: 0, anchor_lat: lat, anchor_lng: lng };
    const allowed = new Set(path.edge_ids);
    const plan = planJourney(nodes, edges.filter(edge => allowed.has(edge.id)), { ...data, assets: [...data.assets, end] },
        { ...request, origin: path.coordinates[0], destination: end }, hazards, null, ['direct'], solar);
    const chosen = plan.recommended ? plan.routes[plan.recommended] : undefined;
    if (chosen && (chosen.edge_ids.length !== path.edge_ids.length ||
        chosen.edge_ids.some((id, i) => id !== path.edge_ids[i]))) {
        return { routes: {}, recommended: null, reasons: ['A current route could not follow the checked community path.'] };
    }
    if (chosen && Date.parse(chosen.arrival_at) >= Date.parse(route.valid_until)) {
        return { routes: {}, recommended: null, reasons: ['The community field check expires before you would reach the end of this walk.'] };
    }
    if (chosen) {
        const endTime = Date.parse(chosen.arrival_at);
        for (let time = Date.parse(chosen.departure_at); time < endTime + 60000; time += 60000) {
            if (openingAt(route.opening_hours, new Date(Math.min(time, endTime)).toISOString()) !== true) {
                return { routes: {}, recommended: null, reasons: ['The community path may close before you would finish. Choose an earlier departure.'] };
            }
        }
        chosen.community_id = route.id;
    }
    return plan;
}
