import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPagesPilot } from '../scripts/pilot-export.mjs';
import { transitApproachAssets } from '../lib/transit.ts';
import { residentPlaceName, routeRoofLines, routeStepAt, searchResidentPlaces, walkWeather } from '../lib/resident-walking.ts';

test('resident search distinguishes the Pasar Seni stations, NU Sentral and both Pudu destinations', async () => {
    const bundle = await loadPagesPilot('data/pasar-seni/bundle.json');
    const places = [...bundle.walking.assets, ...transitApproachAssets(bundle.context, true)]
        .filter(asset => ['destination', 'transit'].includes(asset.kind));
    const connected = new Set(bundle.walking.assets.filter(asset => asset.edge_id !== null).map(asset => asset.parent_id ?? asset.id));
    const first = query => searchResidentPlaces(places, query, bundle.context.featured_ids, connected)[0];
    for (const [query, title] of [['Central Market','Central Market'],['PASAR SENI MRT', 'Pasar Seni MRT'], ['LRT Pasar Seni', 'Pasar Seni LRT'],
        ['NU-Sentral', 'NU Sentral'], ['Pudu LRT', 'Pudu LRT'], ['Pudu Sentral', 'Pudu Sentral']]) {
        assert.equal(residentPlaceName(first(query)), title, query);
    }
    assert.notEqual(first('Pudu LRT').id, first('Pudu Sentral').id);
});

test('rain cues inspect the whole walk and exclude the hour after arrival', () => {
    const weather = { source: 'open-meteo', hourly: [
        { time: '2026-11-22T04:00:00Z', rain_probability: 0, precipitation_mm: 0, feels_like_c: 31 },
        { time: '2026-11-22T05:00:00Z', rain_probability: 65, precipitation_mm: 2, feels_like_c: 29 },
    ] };
    assert.equal(walkWeather(weather, '2026-11-22T04:50:00Z', 15), 'rain');
    assert.equal(walkWeather(weather, '2026-11-22T04:50:00Z', 10), null);
    assert.equal(walkWeather(null, '2026-11-22T04:50:00Z', 15), null);
});

test('roof stripes use the traversed part of mapped paths and exclude unconfirmed reports', () => {
    const part = [[3.142, 101.695], [3.143, 101.695]];
    const route = { edge_ids: [1, 2], departure_at: '2026-11-22T04:00:00Z', steps: [
        { edge_id: 1, coordinates: part }, { edge_id: 2, coordinates: [[3.143, 101.695], [3.144, 101.695]] },
    ] };
    const edges = [1, 2].map(id => ({ id, kind: 'path', pedestrian_access: true, covered: true,
        geometry: [[101.695, 3.141], [101.695, 3.145]] }));
    const records = [{ id: '1', status: 'reported', target_type: 'path', target_id: '2', attributes: { covered: true },
        observed_at: '2026-11-21T00:00:00Z', created_at: '2026-11-21T00:00:00Z', valid_until: null }];
    assert.deepEqual(routeRoofLines(route, edges, records), [part]);
});

test('walk guidance follows usable route positions through an overlapping return path', () => {
    const outbound = [[3.142, 101.695], [3.143, 101.695]];
    const route = { steps: [{ kind: 'path', coordinates: outbound }, { kind: 'path', coordinates: [...outbound].reverse() }] };
    assert.equal(routeStepAt(route, [3.1425, 101.695], 0), 0);
    assert.equal(routeStepAt(route, [3.1425, 101.695], 1), 1);
    assert.equal(routeStepAt(route, [3.145, 101.701], 0), null);
});
