import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultWalkingSettings, newDeviceWalkingProfile, normaliseWalkingSettings, readDeviceWalkingProfile, writeDeviceWalkingProfile, sharedWalkingSettings, sharedWalkBudget, WALKING_PROFILE_KEY } from '../lib/walking-profile.ts';
import { normaliseNeeds, planJourney, planReturnWalk } from '../lib/journeys.ts';
import { readWalkParameters } from '../lib/walk-parameters.ts';
import { createWalkPack, readLibrary, writeLibrary, emptyLibrary } from '../lib/walk-library.ts';
import { nodes, edges, data, input, AT } from './helpers/journey-fixture.mjs';

function storage(initial = {}) {
    const records = new Map(Object.entries(initial));
    return {
        getItem: key => records.get(key) ?? null,
        setItem: (key, value) => records.set(key, String(value)),
        removeItem: key => records.delete(key),
    };
}

test('a new device has an optional setup and no implied mobility limitation', () => {
    const profile = readDeviceWalkingProfile(storage());
    assert.equal(profile.status, 'new');
    assert.deepEqual(profile.settings, defaultWalkingSettings());
    assert.equal(profile.settings.profile, 'everyday');
    assert.equal(profile.settings.needs.require_rests, false);
    assert.equal(profile.settings.needs.step_free, false);
});

test('skipping is saved; the later setup can replace the same device record', () => {
    const device = storage();
    const skipped = { ...newDeviceWalkingProfile(), status: 'skipped' };
    writeDeviceWalkingProfile(device, skipped);
    assert.deepEqual(readDeviceWalkingProfile(device), skipped);
    const complete = { ...skipped, status: 'complete',
        settings: normaliseWalkingSettings('wheelchair', { comfort: ['shade'], require_rests: true, rest_interval_min: 10 }) };
    writeDeviceWalkingProfile(device, complete);
    assert.deepEqual(readDeviceWalkingProfile(device), complete);
    assert.equal(readDeviceWalkingProfile(device).settings.needs.step_free, true);
});

test('legacy preferences are kept on setup and removed only after the consolidated record is written', () => {
    const device = storage({
        'townshipgo:selected-profile:v1': 'cane_walker',
        'townshipgo:walking-needs:v1': JSON.stringify({ speed_mps: .58, budget_min: 45, require_rests: true, rest_interval_min: 10, rest_backrest: true }),
    });
    const migrated = readDeviceWalkingProfile(device);
    assert.equal(migrated.status, 'new');
    assert.equal(migrated.settings.profile, 'cane_walker');
    assert.equal(migrated.settings.needs.speed_mps, .58);
    assert.equal(migrated.settings.needs.budget_min, 45);
    assert.equal(migrated.settings.needs.require_rests, true);
    assert.equal(migrated.settings.needs.rest_backrest, true);
    assert.equal(device.getItem(WALKING_PROFILE_KEY), null);
    writeDeviceWalkingProfile(device, { ...migrated, status: 'skipped' });
    assert.equal(device.getItem('townshipgo:walking-needs:v1'), null);
    assert.equal(device.getItem('townshipgo:selected-profile:v1'), null);
    assert.deepEqual(readDeviceWalkingProfile(device).settings, migrated.settings);
});

test('damaged or unavailable storage starts with safe functional defaults', () => {
    assert.deepEqual(readDeviceWalkingProfile(storage({ [WALKING_PROFILE_KEY]: '{invalid' })), newDeviceWalkingProfile());
    assert.deepEqual(readDeviceWalkingProfile({ getItem: () => { throw Error('unavailable'); } }), newDeviceWalkingProfile());
});

test('shared walking preferences are temporary and invalid settings are ignored', () => {
    const saved = normaliseWalkingSettings('everyday', { speed_mps: 1, comfort: ['shade'] });
    const device = storage();
    const record = { version: 1, status: 'complete', settings: saved };
    writeDeviceWalkingProfile(device, record);
    const share = new URLSearchParams({ profile: 'stroller', needs: JSON.stringify({ step_free: false, speed_mps: .8, comfort: ['lighting', 'lighting', 'invalid'] }), budget: '20' });
    const override = sharedWalkingSettings(share, saved);
    assert.equal(override.profile, 'stroller');
    assert.equal(override.needs.step_free, true);
    assert.deepEqual(override.needs.comfort, ['lighting']);
    assert.equal(sharedWalkBudget(share), 20);
    assert.deepEqual(readDeviceWalkingProfile(device), record);
    assert.equal(sharedWalkingSettings(new URLSearchParams('budget=45'), saved), null);
    assert.equal(sharedWalkBudget(new URLSearchParams('budget=Infinity')), null);
    assert.equal(sharedWalkBudget(new URLSearchParams('budget=2')), null);
    assert.equal(sharedWalkingSettings(new URLSearchParams('profile=everyday&needs=%7B'), saved).needs.speed_mps, 1);
    assert.equal(sharedWalkingSettings(new URLSearchParams('profile=constructor'), saved), null);
});

test('optional comfort settings are allowlisted without becoming required conditions', () => {
    const needs = normaliseNeeds({ comfort: ['lighting', 'shade', 'shade', 'seating', 'not_a_preference'] });
    assert.deepEqual(needs.comfort, ['shade', 'lighting', 'seating']);
    assert.equal(needs.require_rests, false);
    assert.equal(needs.avoid_uncontrolled_crossings, false);
    assert.equal(needs.verified_only, false);
});

test('a rain-shelter preference can recommend a covered alternative at night', () => {
    const network = edges.map(e => e.id === 1 ? e : { ...e, covered: true });
    const request = { ...input(), departure_at: '2026-11-17T15:00:00Z' };
    const balanced = planJourney(nodes, network, data(false), request);
    const personalised = planJourney(nodes, network, data(false), { ...request, needs: { ...request.needs, comfort: ['shelter'] } });
    assert.equal(balanced.recommended, 'direct');
    assert.ok(personalised.recommended);
    const chosen = personalised.routes[personalised.recommended];
    assert.deepEqual(chosen.edge_ids, [2, 3]);
    assert.ok(chosen.unsheltered_m < 1);
    assert.equal(chosen.suitability, 'yellow');
});

test('controlled-crossing preference finds a detour, but never turns into an exclusion', () => {
    const network = edges.map(e => e.id === 1 ? { ...e, is_crossing: true, crossing_type: 'uncontrolled', has_kerb_ramp: true } : e);
    const request = input({ comfort: ['controlled_crossings'] });
    const result = planJourney(nodes, network, data(false), request);
    assert.ok(result.routes.direct);
    assert.equal(result.routes.direct.uncontrolled_crossings, 1);
    assert.equal(result.routes[result.recommended].uncontrolled_crossings, 0);
    assert.ok(planJourney(nodes, [network[0]], data(false), request).recommended);
    assert.equal(planJourney(nodes, [network[0]], data(false), { ...request, needs: { ...request.needs, avoid_uncontrolled_crossings: true } }).recommended, null);
});

test('mapped seating preferences can select the seat-bearing alternative without promising verified rests', () => {
    const network = edges.map(e => e.id === 1 ? e : { ...e, covered: true });
    const request = input({ comfort: ['seating'] });
    const result = planJourney(nodes, network, data(false), request);
    const route = result.routes[result.recommended];
    assert.ok(route.mapped_rest_stops > 0);
    assert.equal(route.verified_rest_stops, 0);
    assert.equal(planJourney(nodes, network, data(false), { ...request, needs: { ...request.needs, require_rests: true, rest_interval_min: 1 } }).recommended, null);
});

test('preferences cannot relax step-free profile barriers or trip budgets', () => {
    const network = edges.map(e => ({ ...e, has_steps: true, kind: 'steps', covered: true }));
    const request = { ...input({ step_free: false, comfort: ['shade', 'shelter'] }), profile: 'stroller' };
    assert.equal(planJourney(nodes, network, data(false), request).recommended, null);
    assert.equal(planJourney(nodes, network, data(false), { ...request, profile: 'everyday' }).recommended !== null, true);
    const result = planReturnWalk(nodes, edges, data(false), { ...input({ budget_min: 5, comfort: ['shade'] }), profile: 'everyday' });
    assert.ok(result.recommended);
    for (const route of Object.values(result.routes)) assert.ok(route.total_min <= 5.001);
});

test('new mobility profiles survive share parsing and saved walk library validation', () => {
    for (const profile of ['everyday', 'stroller']) {
        assert.equal(readWalkParameters(new URLSearchParams({ profile }), [], [3, 101]).profile, profile);
        const request = { ...input(), profile };
        const result = planJourney(nodes, edges, data(), request);
        const route = result.routes[result.recommended];
        assert.ok(route);
        const pack = createWalkPack(route, profile, normaliseWalkingSettings(profile, request.needs).needs, request.origin, edges, data(), AT);
        const device = storage();
        writeLibrary({ ...emptyLibrary(), packs: [pack] }, device);
        const saved = readLibrary(device);
        assert.equal(saved.warning, null);
        assert.equal(saved.library.packs[0].profile, profile);
    }
});

test('daytime shade and night lighting preferences compare the corresponding route conditions', () => {
    const network = edges.map(e => ({ ...e, shade_morning: e.id === 1 ? 0 : 1, lit_ratio: e.id === 1 ? 0 : 1 }));
    const day = planJourney(nodes, network, data(false), input({ comfort: ['shade'] }));
    assert.deepEqual(day.routes[day.recommended].edge_ids, [2, 3]);
    assert.ok(day.routes[day.recommended].uncovered_m < day.routes.direct.uncovered_m);
    const night = planJourney(nodes, network, data(false), { ...input({ comfort: ['lighting'] }), departure_at: '2026-11-17T15:00:00Z' });
    assert.deepEqual(night.routes[night.recommended].edge_ids, [2, 3]);
    assert.ok(night.routes[night.recommended].dark_m < night.routes.direct.dark_m);
});
