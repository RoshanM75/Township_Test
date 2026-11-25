import assert from 'node:assert/strict';
import test from 'node:test';
import { nodes,edges,data,input,record,asset,destination,entrance,AT } from './helpers/journey-fixture.mjs';
import { planJourney,reachablePlaces } from '../lib/journeys.ts';
import { journeyReadiness } from '../lib/journey-readiness.ts';
import { groupWalkingSettings } from '../lib/group-walking.ts';
import { defaultWalkingSettings, normaliseWalkingSettings } from '../lib/walking-profile.ts';
import { inspectRoutine } from '../lib/usual-routes.ts';
import { createWalkPack, readLibrary, writeLibrary, emptyLibrary } from '../lib/walk-library.ts';
import { planErrands,errandRequestFromRoute,readErrands } from '../lib/errand-planner.ts';
import { compareMaintenanceImpact,repairCandidates,simulateRepair } from '../lib/maintenance-impact.ts';
import { operatorActivity } from '../lib/operator.ts';
import { walkTimeline } from '../lib/walk-timeline.ts';
import { loadPagesPilot } from '../scripts/pilot-export.mjs';
import { withMappedDetails } from '../lib/pilot-walking-details.ts';
import { fileURLToPath } from 'node:url';

const day2='2026-11-18T01:00:00.000Z';
const later='2026-12-02T01:00:00.000Z';
const hazard=(id,edge_id,kind,status='verified',asset_id=null)=>({id,edge_id,kind,status,asset_id,lat:3,lng:101});
const routineFeed=(walking,paths=edges,reports=[],hazards=[])=>({walking,edges:paths,reports,hazards,community:[],fetched_at:day2,snapshot:false});

test('readiness distinguishes current, expired and mapped fields without certifying unknown routes',()=>{
    const info=data(),request=input();
    const route=planJourney(nodes,edges,info,request,[],null,['direct']).routes.direct;
    const ready=journeyReadiness(route,request.profile,request.needs,edges,info,[],[]);
    assert.ok(ready.checks.checked>0);
    assert.equal(ready.stepFree,'checked');
    assert.equal(ready.entranceChecked,true);
    assert.ok(ready.nextReview);
    const expired=journeyReadiness(route,request.profile,request.needs,edges,info,[],[],later);
    assert.ok(expired.checks.overdue>0);
    assert.equal(expired.stepFree,'needs-checking');
    assert.equal(expired.incomplete,true);
    const mapped=journeyReadiness(route,request.profile,request.needs,edges,data(false),[],[]);
    assert.ok(mapped.checks.unknown>0);
    assert.ok(mapped.checks.mapped>0);
    assert.equal(mapped.stepFree,'needs-checking');
    assert.equal(mapped.entranceChecked,false);
});

test('blocked or incomplete routes return actual barrier targets; a check request itself cannot block a walk',()=>{
    const info=data(false),request=input({verified_only:true});
    const plan=planJourney(nodes,edges,info,request);
    assert.equal(plan.recommended,null);
    assert.ok(plan.barriers?.some(b=>b.state==='unknown'||b.state==='mapped'));
    assert.ok(plan.barriers.every(b=>b.target_id&&b.point.every(Number.isFinite)));
    const open=planJourney(nodes,edges,info,input(),[hazard(1,1,'check_requested')],null,['direct']);
    assert.deepEqual(open.routes.direct?.edge_ids,[1]);
    const inaccessible={...edges[0],is_crossing:true,has_kerb_ramp:false};
    const failure=planJourney(nodes,[inaccessible],info,input());
    assert.equal(failure.recommended,null);
    assert.ok(failure.barriers?.some(b=>b.target_type==='crossing'&&b.field==='has_kerb_ramp'));
});

test('group planning preserves every required condition and the slowest pace without changing the saved profile',()=>{
    const base=defaultWalkingSettings(),before=JSON.stringify(base);
    const wheelchair=normaliseWalkingSettings('wheelchair',{...base.needs,speed_mps:.6,min_clear_width_m:1.2,require_rests:true,rest_interval_min:4,rest_armrests:true});
    const other=normaliseWalkingSettings('everyday',{...base.needs,require_audible_crossings:true,verified_only:true,speed_mps:.5,require_rests:true,rest_interval_min:3,min_clear_width_m:1.5,rest_shelter:true});
    const all=groupWalkingSettings([base,wheelchair,other]);
    assert.equal(all.profile,'wheelchair');
    assert.equal(all.needs.speed_mps,.5);
    assert.equal(all.needs.step_free,true);
    assert.equal(all.needs.verified_only,true);
    assert.equal(all.needs.require_audible_crossings,true);
    assert.equal(all.needs.require_rests,true);
    assert.equal(all.needs.rest_interval_min,3);
    assert.equal(all.needs.min_clear_width_m,1.5);
    assert.equal(all.needs.rest_armrests,true);
    assert.equal(all.needs.rest_shelter,true);
    assert.equal(JSON.stringify(base),before);
});

test('private usual routes round-trip through the device library and detect mapped changes, new evidence and repairs',()=>{
    const info={...data(),area_id:'pasar-seni',dataset_id:'fixture'},request=input();
    const route=planJourney(nodes,edges,info,request,[],null,['direct']).routes.direct;
    const pack={...createWalkPack(route,request.profile,request.needs,request.origin,edges,info,AT),routine:{label:'My regular trip',enabled:true}};
    const storage={value:'',setItem(_key,value){this.value=value;},getItem(){return this.value;}};
    writeLibrary({...emptyLibrary(),packs:[pack]},storage);
    assert.equal(readLibrary(storage).library.packs[0].routine.label,'My regular trip');
    assert.equal(inspectRoutine(pack,routineFeed(info),day2).status,'current');
    const changed={...info,verifications:[...info.verifications,record('entrance',101,{lift_available:false},{observed_at:day2,created_at:day2})]};
    const repaired={id:'case',edge_id:1,category:'Access barrier',kind:'blocked',location_name:'Path 1',status:'fixed',created_at:AT,fixed_at:day2};
    const unrelated={...repaired,id:'other',edge_id:99};
    const status=inspectRoutine(pack,routineFeed(changed,edges.map(e=>e.id===1?{...e,covered:true}:e),[repaired,unrelated]),day2);
    assert.equal(status.status,'review');
    assert.ok(status.changes.some(c=>c.title==='Repair recorded'));
    assert.ok(status.changes.some(c=>c.title.includes('Roof cover')));
    assert.ok(status.changes.some(c=>c.detail.includes('Lift availability')));
    assert.ok(!status.changes.some(c=>c.key.includes('other')));
    assert.ok(inspectRoutine(pack,routineFeed(info),later).changes.some(c=>c.title==='Field review overdue'));
    assert.ok(inspectRoutine(pack,routineFeed({...info,dataset_id:'new'}),day2).changes.some(c=>c.key==='dataset'));
    assert.equal(inspectRoutine(pack,undefined,day2).status,'not-checked');
});

function errandData(){
    const middle=asset(110,'destination',1,.5),door=asset(111,'entrance',1,.5,'110');
    const info=data();
    info.assets=[{...destination,properties:{opening_hours:'24/7'}},entrance,{...middle,properties:{opening_hours:'24/7'}},door];
    info.verifications.push(record('entrance',111,{available:true,path_connection:true,step_free:true,opening_hours:'24/7'}));
    return info;
}
const errands={stops:[{place_id:'100',dwell_min:2},{place_id:'110',dwell_min:3}],return_to_start:true,compare_order:true};

test('errand itinerary includes real legs, stop durations, return and comparison orders',()=>{
    const info=errandData(),request=input({budget_min:15});
    const plan=planErrands(nodes,edges,info,request,errands);
    assert.ok(plan.routes.direct,plan.reasons.join('; '));
    const route=plan.routes.direct;
    assert.equal(route.errand_stops.length,2);
    assert.ok(plan.compared_itineraries.length>=2);
    assert.ok(route.errand_returns);
    assert.deepEqual(route.coordinates[0],route.coordinates.at(-1));
    assert.ok(Math.abs(route.total_min-(route.walk_min+5))<.01);
    assert.ok(walkTimeline(route,edges,info.verifications).some(step=>step.kind==='errand'));
    assert.deepEqual(readErrands(JSON.stringify(errandRequestFromRoute(route))).stops.map(s=>s.place_id),route.errand_stops.map(s=>s.destination.id));
    assert.equal(readErrands(JSON.stringify({...errands,stops:[errands.stops[0],errands.stops[0]]})),null);
    assert.equal(planErrands(nodes,edges,info,input({budget_min:5}),errands).recommended,null);
});

test('errands do not reset required rests at an unchecked stop, or accept a visit after closing',()=>{
    const info=errandData();
    const pair={stops:[{place_id:'110',dwell_min:0},{place_id:'100',dwell_min:0}],return_to_start:false,compare_order:false};
    const each=planJourney(nodes,[edges[0]],info,{...input({require_rests:true,rest_interval_min:1.2}),destination:info.assets[2]},[],null,['direct']);
    assert.ok(each.routes.direct);
    const long=planErrands(nodes,[edges[0]],info,input({require_rests:true,rest_interval_min:1.2}),pair);
    assert.equal(long.recommended,null);
    const closed=errandData();closed.assets[2]={...closed.assets[2],properties:{opening_hours:'Mo-Fr 09:00-09:03'}};
    const visit={...pair,stops:[{place_id:'110',dwell_min:5},{place_id:'100',dwell_min:0}]};
    assert.equal(planErrands(nodes,edges,closed,input({budget_min:20}),visit).recommended,null);
});

test('last-mile starting entrance stays anchored and a checked lift fault or private access cannot be silently bypassed',()=>{
    const info=errandData();
    const request={...input(),destination:info.assets[2],origin:[entrance.lat,entrance.lng],start_asset_id:entrance.id};
    const route=planJourney(nodes,edges,info,request,[],null,['direct']).routes.direct;
    assert.equal(route.start_asset_id,entrance.id);
    assert.equal(planJourney(nodes,edges,info,request,[hazard(4,1,'lift_out','verified',entrance.id)]).recommended,null);
    assert.equal(planJourney(nodes,edges,{...info,verifications:[...info.verifications,record('entrance',101,{public_access:'private'},{observed_at:AT})]},request).recommended,null);
    assert.equal(planJourney(nodes,edges,info,{...request,origin:[3,101]}).recommended,null);
});

test('reachable comfort search respects restricted facilities and serves actual mapped rest anchors',()=>{
    const info=data();
    const request=input();
    const results=reachablePlaces(nodes,edges,info,request,[],['201','202']);
    assert.equal(results.length,2);
    assert.ok(results.every(item=>item.route));
    const restricted={...info,assets:info.assets.map(a=>a.id==='201'?{...a,properties:{public_access:'private'}}:a)};
    assert.equal(reachablePlaces(nodes,edges,restricted,request,[],['201'])[0].route,null);
});

test('maintenance comparison models a real missing crossing connection without modifying the evidence or counting a building pin',()=>{
    const info=data(false);
    const crossing={...edges[0],is_crossing:true,crossing_type:'zebra',has_kerb_ramp:false};
    const selected=repairCandidates([crossing],info,[])[0];
    assert.equal(selected.kind,'no_ramp');
    const req={origin:[3,101],departure_at:AT,profile:'wheelchair',minutes:10,scenarios:[selected]};
    const results=compareMaintenanceImpact(nodes,[crossing],info,[],req);
    assert.equal(results.baseline,0);
    assert.equal(results.results[0].after,1);
    assert.equal(results.results[0].gained[0].id,'100');
    const copy=JSON.stringify(info);
    const hypothetical=simulateRepair(info,[crossing],[],selected,AT);
    assert.equal(hypothetical.data.verifications.at(-1).status,'unverified');
    assert.equal(JSON.stringify(info),copy);
    assert.equal(crossing.has_kerb_ramp,false);
    const blocked=[hazard(11,1,'blocked')];
    assert.equal(compareMaintenanceImpact(nodes,[crossing],info,blocked,req).results[0].after,0);
});

test('the OSM snapshot adds access and place-purpose details without fabricated field checks',async()=>{
    for(const area of ['pasar-seni','um-campus']){
        const bundle=await loadPagesPilot(fileURLToPath(new URL(`../data/${area}/bundle.json`,import.meta.url)),area);
        const mapped=withMappedDetails(bundle.graph.edges,bundle.walking,bundle.context).walking;
        assert.ok(mapped.assets.some(a=>typeof a.properties.osm_amenity==='string'||typeof a.properties.osm_shop==='string'));
        assert.ok(mapped.assets.some(a=>typeof a.properties.public_access==='string'));
        assert.equal(mapped.verifications.length,0);
    }
});

test('resolved field-check requests do not inflate physical repair KPIs',()=>{
    const fixture={id:'check',category:'Condition verification',kind:'check_requested',edge_id:1,created_at:AT,checked_at:day2,fixed_at:day2,status:'fixed'};
    const result=operatorActivity([fixture],'pasar-seni',7,day2);
    assert.equal(result.fixed,0);
    assert.equal(result.resolved_field_checks,1);
    assert.equal(result.checked,1);
});

test('automatically chosen errand purposes compare real nearby candidates and produce concrete stops',()=>{
    const info=errandData();
    info.assets[0]={...info.assets[0],category:'food',name:'Lunch stall'};
    info.assets[2]={...info.assets[2],category:'healthcare',properties:{...info.assets[2].properties,osm_amenity:'pharmacy'}};
    const goals={stops:[{place_id:'',goal:'food',dwell_min:2},{place_id:'',goal:'pharmacy',dwell_min:1}],return_to_start:true,compare_order:true};
    const parsed=readErrands(JSON.stringify(goals));
    assert.ok(parsed);
    const plan=planErrands(nodes,edges,info,input({budget_min:15}),parsed);
    assert.ok(plan.routes.direct,plan.reasons.join(' '));
    assert.deepEqual(new Set(plan.routes.direct.errand_stops.map(stop=>stop.destination.id)),new Set(['100','110']));
    assert.ok(errandRequestFromRoute(plan.routes.direct).stops.every(stop=>stop.place_id));
});

test('a real Bangsar model can compare a mapped stair connection, with no claims of field verification',async()=>{
    const area='pasar-seni',bundle=await loadPagesPilot(fileURLToPath(new URL('../data/pasar-seni/bundle.json',import.meta.url)),area);
    const {edges,walking}=withMappedDetails(bundle.graph.edges,bundle.walking,bundle.context);
    const start=bundle.context.neighbourhoods.find(item=>item.id==='bangsar').start.coordinates;
    const scenario=repairCandidates(edges,walking,[]).find(s=>s.target_id==='7332149513152');
    assert.ok(scenario);
    const result=compareMaintenanceImpact(bundle.graph.nodes,edges,walking,[],{origin:start,departure_at:'2026-11-25T04:00:00Z',profile:'wheelchair',minutes:10,scenarios:[scenario]});
    assert.ok(result.results[0].after>result.baseline);
    assert.ok(result.results[0].gained.length>0);
    assert.equal(walking.verifications.length,0);
});
