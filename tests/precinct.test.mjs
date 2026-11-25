import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_ORIGIN, DESTINATIONS } from '../lib/precinct.ts';
import { buildGraph, planRoutes } from '../lib/routing.ts';
import { planJourney } from '../lib/journeys.ts';
import { DEFAULT_NEEDS } from '../lib/walking.ts';

test('sample places belong to the imported precinct and have pedestrian routes', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'township-precinct-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    execFileSync(process.execPath, ['scripts/osm-to-graph.mjs', '--in', 'precinct.json', '--out-json', join(dir, 'graph.json')]);
    const data = JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8'));
    const graph = buildGraph(data.nodes, data.edges);
    assert.ok(data.nodes.some((n) => n.lat === DEFAULT_ORIGIN[0] && n.lng === DEFAULT_ORIGIN[1]));
    for (const [index,destination] of DESTINATIONS.entries()) {
        assert.ok(data.nodes.some((n) => n.lat === destination.coords[0] && n.lng === destination.coords[1]));
        const nodeId=Number(destination.osm_node_id);
        const edge=data.edges.find(e=>e.from_node===nodeId || e.to_node===nodeId);
        assert.ok(edge,'Each example entrance must touch its actual OSM node.');
        const place={id:String(1000+index*2),external_id:destination.id,parent_id:null,kind:'destination',category:'park',name:destination.name,
            lat:destination.coords[0],lng:destination.coords[1],source:'osm',source_ref:`https://www.openstreetmap.org/node/${nodeId}`,properties:{},
            edge_id:null,edge_fraction:null,connection_distance_m:null,anchor_lat:null,anchor_lng:null};
        const entrance={...place,id:String(1001+index*2),external_id:null,kind:'entrance',parent_id:place.id,
            edge_id:edge.id,edge_fraction:edge.from_node===nodeId?0:1,connection_distance_m:0,anchor_lat:place.lat,anchor_lng:place.lng};
        const walking={assets:[place,entrance],verifications:[],as_of:'2026-11-17T04:00:00Z'};
        for (const profile of ['everyday', 'senior', 'cane_walker', 'wheelchair', 'stroller']) {
            const plan = planRoutes(graph, DEFAULT_ORIGIN, destination.coords, profile, 'midday', []);
            assert.ok(plan.routes.direct, `${profile} must have a sample walk to ${destination.name}`);
            assert.ok(plan.routes.direct.length_m > 50);
            assert.ok(plan.routes.direct.edge_ids.every((id) => graph.edges.get(id).pedestrian_access === true));
            const personal=planJourney(data.nodes,data.edges,walking,{origin:DEFAULT_ORIGIN,destination:place,profile,
                needs:DEFAULT_NEEDS,departure_at:walking.as_of});
            assert.ok(personal.routes.direct,`${profile} must fit the default budget to ${destination.name}`);
            assert.ok(personal.routes.direct.total_min<=DEFAULT_NEEDS.budget_min);
            assert.equal(personal.routes.direct.suitability,'yellow','Mapped sample paths must not claim current verification.');
        }
    }
});
