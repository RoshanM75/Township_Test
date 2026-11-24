import assert from 'node:assert/strict';
import test from 'node:test';
import { journeyShade, pathShade } from '../lib/route-shade.ts';
import { solarModel } from '../lib/solar-shade.ts';
import { readSharedDeparture } from '../lib/walk-parameters.ts';

const centre = [101.7, 3.15];
const point = (east, north) => [centre[0] + east / 111152, centre[1] + north / 110574];
const model = solarModel({ centre, non_ground_ways: ['101'], objects: [{
    height: 40, base: 0, ring: [point(5, -25), point(25, -25), point(25, 25), point(5, 25)],
}] });
const morning = Date.parse('2026-11-25T09:00:00+08:00');
const afternoon = Date.parse('2026-11-25T17:00:00+08:00');
const westOfTower = point(-10, 0);
const edge = { id: 11, is_crossing: false, covered: null, osm_way_id: 100 };

test('sun direction changes both point shade and visible cast geometry in Malaysia time', () => {
    assert.equal(model.atPoint(westOfTower, morning).condition, 'shade');
    assert.equal(model.atPoint(westOfTower, afternoon).condition, 'sun');
    assert.equal(model.atPoint(point(-2000, 0), afternoon).condition, 'unknown');
    assert.equal(model.atPoint(westOfTower, morning - 5 * 3600000).condition, 'night');
    const region = [...point(-100, -100), ...point(100, 100)];
    assert.notDeepEqual(model.shadowRings(morning, region), model.shadowRings(afternoon, region));
    assert.equal(pathShade({ ...edge, osm_way_id: 101 }, [], afternoon, westOfTower, model).condition, 'unknown');
});

test('checked sun applies near the observation time, while checked roof cover applies throughout daylight', () => {
    const check = { id: '1', target_type: 'path', target_id: '11', status: 'verified',
        observed_at: new Date(morning).toISOString(), valid_until: '2026-12-10T01:00:00Z', created_at: new Date(morning).toISOString(),
        reviewer: 'Field team', method: 'site_visit', attributes: { shade_observed: 0 } };
    assert.deepEqual(pathShade(edge, [check], morning + 5 * 60000, westOfTower, model), { condition: 'sun', source: 'checked' });
    assert.equal(pathShade(edge, [check], morning + 60 * 60000, westOfTower, model).source, 'modelled');
    assert.deepEqual(pathShade(edge, [{ ...check, attributes: { covered: true } }], afternoon, westOfTower, model), { condition: 'covered', source: 'checked' });
    assert.equal(pathShade({ ...edge, covered: true }, [{ ...check, attributes: { covered: false } }], afternoon, westOfTower, model).condition, 'sun');
});

test('itinerary exposure counts crossing waits and uses the time after a planned rest', () => {
    const a = [3.15, 101.7], b = [3.1503, 101.7], c = [3.1506, 101.7];
    const exposure = journeyShade([
        { kind: 'path', edge_id: 11, coordinates: [a, b], distance_m: 33, start_min: 0, end_min: 2, wait_s: 60 },
        { kind: 'rest', coordinates: [b, b, b], distance_m: 0, start_min: 2, end_min: 4 },
        { kind: 'path', edge_id: 11, coordinates: [b, c], distance_m: 33, start_min: 4, end_min: 5 },
    ], new Date(morning).toISOString(), { edges: new Map([[11, edge]]), checks: new Map(), assets: [], speed: .6,
        model: { ...model, atPoint: (_, at) => ({ condition: at >= morning + 240000 ? 'shade' : 'sun', source: 'modelled' }) } });
    assert.equal(exposure.sun_s, 240);
    assert.equal(exposure.longest_sun_m, 33);
    assert.equal(exposure.daylight_s, 300);
    assert.deepEqual(exposure.stretches.map(stretch => stretch.condition), ['sun', 'shade']);
});

test('share links retain the exact preview departure, including historical dates and explicit offsets', () => {
    assert.equal(readSharedDeparture('2026-11-25T17:24:30+08:00'), '2026-11-25T09:24:30.000Z');
    assert.equal(readSharedDeparture('2024-01-02T03:04:05.678Z'), '2024-01-02T03:04:05.678Z');
    assert.equal(readSharedDeparture('2026-11-25T17:24'), null);
    assert.equal(readSharedDeparture('invalid'), null);
});
