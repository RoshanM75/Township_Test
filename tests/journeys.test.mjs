import assert from 'node:assert/strict';
import test from 'node:test';
import {planJourney,reachablePlaces,normaliseNeeds} from '../lib/journeys.ts';
import {evaluateEdge,indexHazards} from '../lib/routing.ts';
import {dispatchPlan} from '../lib/planning-dispatch.ts';
import {nodes,edges,data,input,record,asset} from './helpers/journey-fixture.mjs';

test('unknown conditions never become green, including the best available route',()=>{
    const plan=planJourney(nodes,edges,data(false),input());
    assert.ok(plan.recommended);assert.ok(Object.values(plan.routes).every(r=>r.suitability==='yellow'));
    assert.equal(plan.routes.direct.verified_rest_stops,0);assert.ok(plan.routes.direct.unchecked_segments>0);
});
test('current field-specific checks support a green route and a usable entrance',()=>{
    const plan=planJourney(nodes,edges,data(),input({verified_only:true}));
    assert.equal(plan.routes.direct.suitability,'green');assert.equal(plan.routes.direct.entrance.id,'101');
    assert.equal(plan.routes.direct.evidence_coverage,1);assert.deepEqual(plan.routes.direct.edge_ids,[1]);
});
test('required rests change the actual path to a longer route with checked seating',()=>{
    const plan=planJourney(nodes,edges,data(),input({require_rests:true}));const r=plan.routes.direct;
    assert.ok(r);assert.deepEqual(r.edge_ids,[2,3]);assert.equal(r.verified_rest_stops,2);
    assert.ok(Math.abs(r.length_m-160)<.01);assert.ok(r.longest_without_rest_min<=1.00001);
    assert.ok(Math.abs(r.total_min-(160/60+2))<.01);assert.equal(r.rest_min,2);
});
test('mapped or expired benches cannot satisfy a required rest interval',()=>{
    for(const info of [data(false),{...data(),verifications:data().verifications.map(r=>r.target_type==='facility'?{...r,valid_until:'2026-11-16T00:00:00Z'}:r)}]){
        const plan=planJourney(nodes,edges,info,input({require_rests:true}));assert.equal(plan.recommended,null);assert.match(plan.reasons[0],/verified rest/);
    }
});
test('walking budgets include rest time; infeasible needs are not relaxed',()=>{
    assert.equal(planJourney(nodes,edges,data(),input({require_rests:true,rest_duration_min:2,budget_min:5})).recommended,null);
    assert.ok(planJourney(nodes,edges,data(),input({budget_min:5})).routes.direct);
});
test('automatic entrance selection can use a shorter unverified option within a tight budget, while preserving yellow',()=>{
    const info=data();info.assets.push(asset(102,'entrance',2,1,'100'));
    const request=input({require_rests:true,rest_duration_min:2,budget_min:5});
    const route=planJourney(nodes,edges,info,request).routes.direct;
    assert.equal(route.entrance.id,'102');assert.equal(route.suitability,'yellow');assert.ok(route.total_min<=5);
    assert.equal(planJourney(nodes,edges,info,{...request,entrance_id:'101'}).recommended,null);
});
test('rest facilities that open by arrival can fulfil the walking interval',()=>{
    const info=data();for(const id of [201,202])info.verifications.push(record('facility',id,{opening_hours:'Mo-Fr 09:01-17:00'},{observed_at:'2026-11-16T00:00:00Z'}));
    const plan=planJourney(nodes,edges,info,input({require_rests:true}));
    assert.equal(plan.routes.direct?.verified_rest_stops,2);
});
test('rest detours count toward the continuous-walking limit',()=>{
    const info=data();info.assets=info.assets.filter(a=>a.kind!=='rest');const seat=asset(203,'rest',1,.5);
    seat.connection_distance_m=10;info.assets.push(seat);info.verifications.push(record('facility',203,{available:true,path_connection:true,step_free:true,has_seat:true}));
    assert.equal(planJourney(nodes,[edges[0]],info,input({require_rests:true})).recommended,null);
});
test('latest reported obstruction overrides an older checked path',()=>{
    const info=data();info.verifications.push(record('path',1,{path_open:false},{status:'reported',observed_at:'2026-11-16T00:00:00Z'}));
    assert.deepEqual(planJourney(nodes,edges,info,input()).routes.direct.edge_ids,[2,3]);
});
test('closed entrances are excluded and another usable entrance is selected',()=>{
    const info=data();info.verifications.push(record('entrance',101,{opening_hours:'12:00-13:00'},{observed_at:'2026-11-16T00:00:00Z'}));
    const alternate=asset(102,'entrance',2,1,'100');info.assets.push(alternate);
    info.verifications.push(record('entrance',102,{available:true,path_connection:true,step_free:true,opening_hours:'24/7'}));
    assert.equal(planJourney(nodes,edges,info,input()).routes.direct.entrance.id,'102');
    assert.equal(planJourney(nodes,edges,info,{...input(),entrance_id:'101'}).recommended,null);
});
test('opening hours are checked at arrival, allowing a point that opens during the walk',()=>{
    const info=data();info.verifications.push(record('entrance',101,{opening_hours:'Mo-Fr 09:05-17:00'},{observed_at:'2026-11-16T00:00:00Z'}));
    const plan=planJourney(nodes,edges,info,{...input({verified_only:true}),departure_at:'2026-11-17T01:04:00Z'});
    assert.equal(plan.routes.direct.suitability,'green');
});
test('expired entrance checks cannot be rescued by old verified records',()=>{
    const info=data();info.verifications.push(record('entrance',101,{step_free:true},{observed_at:'2026-11-15T00:00:00Z',valid_until:'2026-11-16T00:00:00Z'}));
    assert.equal(planJourney(nodes,edges,info,input({verified_only:true})).recommended,null);
    assert.equal(planJourney(nodes,edges,info,input()).routes.direct.suitability,'yellow');
});
test('wheelchair requirements remain enforced even when the personal checkbox is off',()=>{
    const info=data();info.verifications.push(record('entrance',101,{step_free:false},{observed_at:'2026-11-16T00:00:00Z'}));
    assert.equal(planJourney(nodes,edges,info,{...input({step_free:false}),profile:'wheelchair'}).recommended,null);
});
test('live hazards on original edges are respected after mid-edge facility splitting',()=>{
    const hazards=[{id:1,edge_id:1,kind:'blocked',status:'open'}];
    assert.deepEqual(planJourney(nodes,edges,data(),input(),hazards).routes.direct.edge_ids,[2,3]);
});
test('crossing waits are charged once when the edge is split',()=>{
    const ctx={profile:'senior',mode:'direct',slot:'midday',speedMps:1,hazards:indexHazards([])};
    const e={...edges[0],is_crossing:true,crossing_type:'signalised',crossing_width_m:5,ped_green_s:10,cycle_s:60};
    const whole=evaluateEdge(e,ctx);const a=evaluateEdge({...e,id:-1,source_edge_id:e.id,source_length_m:e.length_m,cost_fraction:.4,length_m:48},ctx);
    const b=evaluateEdge({...e,id:-2,source_edge_id:e.id,source_length_m:e.length_m,cost_fraction:.6,length_m:72},ctx);
    assert.ok(Math.abs(a.cost+b.cost-whole.cost)<1e-8);assert.ok(Math.abs(a.wait_s+b.wait_s-whole.wait_s)<1e-8);
});
test('changing departure time changes estimated uncovered distance',()=>{
    const morning=planJourney(nodes,edges,data(),input()).routes.direct;
    const afternoon=planJourney(nodes,edges,data(),{...input(),departure_at:'2026-11-17T08:00:00Z'}).routes.direct;
    assert.ok(afternoon.uncovered_m<morning.uncovered_m);
    const night=planJourney(nodes,edges,data(),{...input(),departure_at:'2026-11-17T13:00:00Z'}).routes.direct;
    assert.equal(night.uncovered_m,0);
});
test('reachable-place discovery uses the same needs and actual entrances',()=>{
    const info=data();const closed={...info.assets[0],id:'999',name:'Unconnected clinic'};info.assets.push(closed);
    const results=reachablePlaces(nodes,edges,info,input());
    assert.ok(results.find(r=>r.destination.id==='100').route);assert.equal(results.find(r=>r.destination.id==='999').route,null);
});
test('a remote start is not silently snapped across an unmapped gap',()=>{
    assert.equal(planJourney(nodes,edges,data(),{...input(),origin:[4,102]}).recommended,null);
});
test('stored preferences are validated rather than trusted as arbitrary input',()=>{
    const result=normaliseNeeds({budget_min:Infinity,max_slope_pct:-1,rest_interval_min:0,speed_mps:99,step_free:'yes'});
    assert.equal(result.budget_min,30);assert.equal(result.max_slope_pct,0);assert.equal(result.rest_interval_min,1);assert.equal(result.speed_mps,1.8);assert.equal(result.step_free,false);
});

test('seating features must be checked before they can satisfy a personal requirement',()=>{
    assert.equal(planJourney(nodes,edges,data(),input({require_rests:true,rest_backrest:true})).recommended,null);
    const info=data();for(const id of [201,202])info.verifications.push(record('facility',id,{backrest:true},{observed_at:'2026-11-16T00:00:00Z'}));
    assert.equal(planJourney(nodes,edges,info,input({require_rests:true,rest_backrest:true})).routes.direct.verified_rest_stops,2);
});

test('checks that expire during the walk cannot produce a green verified-only trip',()=>{
    const info=data();info.verifications=info.verifications.map(r=>r.target_type==='path'?{...r,valid_until:'2026-11-17T01:00:30Z'}:r);
    assert.equal(planJourney(nodes,edges,info,input({verified_only:true})).recommended,null);
    assert.equal(planJourney(nodes,edges,info,input()).routes.direct.suitability,'yellow');
});

test('a seat whose checks expire before arrival cannot fulfil the rest interval',()=>{
    const info=data();info.verifications=info.verifications.map(r=>r.target_id==='201'?{...r,valid_until:'2026-11-17T01:00:30Z'}:r);
    assert.equal(planJourney(nodes,edges,info,input({require_rests:true})).recommended,null);
});

test('uneven-surface preferences are enforced without a fallback over that surface',()=>{
    const info=data();info.verifications.push(record('path',1,{surface_rating:2},{observed_at:'2026-11-16T00:00:00Z'}));
    assert.deepEqual(planJourney(nodes,edges,info,input({avoid_uneven_surfaces:true})).routes.direct.edge_ids,[2,3]);
});


test('a mapped destination across a network gap gives a connection issue', () => {
    const separated = { ...edges[0], id: 20, from_node: 20, to_node: 21, geometry: [[101.003, 3], [101.004, 3]] };
    const target = { ...input().destination, lng: 101.004 };
    const entrance = { ...asset(101, 'entrance', 1, 1, target.id), lng: 101.004, anchor_lng: 101.004, edge_id: 20 };
    const network = [...nodes, { id: 20, lat: 3, lng: 101.003 }, { id: 21, lat: 3, lng: 101.004 }];
    const plan = planJourney(network, [...edges, separated], { ...data(false), assets: [target, entrance] }, { ...input(), destination: target });
    assert.equal(plan.issue?.kind, 'connection');
    assert.equal(plan.recommended, null);
});

test('a longer budget is suggested only when it preserves the selected walking needs', () => {
    const path = { ...edges[0], length_m: 560 };
    const request = input({ budget_min: 5 });
    const run = (edge, parameters = request) => dispatchPlan({ nodes, edges: [edge], walking: data(false), hazards: [] },
        { type: 'journey', input: parameters, suggestBudget: true });
    const short = run(path);
    assert.deepEqual(short.issue, { kind: 'budget', estimated_min: 10, suggested_min: 10 });
    assert.equal(short.recommended, null);
    assert.ok(run(path, input({ budget_min: 10 })).routes.direct);
    assert.equal(run({ ...path, has_steps: true }).issue?.kind, 'needs');
});
