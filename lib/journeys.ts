import { buildGraph, buildRoute, evaluateEdge, indexHazards, MODE_WEIGHTS, PROFILES, requiresStepFreeProfile, reachableNodes, shortestPath, slotForHour,
    type Graph, type PathEdge, type PathNode, type Mode, type HazardReport, type CostContext, type PathResult } from './routing.ts';
import { DEFAULT_NEEDS, COMFORT_PREFERENCES, type WalkingNeeds, type WalkingAsset, type WalkingData, type PlanningInput, type JourneyPlan, type JourneyRoute, type JourneyStep } from './walking.ts';
import { evidenceFor, isConfirmed, malaysiaHour, openingAt } from './verification.ts';
import { metres, pointAt, projectPoint } from './walking-geometry.ts';
import { splitPathAnchors, type PathAnchor } from './path-anchors.ts';
import { unavailableAssetIds } from './report-status.ts';
import type { CommunityRoute } from './community-routes.ts';
import { placeHours } from './place-details.ts';
import { groupShadeChecks, journeyShade, pathShade } from './route-shade.ts';
import type { SolarModel } from './solar-shade.ts';
import { forecastWeights } from './comfort.ts';
import { assetFacts, arrivalFields, usableAccess, observedEdge, requiredEdgeFields, edgeRestrictions, barrierAtAsset, barrierOnEdge, type RouteBarrier } from './route-conditions.ts';

const MODES: Mode[] = ['direct', 'coolest', 'sheltered', 'safest'];
// Suppress sub-millisecond spherical interpolation noise at exact rest boundaries.
const TIME_EPS = .001;
const FIELD_LABELS: Record<string, string> = { path_open: 'path condition', surface_rating: 'surface condition', has_steps: 'steps',
    slope_pct: 'slope', crossing_type: 'crossing type', has_kerb_ramp: 'kerb ramps', shade_morning: 'morning shade',
    shade_midday: 'midday shade', shade_afternoon: 'afternoon shade', lit_ratio: 'lighting', covered: 'roof cover',
    clear_width_m: 'clear width', has_tactile: 'tactile paving', audible_signal: 'audible signal', tactile_continuous: 'continuous tactile paving', level_connection_checked: 'level connection', opening_hours:'passage access hours' };

export function normaliseNeeds(value: unknown): WalkingNeeds {
    const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const number = (key: keyof WalkingNeeds, min: number, max: number) => typeof input[key] === 'number' && Number.isFinite(input[key])
        ? Math.max(min, Math.min(max, input[key] as number)) : DEFAULT_NEEDS[key] as number;
    const comfort = COMFORT_PREFERENCES.filter(p => Array.isArray(input.comfort) && input.comfort.includes(p));
    return {
        ...(comfort.length ? { comfort } : {}),
        step_free: input.step_free === true, verified_only: input.verified_only === true,
        avoid_uncontrolled_crossings: input.avoid_uncontrolled_crossings === true, require_rests: input.require_rests === true,
        avoid_uneven_surfaces: input.avoid_uneven_surfaces === true,
        min_clear_width_m: typeof input.min_clear_width_m === 'number' && Number.isFinite(input.min_clear_width_m)
            ? Math.max(.5, Math.min(3, input.min_clear_width_m)) : null,
        require_tactile_crossings: input.require_tactile_crossings === true,
        require_tactile_continuity: input.require_tactile_continuity === true,
        require_audible_crossings: input.require_audible_crossings === true,
        rest_backrest: input.rest_backrest === true, rest_armrests: input.rest_armrests === true, rest_shelter: input.rest_shelter === true,
        max_slope_pct: number('max_slope_pct', 0, 20), rest_interval_min: number('rest_interval_min', 1, 30),
        rest_duration_min: number('rest_duration_min', 1, 10), budget_min: number('budget_min', 5, 120),
        speed_mps: typeof input.speed_mps === 'number' && Number.isFinite(input.speed_mps) ? Math.max(0.3, Math.min(1.8, input.speed_mps)) : null,
    };
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
    startAsset?: WalkingAsset;
    assets: Map<string, number>;
    originals: Map<number, PathEdge>;
    shade?: { model: SolarModel; checks: ReturnType<typeof groupShadeChecks>; edges: Map<number, PathEdge> };
}
function prepare(nodes: PathNode[], rawEdges: PathEdge[], data: WalkingData, input: PlanningInput, model?: SolarModel): Prepared | null {
    const projected = rawEdges.filter(e => e.pedestrian_access !== false && e.kind !== 'street')
        .map(edge => observedEdge(edge, data.verifications, input.departure_at));
    const startAsset = input.start_asset_id ? data.assets.find(asset => asset.id === input.start_asset_id) : undefined;
    if (input.start_asset_id && (!startAsset || startAsset.edge_id === null || startAsset.edge_fraction === null
        || metres([input.origin[1], input.origin[0]], [startAsset.lng, startAsset.lat]) > 3)) return null;
    const anchoredEdge = startAsset && projected.find(edge => edge.id === startAsset.edge_id);
    if (startAsset && !anchoredEdge) return null;
    let closest: { edge: PathEdge; fraction: number; distance: number } | null = startAsset && anchoredEdge
        ? { edge: anchoredEdge, fraction: startAsset.edge_fraction!, distance: connectionLength(startAsset, assetFacts(startAsset, data, input.departure_at)) } : null;
    for (const edge of startAsset ? [] : projected) {
        if (edge.geometry.length < 2) continue;
        const projection = projectPoint(edge.geometry, [input.origin[1], input.origin[0]]);
        const surface=!edge.world||edge.world.levelGroups.includes('ground');
        const priorSurface=!closest?.edge.world||closest.edge.world.levelGroups.includes('ground');
        if (!closest || projection.distance < closest.distance-(priorSurface&&!surface?3:0) || (surface&&!priorSurface&&projection.distance<=closest.distance+3)) closest = { edge, ...projection };
    }
    if (!closest || closest.distance > (startAsset ? 100 : 50)) return null;
    const anchors: PathAnchor[] = [{ key: 'origin', edge_id: closest.edge.id, fraction: closest.fraction }];
    for (const asset of data.assets) if (asset.edge_id !== null && asset.edge_fraction !== null) {
        anchors.push({ key: asset.id, edge_id: asset.edge_id, fraction: asset.edge_fraction });
    }
    const split = splitPathAnchors(nodes, projected, anchors);
    return { graph: buildGraph(split.nodes, split.edges), origin: split.anchors.get('origin')!, offset: closest.distance, startAsset,
        assets: split.anchors, originals: new Map(projected.map(e => [Number(e.id), e])),
        shade: model && { model, checks: groupShadeChecks(data.verifications), edges: new Map(rawEdges.map(e => [Number(e.id), e])) } };
}

function missingFor(edge: PathEdge, input: PlanningInput, data: WalkingData, mode: Mode, validAt = input.departure_at) {
    const e = evidenceFor(data.verifications, edge.is_crossing ? 'crossing' : 'path', edge.id, validAt);
    return requiredEdgeFields(edge, input, mode, validAt, data.verifications)
        .filter(field => !isConfirmed(e, field)).map(field => FIELD_LABELS[field] ?? field);
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
        if (input.needs.step_free || requiresStepFreeProfile(input.profile)) required.push('step_free');
        if(input.needs.require_tactile_continuity)required.push('tactile_continuous');
        if (input.needs.rest_backrest) required.push('backrest');
        if (input.needs.rest_armrests) required.push('armrests');
        if (input.needs.rest_shelter) required.push('sheltered');
        if (!required.every(field => isConfirmed(e, field) && v[field] === true) || ['private','permission','customers','destination'].includes(String(v.public_access))) continue;
        const node = prepared.assets.get(asset.id)!;
        if (!restNodes.has(node)) restNodes.set(node, []); restNodes.get(node)!.push(asset);
    }
    const missing = new Map<number, string[]>();
    const permitted = new Map<number, boolean>();
    for (const edge of prepared.graph.edges.values()) {
        const id = edge.source_edge_id!, original = prepared.originals.get(id)!;
        if (permitted.has(id)) continue;
        const absent = missingFor(original, input, data, ctx.mode); missing.set(id, absent);
        const blocked = edgeRestrictions(original, input, data.verifications, ctx.mode, ctx.hazards.get(id) ?? []).length > 0;
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
    const initialSince = Math.max(0, Math.min(120, input.initial_without_rest_min ?? 0)) * 60;
    offer({ node: prepared.origin, cost: startSeconds, elapsed: startSeconds, sinceRest: startSeconds + initialSince, longest: startSeconds + initialSince, active: true });
    const cache = new Map<string, ReturnType<typeof evaluateEdge>>();
    const solar = ctx.mode === 'coolest' && ctx.slot !== 'night' ? prepared.shade : undefined;
    const solarCost = new Map<string, number>();
    const departureAt = Date.parse(input.departure_at);
    const weatherCache=new Map<number,ReturnType<typeof forecastWeights>>();
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
                ...(input.needs.step_free || requiresStepFreeProfile(input.profile) ? ['step_free'] : []),
                ...(input.needs.require_tactile_continuity?['tactile_continuous']:[]), ...(input.needs.rest_backrest ? ['backrest'] : []), ...(input.needs.rest_armrests ? ['armrests'] : []), ...(input.needs.rest_shelter ? ['sheltered'] : [])];
            if (!required.every(f => isConfirmed(evidence, f) && values[f] === true) || ['private','permission','customers','destination'].includes(String(values.public_access)) || openingAt(values.opening_hours, arrivalAtRest) === false) continue;
            if (label.sinceRest > TIME_EPS && (!input.needs.require_rests || label.sinceRest + detour <= interval + TIME_EPS)) {
                const seconds = detour * 2 + input.needs.rest_duration_min * 60;
                offer({ node: label.node, cost: label.cost + seconds, elapsed: label.elapsed + seconds, sinceRest: detour,
                    longest: Math.max(label.longest, label.sinceRest + detour), previous: label, rest, active: true, via: label.via, outbound: label.outbound });
            }
        }
        for (const { edge, to } of prepared.graph.adj.get(label.node) ?? []) {
            if (!permitted.get(edge.source_edge_id!)) continue;
            // Forecasts have hourly resolution, so reuse weights for each arrival hour.
            const entryAt=departureAt+label.elapsed*1000,hour=Math.floor(entryAt/3600000);
            let localWeather=weatherCache.get(hour);
            if(input.weather&&!localWeather){localWeather=forecastWeights(input.weather,entryAt);weatherCache.set(hour,localWeather);}
            const edgeContext=localWeather?.forecast?{...ctx,heatMultiplier:localWeather.heat,rainMultiplier:localWeather.rain}:ctx;
            const cacheKey=`${edge.id}:${localWeather?.forecast?hour:'static'}`;
            let evaluation = cache.get(cacheKey);
            if (!evaluation) { evaluation = evaluateEdge(edge, edgeContext); cache.set(cacheKey, evaluation); }
            if (evaluation.hard.length) continue;
            const seconds = evaluation.walk_s + evaluation.wait_s;
            const passageHours=edge.path_opening_hours??edge.world?.openingHours;
            if(passageHours&&(openingAt(passageHours,new Date(entryAt).toISOString())===false||openingAt(passageHours,new Date(entryAt+seconds*1000).toISOString())===false))continue;
            const heatWeight=MODE_WEIGHTS[ctx.mode].heat*(edgeContext.heatMultiplier??1);
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
    data: WalkingData, ctx: CostContext, returning = false, unavailable = new Set<string>()): JourneyRoute {
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
    const uncontrolledCrossings = evidence.filter(e => {
        const edge = prepared.originals.get(e.edge_id);
        return edge?.is_crossing && edge.crossing_type !== 'signalised' && edge.crossing_type !== 'zebra';
    }).length;
    // Count only seats attached to a traversed path, not nearby points across a barrier.
    // These are mapped opportunities, not substitutes for a required, verified rest.
    const traversed = new Set(path.nodes);
    const mappedRests = input.needs.comfort?.includes('seating') ? data.assets.filter(asset => {
        if (asset.kind !== 'rest' || unavailable.has(asset.id) || !traversed.has(prepared.assets.get(asset.id)!)) return false;
        const { values } = assetFacts(asset, data, arrival);
        return values.available !== false && values.path_connection !== false && openingAt(values.opening_hours, arrival) !== false
            && usableAccess(asset, assetFacts(asset, data, arrival), input);
    }).length : undefined;
    const facts = assetFacts(entrance, data, arrival);
    const entranceMissing = (returning ? [] : arrivalFields(entrance, input, !!facts.evidence.lift_available))
        .filter(f => !isConfirmed(facts.evidence, f));
    const explanations: string[] = [];
    if (unchecked.length) explanations.push(`${unchecked.length} path segment${unchecked.length === 1 ? '' : 's'} need current checks.`);
    if (unverifiedCrossings) explanations.push(`${unverifiedCrossings} crossing${unverifiedCrossings === 1 ? '' : 's'} not fully checked.`);
    if (entranceMissing.length) explanations.push(`Access point checks needed: ${entranceMissing.map(f => f.replaceAll('_', ' ')).join(', ')}.`);
    if (entrance.source === 'gtfs') explanations.push('The selected footpath is near the stop. Check the final connection and boarding point on site.');
    if (!returning && entrance.properties.connection_model!=='errand_return_endpoint' && openingAt(facts.values.opening_hours, arrival) === null) explanations.push('Opening hours at arrival are not confirmed.');
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
    const startFacts = prepared.startAsset && assetFacts(prepared.startAsset, data, input.departure_at);
    const startChecked = prepared.startAsset && startFacts && arrivalFields(prepared.startAsset, input, !!startFacts.evidence.lift_available).every(f => isConfirmed(startFacts.evidence, f));
    const green = !unchecked.length && !entranceMissing.length && !restHoursUnknown && (prepared.startAsset ? startChecked : prepared.offset <= 3)
        && (returning || (entrance.properties.connection_model==='errand_return_endpoint' && endMetres<=3) || openingAt(facts.values.opening_hours, arrival) === true);
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
    return { ...result, steps: trace, start_asset_id: prepared.startAsset?.id, return_walk: returning, coordinates: coords, edge_ids: originalIDs, destination: input.destination, entrance,
        length_m: result.length_m + connectors, walk_min: result.walk_min + connectors / speed / 60,
        total_min: totalSeconds / 60, rest_min: rests.length * input.needs.rest_duration_min, rest_stops: rests,
        verified_rest_stops: rests.length, ending_without_rest_min: (final.sinceRest + endMetres / speed) / 60, longest_without_rest_min: Math.max(final.longest, final.sinceRest + endMetres / speed) / 60,
        uncovered_m: sun ? sun.sun_m + sun.unknown_m : ctx.slot === 'night' ? 0 : exposed + connectors,
        ...(sun ? { sun_exposure: sun } : {}),
        unsheltered_m: unsheltered + connectors, unverified_crossings: unverifiedCrossings, uncontrolled_crossings: uncontrolledCrossings,
        ...(mappedRests !== undefined ? { mapped_rest_stops: mappedRests } : {}), unchecked_segments: unchecked.length,
        evidence_coverage: evidence.length ? (evidence.length - unchecked.length) / evidence.length : 0,
        suitability: green ? 'green' : 'yellow', explanations, evidence,
        departure_at: input.departure_at, arrival_at: new Date(Date.parse(input.departure_at) + totalSeconds * 1000).toISOString() };
}

// Preferences compare available alternatives. Evidence-qualified routes always rank ahead
// of routes that still need checks; optional comfort never overrides this distinction.
function preferenceCost(route: JourneyRoute, needs: WalkingNeeds, slot: CostContext['slot'], speed: number) {
    const preferences = needs.comfort ?? [];
    const metreMinutes = (m: number) => m / speed / 60;
    let score = 0;
    if (slot !== 'night' && preferences.includes('shade')) score += 3 * metreMinutes(route.uncovered_m);
    if (preferences.includes('shelter')) score += 4 * metreMinutes(route.unsheltered_m);
    if (slot === 'night' && preferences.includes('lighting')) score += 5 * metreMinutes(route.dark_m);
    if (preferences.includes('controlled_crossings')) score += 4 * (route.uncontrolled_crossings ?? 0);
    if (preferences.includes('seating') && !route.mapped_rest_stops && !route.verified_rest_stops) score += 6;
    return score;
}

function preferenceRank(route: JourneyRoute, needs: WalkingNeeds, slot: CostContext['slot'], speed: number, returning = false) {
    return (route.suitability === 'green' ? 0 : 100000)
        + (1 - route.evidence_coverage) * 5 + route.unverified_crossings * 2
        + (returning ? (needs.budget_min - route.total_min) * 5 : route.total_min)
        + preferenceCost(route, needs, slot, speed);
}

function diagnosticBarriers(prepared: Prepared, candidates: WalkingAsset[], data: WalkingData, input: PlanningInput, hazards: HazardReport[]) {
    const out: RouteBarrier[] = [];
    const seen = new Set<string>();
    const add = (issue: RouteBarrier) => {
        const key = `${issue.target_type}:${issue.target_id}:${issue.field}`;
        if (!seen.has(key)) { seen.add(key); out.push(issue); }
    };
    const indexed = indexHazards(hazards);
    const stepFree = input.needs.step_free || requiresStepFreeProfile(input.profile);
    const unavailable = unavailableAssetIds(hazards, stepFree);
    for (const asset of candidates.slice(0, 4)) {
        const { evidence, values } = assetFacts(asset, data, input.departure_at);
        for (const field of arrivalFields(asset, input, !!evidence.lift_available)) {
            if (values[field] === false || (input.needs.verified_only && !isConfirmed(evidence, field)))
                add(barrierAtAsset(asset, field, values[field] === false ? 'Recorded condition conflicts with your needs' : 'Current access-point check needed', data, input.departure_at));
        }
        if (unavailable.has(asset.id)) add({ ...barrierAtAsset(asset, 'available', 'Current report affects this access point', data, input.departure_at), state: 'checked' });
        if (openingAt(values.opening_hours, input.departure_at) === false) add(barrierAtAsset(asset, 'opening_hours', 'Recorded access hours are closed at departure', data, input.departure_at));
        const node = prepared.assets.get(asset.id);
        if (node === undefined) {
            add(barrierAtAsset(asset, 'path_connection', 'No mapped path connection for this access point', data, input.departure_at));
            continue;
        }
        const comparison = shortestPath(prepared.graph, prepared.origin, node, { profile: 'everyday', mode: 'direct',
            slot: slotForHour(malaysiaHour(input.departure_at)), hazards: new Map(), speedMps: 1.1 }, true);
        if(input.needs.require_rests && comparison && out.length<4){
            const ids=new Set(comparison.edges.map(part=>part.source_edge_id));
            const restFields=['available','path_connection',input.profile==='wheelchair'?'wheelchair_space':'has_seat',...(stepFree?['step_free']:[]),
                ...(input.needs.rest_backrest?['backrest']:[]),...(input.needs.rest_armrests?['armrests']:[]),...(input.needs.rest_shelter?['sheltered']:[])];
            for(const rest of data.assets.filter(a=>a.kind==='rest'&&a.edge_id!==null&&ids.has(a.edge_id)).slice(0,4)){
                const {evidence,values}=assetFacts(rest,data,input.departure_at);
                const field=restFields.find(f=>!isConfirmed(evidence,f)||values[f]!==true);
                if(field)add(barrierAtAsset(rest,field,'Required rest facility needs a current usability check',data,input.departure_at));
            }
        }
        for (const part of comparison?.edges ?? []) {
            const edge = prepared.originals.get(part.source_edge_id!)!;
            for (const issue of edgeRestrictions(edge, input, data.verifications, 'direct', indexed.get(edge.id) ?? [])) add(barrierOnEdge(edge, issue));
            if (out.length >= 6) break;
        }
    }
    return out.slice(0, 6);
}

export function planJourney(nodes: PathNode[], edges: PathEdge[], data: WalkingData,
    request: PlanningInput, hazards: HazardReport[] = [], feelsLike?: number | null, modes: Mode[] = MODES, solar?: SolarModel): JourneyPlan {
    const input = { ...request, needs: normaliseNeeds(request.needs) };
    if (!Number.isFinite(Date.parse(input.departure_at))) return { routes: {}, recommended: null, reasons: ['Choose a valid departure time.'] };
    const prepared = prepare(nodes, edges, data, input, solar);
    if (!prepared) return { routes: {}, recommended: null, issue: { kind: 'start' }, reasons: ['Your start is more than 50 metres from a mapped pedestrian path.'] };
    if(input.needs.require_tactile_continuity&&!prepared.startAsset&&prepared.offset>1)return {routes:{},recommended:null,issue:{kind:'start'},reasons:['Continuous tactile guidance from this starting position to the mapped path has not been checked. Choose a checked access point.']};
    const unavailable = unavailableAssetIds(hazards, input.needs.step_free || requiresStepFreeProfile(input.profile));
    if (prepared.startAsset) {
        const start = prepared.startAsset, facts = assetFacts(start, data, input.departure_at);
        if (unavailable.has(start.id) || !usableAccess(start, facts, input) || openingAt(facts.values.opening_hours, input.departure_at) === false
            || (input.needs.verified_only && !arrivalFields(start, input, !!facts.evidence.lift_available).every(f => isConfirmed(facts.evidence, f)))) {
            return { routes: {}, recommended: null, issue: { kind: 'start' }, barriers: [barrierAtAsset(start, 'path_connection', 'Selected start entrance is unavailable or needs access checks', data, input.departure_at)],
                reasons: ['Choose a usable starting entrance; the selected entrance does not meet current requirements.'] };
        }
    }
    if (unavailable.has(input.destination.id)) {
        return { routes: {}, recommended: null, barriers: [{ ...barrierAtAsset(input.destination, 'available', 'Checked report: place unavailable', data, input.departure_at), state: 'checked' }], reasons: ['A checked report says this place is currently unavailable.'] };
    }
    const entrances = input.destination.kind === 'destination' || input.destination.kind === 'transit'
        ? data.assets.filter(a => a.kind === 'entrance' && a.parent_id === input.destination.id) : [input.destination];
    const connected = entrances.filter(a => (!input.entrance_id || a.id === input.entrance_id) && prepared.assets.has(a.id));
    let candidates = connected.filter(a => !unavailable.has(a.id));
    if (!input.entrance_id && input.destination.kind === 'transit') {
        const mapped = candidates.filter(a => a.properties.connection_model === 'mapped_entrance');
        if (mapped.length) candidates = mapped;
    }
    if (!candidates.length) return { routes: {}, recommended: null, barriers: diagnosticBarriers(prepared, connected.length ? connected : entrances.length ? entrances : [input.destination], data, input, hazards), issue: { kind: 'entrance' }, reasons: [connected.length
        ? 'A checked report says the matching access points are currently unavailable.'
        : input.entrance_id ? 'The selected access point is no longer connected to the walking map.'
        : 'This place has no mapped access point connected to the walking network.'] };
    const routes: JourneyPlan['routes'] = {};
    let searchLimited = false, closedAtArrival = false;
    const requestFacts = assetFacts(input.destination, data, input.departure_at);
    if (requestFacts.values.available === false || ['private', 'permission'].includes(String(requestFacts.values.public_access))) {
        return { routes: {}, recommended: null, barriers: [barrierAtAsset(input.destination, 'available', 'Place recorded as unavailable or restricted', data, input.departure_at)], reasons: ['The place is recorded as unavailable or restricted.'] };
    }
    const reachable = reachableNodes(prepared.graph, [prepared.origin]);
    const reachableEntrances = candidates.filter(entrance => reachable.has(prepared.assets.get(entrance.id)!));
    if (!reachableEntrances.length) return { routes: {}, recommended: null, barriers: candidates.slice(0,3).map(a => barrierAtAsset(a, 'path_connection', 'Mapped network connection missing from this start', data, input.departure_at)), issue: { kind: 'connection' },
        reasons: ['There is no mapped pedestrian connection from this start to the destination access points.'] };
    const accessCandidates = reachableEntrances.filter(entrance => usableAccess(entrance, assetFacts(entrance, data, input.departure_at), input));
    if (!accessCandidates.length) return { routes: {}, recommended: null, barriers: diagnosticBarriers(prepared, reachableEntrances, data, input, hazards), issue: { kind: 'entrance' }, reasons: [
        'The mapped access points do not meet your selected entrance requirements. Try another place or review the recorded entrances.',
    ] };
    const speed = input.needs.speed_mps ?? PROFILES[input.profile].speed_mps;
    const slot = slotForHour(malaysiaHour(input.departure_at));
    const climate=forecastWeights(input.weather,Date.parse(input.departure_at),feelsLike);
    const rainLikely=(climate.rainRisk??0)>=.5;
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
                strictUnknown: input.needs.verified_only, hazards: indexHazards(hazards),
                preferControlledCrossings: mode === 'safest' && input.needs.comfort?.includes('controlled_crossings'), heatMultiplier: climate.heat, rainMultiplier: climate.rain };
            const found = search(prepared, prepared.assets.get(entrance.id)!, entrance, data, input, ctx, false, unavailable);
            if (!found) continue;
            if ('limited' in found) { searchLimited = true; continue; }
            const route = summarise(prepared, found.final, entrance, input, data, ctx, false, unavailable);
            if (mode === 'sheltered' && route.length_m - route.unsheltered_m < 1) continue;
            if (input.needs.verified_only && route.suitability !== 'green') continue;
            // An entrance's opening window must also cover actual arrival.
            const arrival = assetFacts(entrance, data, route.arrival_at);
            if (!usableAccess(entrance, arrival, input)) continue;
            if (openingAt(arrival.values.opening_hours, route.arrival_at) === false || placeHours(input.destination, route.arrival_at, data.verifications).open === false) { closedAtArrival = true; continue; }
            const rank = found.final.cost + (route.suitability === 'green' ? 0 : 100000) + preferenceCost(route, input.needs, slot, speed) * 60;
            if (rank < bestCost) { routes[mode] = route; bestCost = rank; }
        }
    }
    const available = MODES.filter(m => routes[m] && !(slot === 'night' && m === 'coolest'));
    const standard = available.filter(mode => mode !== 'sheltered');
    const personalised = !!input.needs.comfort?.length;
    const recommended = (personalised || rainLikely ? available : standard.length ? standard : available).sort((a, b) => {
        const ra = routes[a]!, rb = routes[b]!;
        if (personalised) return preferenceRank(ra, input.needs, slot, speed) - preferenceRank(rb, input.needs, slot, speed) + (rainLikely?(ra.unsheltered_m-rb.unsheltered_m)/(speed*15):0);
        const score = (r: JourneyRoute) => (r.suitability === 'green' ? 0 : 10000) + r.unchecked_segments * 10
            + r.total_min + (slot === 'night' ? r.dark_m / 10 : r.uncovered_m * climate.heat / 45) + (rainLikely?r.unsheltered_m/(speed*15):0);
        return score(ra) - score(rb);
    })[0] ?? null;
    if (available.length) return { routes, recommended, reasons: [] };
    if (searchLimited) return { routes, recommended, reasons: ['The route search reached its limit. Try a shorter trip budget or a closer starting point.'] };
    if (closedAtArrival) return { routes, recommended, issue: { kind: 'closed' },
        reasons: ['Your estimated arrival is outside the opening hours of the destination or its entrance.'] };
    const reasons = [input.needs.require_rests ? `The planner needs a verified rest spot within each ${input.needs.rest_interval_min}-minute stretch.`
        : input.needs.verified_only ? 'The planner needs current checks for the paths, crossings and arrival point.'
        : `No route fits your ${input.needs.budget_min}-minute budget and walking needs.`,
        ...(input.needs.min_clear_width_m !== null || input.needs.require_tactile_crossings || input.needs.require_tactile_continuity || input.needs.require_audible_crossings
            ? ['Some paths or crossings may lack recorded width, tactile paving or audible signal information.'] : [])];
    return { routes, recommended, barriers: diagnosticBarriers(prepared, accessCandidates, data, input, hazards), issue: { kind: 'needs' }, reasons };
}

export function reachablePlaces(nodes: PathNode[], edges: PathEdge[], data: WalkingData,
    request: Omit<PlanningInput, 'destination'>, hazards: HazardReport[] = [],ids?:string[], modes:Mode[] = ['direct'], solar?:SolarModel) {
    return data.assets.filter(a => ['destination', 'transit', 'toilet', 'water', 'rest', 'shelter'].includes(a.kind)&&(!ids||ids.includes(a.id))).map(destination => {
        const plan = planJourney(nodes, edges, data, { ...request, destination }, hazards, null, modes,solar);
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
    if (!prepared) return { routes: {}, recommended: null, issue: { kind: 'start' }, reasons: ['Your start is more than 50 metres from a mapped pedestrian path.'] };
    if(needs.require_tactile_continuity&&!prepared.startAsset&&prepared.offset>1)return {routes:{},recommended:null,issue:{kind:'start'},reasons:['Continuous tactile guidance from this starting position has not been checked. Choose a checked access point.']};
    const routes: JourneyPlan['routes'] = {};
    const slot = slotForHour(malaysiaHour(request.departure_at));
    const climate=forecastWeights(input.weather,Date.parse(input.departure_at),feelsLike);
    const rainLikely=(climate.rainRisk??0)>=.5;
    const hasCover = (rainLikely||needs.comfort?.includes('shelter')) && [...prepared.graph.edges.values()].some(edge => edge.covered === true);
    const unavailable = unavailableAssetIds(hazards, needs.step_free || requiresStepFreeProfile(input.profile));
    if (prepared.startAsset) {
        const start = prepared.startAsset, facts = assetFacts(start, extended, input.departure_at);
        if (unavailable.has(start.id) || !usableAccess(start, facts, input) || openingAt(facts.values.opening_hours, input.departure_at) === false
            || (needs.verified_only && !arrivalFields(start, input, !!facts.evidence.lift_available).every(f => isConfirmed(facts.evidence, f))))
            return { routes: {}, recommended: null, issue: { kind: 'start' }, reasons: ['The selected start entrance is unavailable or needs access checks.'] };
    }
    for (const mode of modes.filter(m => (m !== 'sheltered' || hasCover) && !(slot === 'night' && m === 'coolest'))) {
        let best = Infinity;
        const ctx: CostContext = { mode, profile: input.profile, slot, speedMps: speed, strictUnknown: needs.verified_only,
            hazards: indexHazards(hazards), preferControlledCrossings: mode === 'safest' && needs.comfort?.includes('controlled_crossings'), heatMultiplier: climate.heat, rainMultiplier: climate.rain };
        for (const turn of turns) {
            const found = search(prepared, prepared.assets.get(turn.id)!, finish, extended, input, ctx, true, unavailable);
            if (!found || 'limited' in found) continue;
            const route = summarise(prepared, found.final, finish, input, extended, ctx, true, unavailable);
            if (mode === 'sheltered' && route.length_m - route.unsheltered_m < 1) continue;
            if (route.total_min < .25 || (needs.verified_only && route.suitability !== 'green')) continue;
            const rank = (route.suitability === 'green' ? 0 : 10000) + (needs.budget_min - route.total_min) * 5
                + (mode === 'coolest' ? route.uncovered_m : mode === 'safest' ? route.dark_m : 0) / 200
                + preferenceCost(route, needs, slot, speed);
            if (rank < best) { best = rank; routes[mode] = route; }
        }
    }
    const recommended = needs.comfort?.length
        ? MODES.filter(m => routes[m]).sort((a, b) => preferenceRank(routes[a]!, needs, slot, speed, true) - preferenceRank(routes[b]!, needs, slot, speed, true))[0] ?? null
        : (rainLikely&&routes.sheltered&&(!routes.direct||routes.sheltered.suitability===routes.direct.suitability||routes.sheltered.suitability==='green')?'sheltered':slot === 'night' && routes.safest ? 'safest' : routes.direct ? 'direct' : Object.keys(routes)[0] ?? null) as Mode | null;
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
        { ...request, origin: path.coordinates[0], start_asset_id: undefined, destination: end }, hazards, null, ['direct'], solar);
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
