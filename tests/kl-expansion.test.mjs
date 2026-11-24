import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { loadPagesPilot } from '../scripts/pilot-export.mjs';
import { planJourney } from '../lib/journeys.ts';
import { KL_CORE_BOUNDS, pointInBounds } from '../lib/pilots.ts';
import { buildGraph } from '../lib/routing.ts';
import { presetStartPoints } from '../lib/start-points.ts';
import { DEFAULT_NEEDS } from '../lib/walking.ts';
import { metres } from '../lib/walking-geometry.ts';

const path = new URL('../data/pasar-seni/bundle.json', import.meta.url);
const base = JSON.parse(readFileSync(path));
const expanded = await loadPagesPilot(path.pathname);

test('the wider KL snapshot preserves the original verification targets and uses source pedestrian ways', () => {
    assert.equal(expanded.context.dataset_id, base.context.dataset_id);
    assert.deepEqual(expanded.graph.edges.slice(0, base.graph.edges.length), base.graph.edges);
    assert.deepEqual(expanded.graph.nodes.slice(0, base.graph.nodes.length), base.graph.nodes);
    assert.deepEqual(expanded.walking.assets.slice(0, base.walking.assets.length).map(asset => asset.id), base.walking.assets.map(asset => asset.id));
    const details = JSON.parse(readFileSync(new URL('../data/pasar-seni/walking-details.json', import.meta.url)));
    assert.deepEqual(expanded.context.walking_details.shade, details.context.walking_details.shade);
    const original = new Set(base.graph.edges.map(edge => edge.osm_way_id));
    const source = JSON.parse(gunzipSync(readFileSync(new URL('../data/pasar-seni/source/expanded-map-osm.json.gz', import.meta.url))));
    const ways = new Map(source.elements.filter(element => element.type === 'way').map(way => [way.id, way]));
    assert.ok(expanded.appended_graph.edges.length > 2500);
    for (const edge of expanded.appended_graph.edges) {
        const way = ways.get(edge.osm_way_id);
        assert.ok(way && !original.has(way.id) && !way.tags['access:conditional'] && !way.tags['foot:conditional']);
        assert.ok(['footway', 'path', 'pedestrian', 'steps', 'crossing', 'cycleway', 'service', 'track'].includes(way.tags.highway));
        assert.ok(way.geometry.some(({ lon, lat }) => !pointInBounds([lat, lon], KL_CORE_BOUNDS)));
    }
});

test('all five neighbourhoods expose local transit and places, with starts only on mapped paths', () => {
    const { context, graph, walking } = expanded;
    const starts = presetStartPoints(context, walking.assets, buildGraph(graph.nodes, graph.edges));
    assert.deepEqual(context.neighbourhoods.map(item => item.name),
        ['Bangsar', 'Brickfields', 'Perdana Botanical Gardens', 'Pudu', 'Bukit Bintang']);
    for (const place of context.neighbourhoods) {
        const [lat, lng] = place.coordinates;
        assert.ok(context.transit.stops.some(stop => metres([lng, lat], [stop.lng, stop.lat]) < 800), place.name);
        assert.ok(walking.assets.some(asset => asset.kind === 'destination' && metres([lng, lat], [asset.lng, asset.lat]) < 500), place.name);
        assert.equal(starts.some(start => start.id === place.id), !!place.start, place.name);
    }
    const pudu = context.neighbourhoods.find(item => item.id === 'pudu');
    const [lat, lng] = pudu.coordinates;
    assert.ok(walking.assets.filter(asset => asset.kind === 'destination' && metres([lng, lat], [asset.lng, asset.lat]) < 500).length > 30);
});

test('Bintang Walk routes over new edges to a real local destination', () => {
    const { context, graph, walking } = expanded;
    const start = context.neighbourhoods.find(item => item.id === 'bukit-bintang').start;
    const destination = walking.assets.find(asset => asset.source_ref === 'https://www.openstreetmap.org/node/2917405999' && asset.kind === 'destination');
    const plan = planJourney(graph.nodes, graph.edges, walking, {
        origin: start.coordinates, destination, profile: 'senior',
        departure_at: '2026-11-24T04:00:00Z', needs: DEFAULT_NEEDS,
    }, [], null, ['direct']);
    const newEdges = new Set(expanded.appended_graph.edges.map(edge => edge.id));
    assert.ok(plan.routes.direct?.edge_ids.some(id => newEdges.has(id)), plan.reasons.join(' '));
    assert.equal(plan.routes.direct.verified_rest_stops, 0);
});
