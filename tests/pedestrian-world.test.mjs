import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildPedestrianModel, wayFacts, sharedShadeDataset } from '../scripts/pedestrian-model.mjs';
import { loadWalkingWorld, representativeShade } from '../scripts/walking-world-source.mjs';
import { applyExternal, applySurvey } from '../scripts/pedestrian-external.mjs';
import { buildCartography } from '../scripts/map-cartography.mjs';
import { solarModel, sunVector } from '../lib/solar-shade.ts';
import { buildGraph, reachableNodes } from '../lib/routing.ts';
import { splitPathAnchors } from '../lib/path-anchors.ts';
import { enrichWorldEdges, mapLevelMatches } from '../lib/pedestrian-world.ts';
import { DEFAULT_NEEDS } from '../lib/walking.ts';
import { edgeRestrictions, observedEdge } from '../lib/route-conditions.ts';
import { pedestrianCue } from '../lib/pedestrian-guidance.ts';
import { parseWeather, forecastWeights } from '../lib/comfort.ts';
import { compareMaintenanceImpact, infrastructureCandidates, connectionScenario } from '../lib/maintenance-impact.ts';
import { pathShade } from '../lib/route-shade.ts';
import { corridorRing,crownRing } from '../lib/pedestrian-geometry.ts';
import { metres } from '../lib/walking-geometry.ts';

const AT='2026-11-28T04:00:00.000Z', point=[101.695,3.142];
const square=(centre,dx=.00005)=>{const [x,y]=centre;return [[x-dx,y-dx],[x+dx,y-dx],[x+dx,y+dx],[x-dx,y+dx],[x-dx,y-dx]];};
const geom=line=>line.map(([lon,lat])=>({lon,lat}));
const line=[point,[point[0]+.0005,point[1]]];
const osm=(id,tags,coordinates=line)=>({type:'way',id,tags,geometry:geom(coordinates)});
const rawEdge=(id,from,to,geometry=line,extra={})=>({id,from_node:from,to_node:to,geometry,length_m:metres(geometry[0],geometry.at(-1)),kind:'footway',pedestrian_access:true,has_steps:false,slope_pct:null,surface_rating:null,is_crossing:false,crossing_type:null,crossing_width_m:null,ped_green_s:null,cycle_s:null,has_kerb_ramp:null,shade_morning:null,shade_midday:null,shade_afternoon:null,shade_source:null,lit_ratio:null,lighting_source:null,...extra});
const world=(level,extra={})=>({source:'osm',structure:'indoor',levels:[level],levelGroups:[level===0?'ground':level>0?'above':'below'],restricted:false,...extra});
const node=(id,p)=>({id,lng:p[0],lat:p[1]});
const record=(target_id,attributes,extra={})=>({id:'1',target_type:'path',target_id:String(target_id),observed_at:'2026-11-27T00:00:00Z',created_at:'2026-11-27T00:00:00Z',status:'verified',valid_until:'2026-12-28T00:00:00Z',attributes,reviewer:'Test reviewer',method:'site_visit',source_ref:'',notes:'Fixture',...extra});

test('procedural geometry uses actual path tags and never promotes schematic dimensions to sunlight or verified access',()=>{
    const elements=[osm(1,{highway:'footway',covered:'yes',bridge:'yes',layer:'1',width:'2.5',level:'1'}),osm(2,{highway:'steps',step_count:'12',ramp:'yes'}),osm(3,{highway:'footway',tactile_paving:'yes',incline:'4%',ramp:'yes'}),osm(4,{highway:'footway',tunnel:'yes',layer:'-1'}),osm(5,{highway:'elevator',level:'-1;0'},square(point)),osm(6,{building:'yes',height:'15'},square([point[0]+.001,point[1]])),osm(7,{building:'yes'},square([point[0]-.001,point[1]])),osm(8,{natural:'wood'},square([point[0],point[1]+.001])),{type:'node',id:9,tags:{amenity:'bench'},lon:point[0],lat:point[1]}];
    const base=buildCartography(elements),generated=buildPedestrianModel(elements,base,'pasar-seni');
    const m=generated.features;
    assert.ok(m.some(f=>f.properties.modelKind==='roof'&&f.properties.visualOnly&&f.properties.width===2.5));
    assert.ok(m.some(f=>f.properties.modelKind==='bridge'&&f.properties.levelGroup==='above'));
    assert.equal(m.find(f=>f.properties.modelKind==='stairs').geometry.coordinates.length,12);
    assert.ok(m.some(f=>f.properties.modelKind==='ramp'&&f.properties.slope===4));
    assert.ok(m.some(f=>f.properties.modelKind==='underpass'&&f.geometry.type==='LineString'));
    assert.ok(m.some(f=>f.properties.modelKind==='lift'&&f.geometry.type==='Point'));
    assert.equal(generated.ways['2'].connector,'stairs');
    assert.ok(generated.gaps.some(f=>f.properties.kind==='wooded area'));
    assert.ok(generated.gaps.some(f=>f.properties.missing.includes('tactile paving continuity')));
    const solar=sharedShadeDataset([...base,...m],point,generated.ways);
    assert.equal(solar.objects.length,1);assert.equal(solar.objects[0].height,15);assert.equal(solar.coverage,'partial');
    assert.ok(solar.non_ground_ways.includes('1'));assert.ok(!solar.non_ground_ways.includes('3'));
    assert.equal(wayFacts({highway:'footway',layer:'1'}).levels.length,0);
    assert.equal(wayFacts({highway:'footway',covered:'no',tunnel:'building_passage'}).covered,false);
    assert.ok(mapLevelMatches('floor:1','above','0;1'));assert.ok(!mapLevelMatches('floor:1','above','10'));
    assert.ok(corridorRing(line,2).length>=5);assert.equal(crownRing(point,6).length,13);
});

test('distinct mapped floor junctions cannot silently join, but a mapped stair connecting real nodes can',()=>{
    const nodes=[node(1,point),node(2,line[1]),node(3,[line[1][0]+.0005,point[1]]),node(4,[line[1][0],point[1]+.0001]),node(5,[line[1][0],point[1]+.0002])];
    const a=rawEdge(1,1,2,line,{world:world(0)}),b=rawEdge(2,2,3,[[nodes[1].lng,nodes[1].lat],[nodes[2].lng,nodes[2].lat]],{world:world(1)});
    assert.ok(!reachableNodes(buildGraph(nodes,[a,b]),[1]).has(3));
    const split=splitPathAnchors(nodes,[a,b],[{key:'ground',edge_id:1,fraction:1},{key:'upper',edge_id:2,fraction:0}]);
    assert.notEqual(split.anchors.get('ground'),split.anchors.get('upper'));
    const lower=rawEdge(3,1,4,[point,[nodes[3].lng,nodes[3].lat]],{world:world(0)});
    const stairs=rawEdge(4,4,5,[[nodes[3].lng,nodes[3].lat],[nodes[4].lng,nodes[4].lat]],{kind:'steps',has_steps:true,world:{...world(0),levels:[0,1],connector:'stairs'}});
    const upper=rawEdge(5,5,3,[[nodes[4].lng,nodes[4].lat],[nodes[2].lng,nodes[2].lat]],{world:world(1)});
    assert.ok(reachableNodes(buildGraph(nodes,[lower,stairs,upper]),[1]).has(3));
});

test('modelled facts match by way ID, verified records override them, and shade slots match a graph fingerprint',()=>{
    const edge=rawEdge(1,1,2,line,{osm_way_id:42,shade_midday:.4,shade_source:'modelled'});
    const sidecar={area:'pasar-seni',version:1,ways:{42:{...world(1),covered:true,tactile:true,clearWidth:1.6}},shadeDatasetId:'graph-A',shadeByEdge:{1:{shade_midday:.8}}};
    const enriched=enrichWorldEdges([edge],sidecar,'graph-A')[0];
    assert.equal(enriched.covered,true);assert.equal(enriched.clear_width_m,1.6);assert.equal(enriched.shade_midday,1);
    assert.equal(enrichWorldEdges([edge],sidecar,'graph-B')[0].shade_midday,.4);
    const newer=observedEdge(enriched,[record(1,{covered:false,tactile_continuous:true,deck_height_m:4})],AT);
    assert.equal(newer.covered,false);assert.equal(newer.shade_midday,null);assert.equal(newer.world.elevationM,4);
    const input={profile:'everyday',needs:{...DEFAULT_NEEDS,require_tactile_continuity:true},departure_at:AT};
    assert.ok(edgeRestrictions(enriched,input,[],'direct',[]).some(r=>r.field==='tactile_continuous'));
    assert.ok(!edgeRestrictions(newer,input,[record(1,{tactile_continuous:true})],'direct',[]).some(r=>r.field==='tactile_continuous'));
    assert.ok(edgeRestrictions({...edge,world:{...world(0),openingHours:'closed'}},input,[],'direct',[]).some(r=>r.field==='opening_hours'));
});

test('partial source coverage leaves unmodelled sunlight unknown; courtyards and measured elevated deck heights affect rays',()=>{
    const [east,north,up]=sunVector('2026-11-28',12,point),source=sharedShadeDataset([],point,{});
    const ground=solarModel(source);assert.equal(ground.atPoint(point,Date.parse(AT)).condition,'unknown');
    const top=[point[0]+(east/up)*10/111320,point[1]+(north/up)*10/110574];
    const base={centre:point,coverage:'partial',objects:[{ring:square(top,.00003).slice(0,-1),height:10,base:10}]};
    assert.equal(solarModel(base).atPoint(point,Date.parse(AT)).condition,'shade');
    assert.equal(solarModel(base).atPoint(point,Date.parse(AT),15).condition,'unknown');
    const hole={...base,objects:[{...base.objects[0],holes:[square(top,.000015).slice(0,-1)]}]};
    assert.equal(solarModel(hole).atPoint(point,Date.parse(AT)).condition,'unknown');
    const raised=rawEdge(1,1,2,line,{osm_way_id:1,world:world(1)});
    const model=solarModel({...base,non_ground_ways:['1']});
    assert.equal(pathShade(raised,[],Date.parse(AT),point,model).condition,'unknown');
    assert.equal(pathShade(raised,[record(1,{deck_height_m:15})],Date.parse(AT),point,model).condition,'unknown');
});

test('external import preserves recorded heights, isolates schematic data, and rejects unclear reuse licences',()=>{
    const features=buildCartography([osm(1,{building:'yes',height:'180'},square(point)),osm(2,{building:'yes'},square([point[0]+.001,point[1]]))]);
    const manifest={version:1,area:'pasar-seni',sources:[{id:'google-buildings',license:'CC-BY-4.0',data_at:'2023',sha256:'a'.repeat(64)}],heights:[{osmRef:'way/1',source:'google-buildings',height:65,source_ref:'2023'},{osmRef:'way/2',source:'google-buildings',height:14,source_ref:'2023'}],features:[]};
    const sources=applyExternal(features,'pasar-seni',manifest);
    assert.equal(features.find(f=>f.properties.osmRef==='way/1').properties.height,180);
    assert.equal(features.find(f=>f.properties.osmRef==='way/2').properties.heightSource,'satellite');assert.equal(sources[0].records,1);
    assert.throws(()=>applyExternal([], 'pasar-seni',{...manifest,sources:[{...manifest.sources[0],license:'CC-BY-NC-4.0'}]}),/provenance/);
    assert.throws(()=>applyExternal([], 'pasar-seni',{...manifest,heights:[{osmRef:'way/2',source:'google-buildings',height:100}]}),/Invalid/);
    applySurvey(features,'pasar-seni',{type:'FeatureCollection',source_url:'https://example.test/fixture',license:'CC-BY-4.0',data_at:'2025-01-01',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[square([point[0]+.001,point[1]])]},properties:{kind:'building',height_m:18,osm_ref:'way/2'}}]});
    assert.equal(features.find(f=>f.properties.osmRef==='way/2').properties.height,18);
});

test('forecast values change soft routing weights without fabricating missing values',()=>{
    const weather=parseWeather({current:{time:'2026-11-28T12:00',temperature_2m:30},hourly:{time:['2026-11-28T12:00','2026-11-28T13:00'],apparent_temperature:[34,34],direct_radiation:[500,30],diffuse_radiation:[60,90],cloud_cover:[8,95],relative_humidity_2m:[65,95],precipitation_probability:[10,90],precipitation:[0,2]}},AT);
    const sunny=forecastWeights(weather,Date.parse(AT)),rainy=forecastWeights(weather,Date.parse(AT)+3600000);
    assert.ok(sunny.heat>rainy.heat);assert.ok(rainy.rain>sunny.rain);assert.equal(rainy.forecast.humidity,95);
    assert.equal(forecastWeights(null,Date.parse(AT)).rainRisk,null);
});

test('accessible guidance names a crossing without implying that traffic has stopped, and does not treat mapped tactile paving as continuous',()=>{
    const edge=rawEdge(4,1,2,line,{is_crossing:true,has_tactile:true,world:world(1,{connector:'bridge',tactile:true})});
    const step={kind:'path',name:'Footpath 4',edge_id:4,coordinates:line.map(([lng,lat])=>[lat,lng]),distance_m:55,start_min:0,end_min:1};
    const cue=pedestrianCue(step,edge,[],AT);
    assert.match(cue.detail,/continuity unknown/);assert.match(cue.detail,/not a signal to cross/);assert.match(cue.detail,/GPS cannot confirm floors/);
    const checked=pedestrianCue(step,edge,[record(4,{tactile_continuous:true},{target_type:'crossing'})],AT);assert.match(checked.detail,/Continuous tactile guidance checked/);
});

test('hypothetical roof, canopy, rest seat and link change only the comparison, never the live graph or records',()=>{
    const points=[point,line[1],[point[0]+.001,point[1]],[point[0]+.0014,point[1]]];
    const nodes=points.map((p,i)=>node(i+1,p));
    const edges=[rawEdge(1,1,2,points.slice(0,2)),rawEdge(2,3,4,points.slice(2,4))];
    const info={assets:[],verifications:[],as_of:AT};const prior=JSON.stringify({edges,info});
    const proposals=['roof_cover','tree_canopy','rest_seat'].map(kind=>infrastructureCandidates(edges,kind)[0]);proposals.push(connectionScenario(nodes[1],nodes[2]));
    const outcome=compareMaintenanceImpact(nodes,edges,info,[],{origin:[point[1],point[0]],departure_at:AT,profile:'everyday',minutes:10,scenarios:proposals},{centre:point,objects:[],coverage:'partial'});
    const byKind=Object.fromEntries(outcome.results.map(r=>[r.scenario.kind,r]));
    assert.ok(byKind.roof_cover.afterMetrics.roof_m>outcome.baselineMetrics.roof_m);
    assert.ok(byKind.tree_canopy.afterMetrics.shade_m>=outcome.baselineMetrics.shade_m);
    assert.equal(byKind.rest_seat.afterMetrics.rest_places,1);
    assert.ok(byKind.new_connection.afterMetrics.full_path_m>outcome.baselineMetrics.full_path_m);
    assert.equal(JSON.stringify({edges,info}),prior);
});

test('the real KL and UM archives produce pedestrian models and survey gaps with the same shape geometry used for solar samples',async()=>{
    for(const area of ['pasar-seni','um-campus']){
        const {features,world:data,solar,dataDate}=await loadWalkingWorld(area);
        assert.ok(data.counts.roof>200);assert.ok(data.counts.stairs>200);assert.ok(data.counts.bridge>40);assert.ok(data.counts.tactile>30);assert.ok(data.gaps.some(g=>g.properties.kind==='wooded area'));
        assert.ok(solar.objects.length>500);assert.ok(solar.objects.every(s=>s.height_source!=='approximate'&&s.source_ref));
        const bundle=JSON.parse(await readFile(new URL(`../data/${area}/bundle.json`,import.meta.url),'utf8'));
        const slots=representativeShade(bundle.graph.edges,solar,data.ways,dataDate);
        assert.ok(Object.keys(slots).length>0);assert.ok(Object.values(slots).every(v=>Object.values(v).every(p=>p>0&&p<=1)));
        assert.ok(features.some(f=>f.properties.kind==='infrastructure'&&f.properties.visualOnly));
    }
});
