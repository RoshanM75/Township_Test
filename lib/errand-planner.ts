import { planJourney } from './journeys.ts';
import { PROFILES, type HazardReport, type Mode, type PathEdge, type PathNode } from './routing.ts';
import type { JourneyPlan, JourneyRoute, JourneyStep, PlanningInput, WalkingAsset, WalkingData } from './walking.ts';
import { projectPoint, metres } from './walking-geometry.ts';
import { assetFacts } from './route-conditions.ts';
import { placeHours } from './place-details.ts';
import { isPlaceGoal,matchesGoal,type PlaceGoal } from './place-goals.ts';
import type { RouteBarrier } from './route-conditions.ts';
import type { SolarModel } from './solar-shade.ts';
import { openingAt } from './verification.ts';

export interface ErrandStop { place_id: string; dwell_min: number; goal?:PlaceGoal }
export interface ErrandRequest { stops: ErrandStop[]; return_to_start: boolean; compare_order: boolean }
type BaseInput = Omit<PlanningInput, 'destination' | 'entrance_id'>;

function permutations<T>(items: T[]): T[][] {
    return items.length < 2 ? [items] : items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest]));
}

function returnEndpoint(input: BaseInput, edges: PathEdge[], data: WalkingData): WalkingAsset | null {
    const actual = data.assets.find(asset => asset.id === input.start_asset_id);
    if (actual) return actual;
    const nearby = edges.filter(edge => edge.pedestrian_access !== false && edge.kind !== 'street' && !edge.is_crossing && edge.geometry.length >= 2)
        .map(edge => ({ edge, ...projectPoint(edge.geometry, [input.origin[1], input.origin[0]]) })).sort((a,b) => a.distance-b.distance)[0];
    if (!nearby || nearby.distance > 50) return null;
    return { id: 'errand:return', external_id: null, kind: 'entrance', category: 'other', parent_id: null,
        name: 'Return to your starting point', lat: input.origin[0], lng: input.origin[1], edge_id: nearby.edge.id,
        edge_fraction: nearby.fraction, connection_distance_m: nearby.distance, anchor_lat: nearby.point[1], anchor_lng: nearby.point[0],
        source: 'osm', source_ref: '', properties: { connection_model: 'errand_return_endpoint' } };
}

function checkVisit(asset: WalkingAsset, entrance: WalkingAsset, data: WalkingData, arrive: string, leave: string) {
    let known = true;
    // Every minute, including the end of the stop. Unknown hours are never advertised as open.
    for (let ms = Date.parse(arrive); ms <= Date.parse(leave) + 59999; ms += 60000) {
        const at = new Date(Math.min(ms, Date.parse(leave))).toISOString();
        const hours = placeHours(asset, at, data.verifications).open;
        const accessHours = openingAt(assetFacts(entrance, data, at).values.opening_hours, at);
        if (hours === false || accessHours === false) return 'closed';
        if (hours !== true || accessHours !== true) known = false;
    }
    return known ? 'open' : 'unknown';
}

/** Bounded multi-stop search over real legs. Only the chosen stops/order are
 * compared; required rests carry across legs unless an actual planned rest resets them. */
export function planErrands(nodes: PathNode[], edges: PathEdge[], data: WalkingData, input: BaseInput,
    errands: ErrandRequest, hazards: HazardReport[] = [], feelsLike?: number | null, solar?:SolarModel): JourneyPlan {
    const fail = (reason: string): JourneyPlan => ({ routes: {}, recommended: null, reasons: [reason] });
    if (!errands || !Array.isArray(errands.stops) || errands.stops.length < 2 || errands.stops.length > 3 ||
        errands.stops.some(stop => (!stop.place_id && (!isPlaceGoal(stop.goal)||stop.goal==='all')) || !Number.isFinite(stop.dwell_min) || stop.dwell_min < 0 || stop.dwell_min > 60))
        return fail('Choose two or three places or purposes and a valid time at each stop.');
    if (!Number.isFinite(Date.parse(input.departure_at))) return fail('Choose a valid departure time.');
    const kinds=['destination','transit','toilet','water','shelter','rest'];
    const normal=data.assets.filter(asset=>kinds.includes(asset.kind));
    const connected=new Set(data.assets.filter(asset=>asset.edge_id!==null&&asset.edge_fraction!==null).map(asset=>asset.parent_id??asset.id));
    const speed=input.needs.speed_mps??PROFILES[input.profile].speed_mps;
    const limit=speed*input.needs.budget_min*60;
    const distance=(a:WalkingAsset)=>metres([a.lng,a.lat],[input.origin[1],input.origin[0]]);
    const slots=errands.stops.map(stop=>{
        if(stop.place_id)return normal.filter(a=>a.id===stop.place_id||a.external_id===stop.place_id).slice(0,1).map(asset=>({...stop,asset}));
        // Bounded recommendation: compare at most two nearby, connected candidates
        // per purpose. No external place data or assumed shortcuts.
        return normal.filter(asset=>connected.has(asset.id)&&matchesGoal(asset,stop.goal!)&&distance(asset)<=limit)
            .filter(asset=>{const {values}=assetFacts(asset,data,input.departure_at);return values.available!==false&&!['private','permission'].includes(String(values.public_access));})
            .sort((a,b)=>distance(a)-distance(b)).slice(0,2).map(asset=>({...stop,asset}));
    });
    if(slots.some(slot=>!slot.length))return fail('A selected place or purpose lacks nearby mapped candidates. Try choosing a different place or purpose.');
    const combinations=slots.reduce<Array<Array<typeof slots[number][number]>>>((sets,slot)=>sets.flatMap(set=>slot.filter(option=>!set.some(s=>s.asset.id===option.asset.id)).map(option=>[...set,option])),[[]]);
    if(!combinations.length)return fail('Choose two or three different mapped places.');
    const finish = errands.return_to_start ? returnEndpoint(input, edges, data) : null;
    if (errands.return_to_start && !finish) return fail('The return starting point has no mapped pedestrian connection.');
    const extended = finish && !data.assets.some(a => a.id === finish.id) ? { ...data, assets: [...data.assets, finish] } : data;
    const ordered=combinations.flatMap(order=>errands.compare_order?permutations(order):[order]);
    const modes: Mode[] = input.needs.comfort?.includes('shelter') ? ['direct', 'sheltered'] : input.needs.comfort?.includes('shade') ? ['direct','coolest'] : ['direct'];
    const alternatives: JourneyRoute[] = [];
    let barriers:RouteBarrier[]=[];
    let reason = 'No itinerary fits all walking requirements, opening hours, stop durations and the total time budget.';
    // Cache identical inputs for shared prefixes of the candidate orders.
    const cache = new Map<string, JourneyPlan>();
    for (const order of ordered) {
        const legs: JourneyRoute[] = [], itinerary: NonNullable<JourneyRoute['errand_stops']> = [];
        const trace: JourneyStep[] = [];
        let elapsed = 0, sinceRest = input.initial_without_rest_min ?? 0, origin = input.origin, startAsset = input.start_asset_id;
        let unknownHours = false, failed = false;
        const visitOrder = [...order.map(stop => ({ destination: stop.asset!, dwell: stop.dwell_min, stop: true })),
            ...(finish ? [{ destination: finish, dwell: 0, stop: false }] : [])];
        for (const item of visitOrder) {
            const remaining = input.needs.budget_min - elapsed - item.dwell;
            if (remaining <= 0) { failed = true; break; }
            const departure = new Date(Date.parse(input.departure_at) + elapsed * 60000).toISOString();
            const legInput: PlanningInput = { ...input, origin, start_asset_id: startAsset, destination: item.destination,
                initial_without_rest_min: sinceRest, needs: { ...input.needs, budget_min: Math.max(5, remaining) }, departure_at: departure };
            const key = JSON.stringify([origin,startAsset,item.destination.id,departure,sinceRest,remaining]);
            const plan = cache.get(key) ?? planJourney(nodes, edges, extended, legInput, hazards, feelsLike, modes,solar);
            cache.set(key, plan);
            const leg = plan.recommended ? plan.routes[plan.recommended] : null;
            if (!leg || leg.total_min > remaining + 1e-6) { failed = true; reason = `Cannot fit ${item.destination.name} within the remaining time and required access conditions.` + (plan.reasons[0]?' '+plan.reasons[0]:''); barriers=plan.barriers??[]; break; }
            const leave = new Date(Date.parse(leg.arrival_at) + item.dwell * 60000).toISOString();
            if (item.stop) {
                const open = checkVisit(item.destination, leg.entrance, data, leg.arrival_at, leave);
                if (open === 'closed' || (input.needs.verified_only && open !== 'open')) {
                    failed = true; reason = `${item.destination.name} is closed or lacks current usable hours for the planned stop.`; break;
                }
                unknownHours ||= open === 'unknown';
                itinerary.push({ destination: item.destination, entrance: leg.entrance, dwell_min: item.dwell, arrival_at: leg.arrival_at, leave_at: leave,hours_state:open });
            }
            trace.push(...(leg.steps ?? []).map(step => ({ ...step, start_min: elapsed + step.start_min, end_min: elapsed + step.end_min })));
            elapsed += leg.total_min;
            if (item.stop && item.dwell) trace.push({ kind: 'errand', name: item.destination.name, coordinates: [[leg.entrance.lat, leg.entrance.lng]], distance_m: 0, start_min: elapsed, end_min: elapsed + item.dwell });
            elapsed += item.dwell;
            legs.push(leg);
            sinceRest = leg.ending_without_rest_min ?? leg.longest_without_rest_min;
            origin = [leg.entrance.lat, leg.entrance.lng]; startAsset = leg.entrance.id;
        }
        if (failed || !legs.length || elapsed > input.needs.budget_min + 1e-6) continue;
        const final = legs.at(-1)!;
        const sum = (field: 'length_m'|'walk_min'|'rest_min'|'sun_exposed_min'|'uncovered_m'|'unsheltered_m'|'dark_m'|'crossings'|'unverified_crossings'|'verified_rest_stops') =>
            legs.reduce((total, leg) => total + leg[field], 0);
        const length = sum('length_m');
        const evidence = [...new Map(legs.flatMap(leg => leg.evidence).map(item => [item.edge_id,item])).values()]
            .map(row => ({ ...row, missing:[...new Set(legs.flatMap(leg => leg.evidence.filter(item => item.edge_id === row.edge_id).flatMap(item => item.missing)))] }));
        const unchecked = evidence.filter(row => row.missing.length > 0).length;
        const quality = Object.fromEntries(Object.keys(final.quality).map(key => [key, legs.reduce((n,leg) => n + leg.quality[key as keyof typeof leg.quality]*leg.length_m,0)/Math.max(1,length)])) as JourneyRoute['quality'];
        const { sun_exposure: _sun, ...rest } = final;
        void _sun; // Exposure summaries in a multi-stop trip use summed legs, not the final leg's timeline.
        alternatives.push({ ...rest, mode: 'direct', start_asset_id: input.start_asset_id, return_walk: false, community_id: undefined,
            destination: itinerary.at(-1)!.destination, entrance: final.entrance, errand_returns: errands.return_to_start, errand_stops: itinerary, steps: trace,
            coordinates: legs.flatMap(leg => leg.coordinates), node_ids: legs.flatMap(leg => leg.node_ids), edge_ids: legs.flatMap(leg => leg.edge_ids),
            length_m: length, walk_min: sum('walk_min'), rest_min: sum('rest_min'), total_min: elapsed,
            sun_exposed_min: sum('sun_exposed_min'), uncovered_m: sum('uncovered_m'), unsheltered_m: sum('unsheltered_m'), dark_m: sum('dark_m'),
            avg_shade: legs.reduce((n,leg)=>n+leg.avg_shade*leg.length_m,0)/Math.max(1,length),
            avg_lit: legs.reduce((n,leg)=>n+leg.avg_lit*leg.length_m,0)/Math.max(1,length), quality,
            crossings: sum('crossings'), unverified_crossings: sum('unverified_crossings'), verified_rest_stops: sum('verified_rest_stops'),
            rest_stops: legs.flatMap(leg => leg.rest_stops), mapped_rest_stops:legs.reduce((n,leg)=>n+(leg.mapped_rest_stops??0),0),
            uncontrolled_crossings:legs.reduce((n,leg)=>n+(leg.uncontrolled_crossings??0),0), longest_without_rest_min: Math.max(...legs.map(leg => leg.longest_without_rest_min)),
            ending_without_rest_min: sinceRest, unchecked_segments: unchecked, evidence_coverage: evidence.length ? (evidence.length-unchecked)/evidence.length : 0, evidence,
            shortfall_crossings: legs.flatMap(leg => leg.shortfall_crossings), warnings: [...new Set(legs.flatMap(leg=>leg.warnings))],
            suitability: !unknownHours && legs.every(leg=>leg.suitability==='green') ? 'green' : 'yellow',
            explanations: [...new Set([...(unknownHours ? ['Some opening hours at planned stops need confirmation.'] : []),
                'The total includes time at each errand and the selected return. An errand stop is not automatically a verified rest.', ...legs.flatMap(leg => leg.explanations)])],
            departure_at: input.departure_at, arrival_at: new Date(Date.parse(input.departure_at)+elapsed*60000).toISOString(),
        });
    }
    const preferences = input.needs.comfort ?? [];
    const score = (route: JourneyRoute) => (route.suitability==='green'?0:10000)+route.total_min+
        (preferences.includes('shade') ? route.uncovered_m/speed/60 : 0) + (preferences.includes('shelter') ? route.unsheltered_m/speed/60 : 0);
    alternatives.sort((a,b)=>score(a)-score(b));
    // Keep a single fully checked itinerary, never present a failed comparison leg as a route.
    return alternatives.length ? { routes: { direct: alternatives[0] }, recommended:'direct', reasons: [],
        compared_itineraries: alternatives.slice(0,3).map(route=>({ places: route.errand_stops!.map(stop=>stop.destination.name), total_min: route.total_min, suitability:route.suitability })) } : {...fail(reason),barriers};
}

export function errandRequestFromRoute(route: JourneyRoute): ErrandRequest | null {
    return route.errand_stops?.length ? { stops: route.errand_stops.map(stop=>({place_id:stop.destination.external_id||stop.destination.id,dwell_min:stop.dwell_min})),
        return_to_start: !!route.errand_returns, compare_order:false } : null;
}
export function readErrands(value: string | null): ErrandRequest | null {
    if(!value || value.length>1800)return null;
    try{
        const r=JSON.parse(value) as ErrandRequest;
        if(!Array.isArray(r.stops)||r.stops.length<2||r.stops.length>3||typeof r.return_to_start!=='boolean'||typeof r.compare_order!=='boolean'
            ||r.stops.some(s=>typeof s.place_id!=='string'||s.place_id.length>180||(!s.place_id&&(!isPlaceGoal(s.goal)||s.goal==='all'))||
                (s.goal!==undefined&&!isPlaceGoal(s.goal))||!Number.isFinite(s.dwell_min)||s.dwell_min<0||s.dwell_min>60)
            ||new Set(r.stops.map(s=>s.place_id).filter(Boolean)).size!==r.stops.filter(s=>s.place_id).length)return null;
        return {stops:r.stops.map(s=>({place_id:s.place_id,dwell_min:s.dwell_min,...(!s.place_id&&s.goal?{goal:s.goal}:{})})),return_to_start:r.return_to_start,compare_order:r.compare_order};
    }catch{return null;}
}
