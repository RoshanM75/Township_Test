import test from 'node:test';
import assert from 'node:assert/strict';
import {
    activityWindow, profileActivity, frequentlyVisitedPlaces, destinationForVisit,
    CAR_CO2E_KG_PER_KM, METRES_PER_ESTIMATED_STEP,
} from '../lib/profile-activity.ts';
import { emptyTrack } from '../lib/walk-tracking.ts';
import { emptyLibrary, readLibrary, writeLibrary } from '../lib/walk-library.ts';

const now = Date.parse('2026-11-25T04:00:00Z');
const walk = (id, finished_at, distance_m = 0, overrides = {}) => ({
    id, title: 'Test destination', area_id: 'pasar-seni', profile: 'everyday',
    started_at: new Date(Date.parse(finished_at) - 600000).toISOString(),
    finished_at, active_ms: 600000, planned_m: 8000, planned_min: 90, feedback: null,
    track: { ...emptyTrack(), distance_m },
    ...overrides,
});
const iso = value => new Date(value).toISOString();

test('activity uses Malaysia calendar dates, Monday-start weeks and local month boundaries', () => {
    const cases = [
        ['day', '2026-11-24T16:00:00.000Z', '2026-11-25T16:00:00.000Z'],
        ['week', '2026-11-22T16:00:00.000Z', '2026-11-29T16:00:00.000Z'],
        ['month', '2026-10-31T16:00:00.000Z', '2026-11-30T16:00:00.000Z'],
    ];
    for (const [period, start, end] of cases) {
        const range = activityWindow(period, now);
        assert.equal(iso(range.start_ms), start);
        assert.equal(iso(range.end_ms), end);
    }
    // Local midnight is still the previous UTC day, including year and leap boundaries.
    assert.equal(iso(activityWindow('day', Date.parse('2026-12-31T16:00:00Z')).start_ms), '2026-12-31T16:00:00.000Z');
    assert.equal(iso(activityWindow('month', Date.parse('2028-02-21T10:00:00Z')).end_ms), '2028-02-29T16:00:00.000Z');
    assert.equal(iso(activityWindow('week', Date.parse('2026-11-22T15:59:59Z')).start_ms), '2026-11-15T16:00:00.000Z');
    assert.equal(iso(activityWindow('week', Date.parse('2026-11-22T16:00:00Z')).start_ms), '2026-11-22T16:00:00.000Z');
});

test('day, week and month aggregate completed GPS distances, not planned distances', () => {
    const recorded = walk('first', '2026-11-24T16:00:00Z', 700);
    const history = [
        recorded, recorded, // duplicated history items must not inflate totals
        walk('wheelchair', '2026-11-25T03:31:00Z', 300, { profile: 'wheelchair' }),
        walk('timer', '2026-11-25T03:42:00Z', 0, { active_ms: 120000 }),
        walk('yesterday', '2026-11-24T15:59:59Z', 1400, { profile: 'cane_walker' }),
        walk('sunday', '2026-11-22T15:59:59Z', 350),
        walk('last-month', '2026-10-31T15:59:59Z', 2100),
        walk('future', '2026-11-25T04:00:01Z', 10000),
    ];
    const day = profileActivity(history, 'day', now);
    assert.equal(day.completed_walks, 3);
    assert.equal(day.distance_walks, 2);
    assert.equal(day.distance_m, 1000);
    assert.equal(day.estimated_steps, 1000);
    assert.equal(day.potential_car_co2e_kg, CAR_CO2E_KG_PER_KM);
    assert.equal(day.active_ms, 1320000);
    assert.equal(day.has_nonstepping_distance, true);
    const week = profileActivity(history, 'week', now);
    assert.equal(week.completed_walks, 4);
    assert.equal(week.estimated_steps, 3000);
    assert.equal(week.distance_m, 2400);
    const month = profileActivity(history, 'month', now);
    assert.equal(month.completed_walks, 5);
    assert.equal(month.estimated_steps, 3500);
    assert.equal(month.distance_m, 2750);
});

test('missing distance is not replaced with a fake step or carbon count', () => {
    const noWalks = profileActivity([], 'day', now);
    assert.equal(noWalks.estimated_steps, null);
    assert.equal(noWalks.potential_car_co2e_kg, null);
    assert.equal(noWalks.distance_m, null);
    const timerOnly = profileActivity([walk('timer', '2026-11-25T03:00:00Z')], 'day', now);
    assert.equal(timerOnly.active_ms, 600000);
    assert.equal(timerOnly.completed_walks, 1);
    assert.equal(timerOnly.distance_walks, 0);
    assert.equal(timerOnly.estimated_steps, null);
    assert.equal(timerOnly.potential_car_co2e_kg, null);
});

test('wheelchair journeys contribute distance and time but no estimated steps', () => {
    const wheelchair = walk('wheelchair', '2026-11-25T03:00:00Z', 2000, { profile: 'wheelchair' });
    const result = profileActivity([wheelchair], 'day', now);
    assert.equal(result.estimated_steps, null);
    assert.equal(result.distance_m, 2000);
    assert.equal(result.potential_car_co2e_kg, 2 * CAR_CO2E_KG_PER_KM);
    assert.equal(result.has_nonstepping_distance, true);
});

test('invalid numeric values are not converted into usable recorded activity', () => {
    const invalid = walk('invalid', '2026-11-25T03:00:00Z', Infinity, { active_ms: -5 });
    const result = profileActivity([invalid], 'day', now);
    assert.equal(result.distance_m, null);
    assert.equal(result.estimated_steps, null);
    assert.equal(result.active_ms, 0);
});

test('step rounding occurs after combining recorded distances', () => {
    const history = [walk('a', '2026-11-25T02:00:00Z', 10), walk('b', '2026-11-25T03:00:00Z', 10)];
    assert.equal(profileActivity(history, 'day', now).estimated_steps, Math.round(20 / METRES_PER_ESTIMATED_STEP));
});

test('only explicit confirmed arrivals count, ranked by frequency then recency with stable place IDs', () => {
    const visit = (id, at, place_id, name, area_id = 'pasar-seni') =>
        walk(id, at, 0, { confirmed_visit: { place_id, name }, area_id });
    const old = visit('older', '2026-11-01T01:00:00Z', 'market', 'Market old name');
    const next = visit('newer', '2026-11-24T21:00:00Z', 'market', 'Market');
    const history = [
        old, next, old,
        visit('campus', '2026-11-25T01:00:00Z', 'market', 'Campus place', 'um-campus'),
        visit('shop', '2026-11-25T02:00:00Z', 'shop', 'Local shop'),
        walk('legacy', '2026-11-25T03:00:00Z', 800, { title: 'Market' }),
        walk('bad', '2026-11-25T03:00:00Z', 0, { confirmed_visit: { place_id: '', name: 'Bad' } }),
        visit('future', '2026-11-25T04:01:00Z', 'market', 'Market'),
    ];
    assert.deepEqual(frequentlyVisitedPlaces(history, now), [
        { area: 'pasar-seni', place_id: 'market', name: 'Market', visits: 2 },
        { area: 'pasar-seni', place_id: 'shop', name: 'Local shop', visits: 1 },
        { area: 'um-campus', place_id: 'market', name: 'Campus place', visits: 1 },
    ]);
    const remaining = history.filter(w => w.id !== 'older' && w.id !== 'newer');
    assert.ok(!frequentlyVisitedPlaces(remaining, now).some(p => p.area === 'pasar-seni' && p.place_id === 'market'));
});

test('a named mapped destination can be confirmed; return walks and shortcut endpoints cannot', () => {
    const destination = { id: 'internal-id', external_id: 'public-id', kind: 'destination', name: 'Local library', properties: {} };
    const pack = { route: { destination, return_walk: false } };
    assert.deepEqual(destinationForVisit(pack), { place_id: 'public-id', name: 'Local library' });
    assert.equal(destinationForVisit({ route: { ...pack.route, return_walk: true } }), null);
    assert.equal(destinationForVisit({ route: { ...pack.route, community_id: 'local-shortcut' } }), null);
    assert.equal(destinationForVisit({ route: { destination: { ...destination, kind: 'entrance' } } }), null);
    assert.deepEqual(destinationForVisit({ route: { destination: { ...destination, external_id: null } } }), { place_id: 'internal-id', name: 'Local library' });
});

test('old and new completed walks coexist without schema migration or loss of recorded history', () => {
    const entries = new Map();
    const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
    const history = [walk('legacy', '2026-11-25T02:00:00Z', 700),
        walk('arrival', '2026-11-25T03:00:00Z', 0, { confirmed_visit: { place_id: 'market', name: 'Market' } })];
    writeLibrary({ ...emptyLibrary(), history }, storage);
    const saved = readLibrary(storage);
    assert.equal(saved.warning, null);
    assert.deepEqual(saved.library.history, history);
    assert.equal(frequentlyVisitedPlaces(saved.library.history, now)[0].visits, 1);
    assert.equal(profileActivity(saved.library.history, 'day', now).estimated_steps, 1000);
    const afterDeletion = saved.library.history.filter(walk => walk.id !== 'legacy');
    assert.equal(profileActivity(afterDeletion, 'day', now).estimated_steps, null);
});
