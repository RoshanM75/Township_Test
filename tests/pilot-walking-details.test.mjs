import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadPagesPilot } from '../scripts/pilot-export.mjs';
import { withMappedDetails } from '../lib/pilot-walking-details.ts';
import { scheduledService, transitDestinationId } from '../lib/transit.ts';
import { activeAccessNotices } from '../lib/access-notices.ts';
import { parseWeatherWarnings } from '../lib/weather-warnings.ts';
import { environmentSegments } from '../lib/environment.ts';
import { railDemand, transitContext } from '../lib/data/context.ts';
import { planJourney } from '../lib/journeys.ts';
import { modelPilotShade } from '../scripts/pilot-shade.mjs';
import { AT, data, edges, input, nodes, record } from './helpers/journey-fixture.mjs';

test('the public pilots use real gates, stops and modelled shade while preserving walking dataset identity', async () => {
    for (const area of ['pasar-seni', 'um-campus']) {
        const bundle = await loadPagesPilot(fileURLToPath(new URL(`../data/${area}/bundle.json`, import.meta.url)), area);
        const { context } = bundle;
        const mapped = withMappedDetails(bundle.graph.edges, bundle.walking, context);
        assert.equal(bundle.graph.source.dataset_id, context.dataset_id);
        assert.deepEqual(mapped.walking.verifications, []);
        assert.equal(mapped.edges.length, bundle.graph.edges.length);
        assert.ok(context.transit.stops.length > 30);
        const stop = context.transit.stops.find(stop => stop.approach);
        const parent = mapped.walking.assets.find(asset => asset.id === transitDestinationId(stop));
        const approach = mapped.walking.assets.find(asset => asset.parent_id === parent.id);
        assert.equal(approach.properties.connection_model, 'approximate_approach');
        assert.equal(approach.connection_distance_m, 0);
        assert.equal(approach.edge_id, stop.approach.edge_id);
        assert.ok(mapped.edges.some(edge => edge.shade_source === 'modelled'));
        assert.ok(environmentSegments(mapped.edges, [], '2026-11-22T01:00:00Z', 'shade').some(s => s.source === 'modelled'));
        assert.equal(context.demographics.year, '2026');
        assert.ok(context.demand.stations.length > 0);
        if (area === 'pasar-seni') {
            const rail = context.transit.stops.find(item => item.id === 'rapid-rail-kl:KG16');
            const gates = mapped.walking.assets.filter(asset => asset.parent_id === rail.walking_asset_id && asset.properties.station_plan);
            assert.equal(gates.length, 2);
            assert.ok(gates.every(gate => gate.edge_id !== null && gate.properties.step_free !== true));
            assert.ok(scheduledService(context.transit, rail, '2026-11-22T01:00:00Z').items.length);
        }
    }
});

test('official OD station totals take precedence over component pairs', () => {
    const date = '2026-08-24';
    const result = railDemand([
        { date, origin: 'Pasar Seni', destination: 'Masjid Jamek', ridership: '9' },
        { date, origin: 'Pasar Seni', destination: 'A0: All Stations', ridership: '200' },
        { date, origin: 'A0: All Stations', destination: 'Pasar Seni', ridership: '300' },
    ], ['Pasar Seni']);
    assert.deepEqual(result.stations.find(station => station.name === 'Pasar Seni'), { name: 'Pasar Seni', entries: 200, exits: 300 });
});

test('frequency templates use the origin offset and calendars suppress exceptions and expired service', () => {
    const transit = transitContext({
        'stops.txt': [{ stop_id: 'p', stop_name: 'Test stop', stop_lat: '3.14', stop_lon: '101.69' }],
        'routes.txt': [{ route_id: 'r', route_short_name: 'Test route' }],
        'trips.txt': [{ trip_id: 'trip', route_id: 'r', service_id: 'week', trip_headsign: 'Toward test' }],
        'stop_times.txt': [{ trip_id: 'trip', stop_id: 'p', departure_time: '06:10:00' }],
        trip_origins: [{ trip_id: 'trip', time: '06:00:00' }],
        'frequencies.txt': [{ trip_id: 'trip', start_time: '08:00:00', end_time: '10:00:00', headway_secs: '900' }],
        'calendar.txt': [{ service_id: 'week', start_date: '20261101', end_date: '20261130', monday: '1' }],
        'calendar_dates.txt': [{ service_id: 'week', date: '20261123', exception_type: '2' }],
    }, 'test', 'pasar-seni');
    const [stop] = transit.stops;
    const service = scheduledService(transit, stop, '2026-11-16T00:00:00Z');
    assert.deepEqual(service.items.map(item => item.frequency), [{
        start: '2026-11-16T00:10:00.000Z', end: '2026-11-16T02:10:00.000Z', interval_seconds: 900,
    }]);
    assert.deepEqual(scheduledService(transit, stop, '2026-11-23T00:00:00Z').items, []);
    assert.deepEqual(scheduledService(transit, stop, '2026-12-07T00:00:00Z').items, []);
});

test('width and accessible crossing requirements exclude unsupported paths and can use current field checks', () => {
    const paths = edges.map(edge => edge.id === 1
        ? { ...edge, clear_width_m: .72, is_crossing: true, crossing_type: 'signalised', has_kerb_ramp: true }
        : { ...edge, clear_width_m: 1.3 });
    const info = data(false);
    const request = input({ min_clear_width_m: 1.1, require_tactile_crossings: true, require_audible_crossings: true });
    assert.deepEqual(planJourney(nodes, paths, info, request).routes.direct.edge_ids, [2, 3]);
    assert.equal(planJourney(nodes, [paths[0]], info, request).recommended, null);
    info.verifications.push(record('crossing', 1, { clear_width_m: 1.2, has_tactile: true, audible_signal: true }));
    assert.deepEqual(planJourney(nodes, paths, info, request).routes.direct.edge_ids, [1]);
});

test('current lift outages and walkway closures display only confirmed records and affect routing', () => {
    const info = data();
    const lift = record('entrance', 101, { lift_available: false }, { method: 'operator_record', source_ref: 'https://example.com/operator-fixture' });
    const closure = record('path', 2, { path_open: false }, { observed_at: '2026-11-16T06:00:00Z' });
    const report = record('path', 3, { path_open: false }, { status: 'reported' });
    info.verifications.push(lift, closure, report);
    const labels = activeAccessNotices(edges, info, AT).map(item => item.label).sort();
    assert.deepEqual(labels, ['Lift out of service', 'Walkway closed']);
    assert.equal(planJourney(nodes, edges, info, input()).recommended, null);
    assert.ok(planJourney(nodes, edges, info, input({ step_free: false })).routes.direct);
    assert.deepEqual(activeAccessNotices(edges, info, '2026-12-02T00:00:00Z'), []);
});

test('shade sampling uses the mapped geometry of supplied canopy and leaves distant paths unknown', () => {
    const result = modelPilotShade(edges, [], [3, 101], '2026-11-17', { features: [{
        properties: { kind: 'canopy', height_m: 6 },
        geometry: { type: 'Polygon', coordinates: [[[100.9999, 2.9999], [101.0002, 2.9999],
            [101.0002, 3.0001], [100.9999, 3.0001], [100.9999, 2.9999]]] },
    }] });
    assert.equal(result.shade.crowns, 1);
    assert.equal(result.paths[1].shade_source, 'modelled');
    assert.equal(result.paths[3], undefined);
});

test('MET warnings retain current official bulletins, tag pilot mentions and expire in Malaysia time', () => {
    const row = { valid_from: '2026-11-22T11:00:00', valid_to: '2026-11-22T13:30:00',
        heading_en: 'Thunderstorm warning', text_en: '<p>Kuala Lumpur, Selangor</p>' };
    const now = Date.parse('2026-11-22T04:00:00Z');
    const feed = parseWeatherWarnings([row, row, { ...row, text_en: 'Johor' }], 'pasar-seni', now);
    assert.equal(feed.warnings.length, 2);
    assert.equal(feed.warnings[0].mentions_area, true);
    assert.equal(feed.warnings[0].description, 'Kuala Lumpur, Selangor');
    assert.equal(feed.warnings[0].valid_to, '2026-11-22T05:30:00.000Z');
    assert.deepEqual(parseWeatherWarnings([row], 'pasar-seni', Date.parse('2026-11-22T05:30:00Z')), { status: 'available', warnings: [] });
    assert.equal(parseWeatherWarnings({ error: 'fixture' }, 'pasar-seni', now).status, 'unavailable');
});
