import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPagesPilot } from '../scripts/pilot-export.mjs';
import { matchCommunityPath, publicRoutePoints } from '../lib/community-routes.ts';
import { planCommunityJourney, planJourney } from '../lib/journeys.ts';
import { placeHours } from '../lib/place-details.ts';
import { DEFAULT_NEEDS } from '../lib/walking.ts';
import { pilotFixture } from './helpers/pilot-fixture.mjs';

const { bundle } = pilotFixture();
const request = { origin: [3.1425, 101.694], profile: 'senior', needs: DEFAULT_NEEDS, departure_at: '2026-11-23T03:00:00Z' };
const { nodes, edges } = bundle.graph;
const points = [[3.1425, 101.694], [3.1425, 101.696], [3.1425, 101.698]];
const path = matchCommunityPath(nodes, edges, points);
const approved = { id: 'test-route', dataset_id: bundle.walking.dataset_id, status: 'verified', path,
    title: 'Test public shortcut', valid_until: '2026-12-01T00:00:00Z', opening_hours: '24/7' };

test('community geometry retains walking direction and rejects disconnected gaps', () => {
    assert.ok(path && path.length_m > 400);
    assert.equal(matchCommunityPath(nodes, edges, [[3.1425, 101.694], [3.143, 101.695]]), null);
    const oneWay = edges.map(edge => ({ ...edge, foot_direction: edge.geometry[0][0] < edge.geometry.at(-1)[0] ? 'forward' : 'backward' }));
    assert.equal(matchCommunityPath(nodes, oneWay, points.slice().reverse()), null);
    assert.deepEqual(publicRoutePoints([[3.142, 101.693], ...points, [3.144, 101.699]], 1, 1), points);
});

test('community navigation uses current needs, checked access hours and live hazards', () => {
    const plan = (route, needs = DEFAULT_NEEDS, hazards = []) =>
        planCommunityJourney(nodes, edges, bundle.walking, { ...request, needs }, route, hazards);
    assert.deepEqual(plan(approved).routes.direct.edge_ids, path.edge_ids);
    assert.equal(plan(approved).routes.direct.community_id, approved.id);
    assert.equal(plan({ ...approved, status: 'published' }).recommended, null);
    assert.equal(plan({ ...approved, valid_until: '2026-11-22T00:00:00Z' }).recommended, null);
    assert.equal(plan({ ...approved, opening_hours: 'Mo 14:00-16:00' }).recommended, null);
    assert.equal(plan(approved, { ...DEFAULT_NEEDS, verified_only: true }).recommended, null);
    assert.equal(plan(approved, DEFAULT_NEEDS, [{ id: 1, edge_id: path.edge_ids[0], kind: 'blocked', status: 'verified' }]).recommended, null);
});

test('a confirmed lift outage changes step-free arrival without closing the adjacent path', () => {
    const destination = bundle.walking.assets.find(asset => asset.name === 'Test clinic');
    const entrance = bundle.walking.assets.find(asset => asset.parent_id === destination.id);
    const hazards = [{ id: 1, edge_id: entrance.edge_id, asset_id: entrance.id, kind: 'lift_out', status: 'verified' }];
    const stepFree = { ...request, destination, needs: { ...request.needs, step_free: true } };
    assert.ok(planJourney(nodes, edges, bundle.walking, stepFree).routes.direct);
    assert.equal(planJourney(nodes, edges, bundle.walking, stepFree, hazards).recommended, null);
    assert.ok(planJourney(nodes, edges, bundle.walking, { ...request, destination }, hazards).routes.direct);
});

test('venue hours are evaluated at arrival and the source import keeps exact map identities', async () => {
    const info = structuredClone(bundle.walking);
    const dest = info.assets.find(asset => asset.name === 'Test clinic');
    dest.properties.official_hours = 'Mo 10:00-11:01';
    assert.equal(placeHours(dest, request.departure_at, []).open, true);
    assert.equal(planJourney(nodes, edges, info, { ...request, destination: dest }).recommended, null);

    const kl = await loadPagesPilot('data/pasar-seni/bundle.json');
    const park = kl.walking.assets.find(asset => asset.source_ref.endsWith('/way/111547419') && asset.kind === 'destination');
    assert.equal(park.properties.official_name, 'Taman Botani Perdana');
    assert.equal(kl.walking.assets.filter(asset => asset.parent_id === park.id && asset.edge_id).length, 6);
    assert.equal(kl.walking.verifications.length, 0);
    const um = await loadPagesPilot('data/um-campus/bundle.json', 'um-campus');
    assert.equal(Object.keys(um.directory_properties).length, 7);
    assert.ok(um.walking.assets.some(asset => asset.properties.official_name === 'Klinik Kesihatan Pelajar'));
});
