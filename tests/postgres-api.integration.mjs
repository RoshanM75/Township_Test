import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import dotenv from 'dotenv';
import { LOCAL_DATABASE_URL } from '../lib/server/postgres.ts';
import { pilotFixture } from './helpers/pilot-fixture.mjs';
import { seedPilotArea } from '../scripts/seed-pilot-area.mjs';

dotenv.config({ path: '.env.local', quiet: true });

async function availablePort() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

// A real isolated PostgreSQL database is used, never the app's reports or graph.
test('Next.js APIs with real PostgreSQL/PostGIS', { timeout: 60000 }, async (t) => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL || LOCAL_DATABASE_URL });
    const databaseName = `township_test_${process.pid}_${Date.now()}`;
    const connection = new URL(process.env.DATABASE_URL || LOCAL_DATABASE_URL);
    connection.pathname = `/${databaseName}`;
    const reviewKey = randomUUID();
    let fixture;
    let app;
    let dropped = false;
    let logs = '';
    try {
        await admin.query(`CREATE DATABASE "${databaseName}"`);
        fixture = new pg.Pool({ connectionString: connection.href });
        const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
        await fixture.query(schema);
        await fixture.query(schema); // The schema must be safe to reapply.
        await fixture.query(`INSERT INTO path_nodes(id, lat, lng) VALUES
            (1, 3.1223, 101.6580), (2, 3.1200, 101.6600), (3, 3.1143, 101.6613)`);
        await fixture.query(`INSERT INTO path_edges
            (id, from_node, to_node, osm_way_id, name, source_highway, pedestrian_access, geometry, length_m, kind)
            VALUES (11, 1, 2, 101, 'Test footpath', 'footway', TRUE, '[[101.6580,3.1223],[101.6600,3.1200]]', 350, 'footway'),
                   (12, 2, 3, 102, 'Test crossing', 'footway', TRUE, '[[101.6600,3.1200],[101.6613,3.1143]]', 650, 'crossing')`);
        const port = await availablePort();
        app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
            env: { ...process.env, DATABASE_URL: connection.href, TOWNSHIP_REVIEW_KEY: reviewKey }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`App did not start: ${logs}`)), 15000);
            const receive = (chunk) => { logs += chunk.toString(); if (logs.includes('Ready')) { clearTimeout(timer); resolve(); } };
            app.stdout.on('data', receive); app.stderr.on('data', receive);
            app.on('error', (error) => { clearTimeout(timer); reject(error); });
            app.on('exit', (code) => { clearTimeout(timer); reject(new Error(`App exited (${code}): ${logs}`)); });
        });
        const request = async (path, options) => {
            const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
            return { status: response.status, body: await response.json() };
        };
        const post = (body) => request('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const review = (path, body, method = 'POST') => request(path, {
            method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reviewKey}` },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const check = (id, area = 'elmina', dismiss = false) => review(`/api/reports/${id}/check?area=${area}`,
            { team: 'Pilot review team', note: 'Inspected in the integration scenario', dismiss });
        const fix = (id, area = 'elmina') => review(`/api/reports/${id}/fix?area=${area}`);
        const position = { lat: 3.1223, lng: 101.6580, edge_id: 11 };
        const counts = async () => (await fixture.query(`SELECT (SELECT count(*)::int FROM hazard_reports) AS hazards,
            (SELECT count(*)::int FROM defect_reports) AS reports`)).rows[0];
        let reportId;
        let hazardId;

        await t.test('health and graph use PostGIS and expose pedestrian geometry', async () => {
            const health = await request('/api/health');
            assert.equal(health.status, 200); assert.equal(health.body.database, 'ok');
            assert.match(health.body.postgis_version, /^3\./); assert.equal(health.body.edges, 2);
            const graph = await request('/api/graph');
            assert.equal(graph.status, 200); assert.equal(graph.body.nodes.length, 3);
            assert.equal(graph.body.edges[0].id, 11); assert.equal(graph.body.edges[0].pedestrian_access, true);
            assert.deepEqual(graph.body.edges[0].geometry[0], [101.658, 3.1223]);
            assert.equal(graph.body.source.pedestrian_only, true);
        });
        await t.test('an empty database exposes an empty queue', async () => {
            assert.deepEqual((await request('/api/reports')).body.reports, []);
            assert.deepEqual((await request('/api/hazards')).body.hazards, []);
        });
        await t.test('a report creates linked records and derives category, severity and price on the server', async () => {
            const description = "Cracked kerb '; DROP TABLE path_nodes; --";
            const result = await post({ ...position, kind: 'no_ramp', description, severity: 'comfort', estimated_cost_rm: 1 });
            assert.equal(result.status, 201);
            reportId = result.body.report.id; hazardId = result.body.hazard.id;
            assert.equal(String(result.body.report.hazard_report_id), String(hazardId));
            assert.equal(result.body.report.category, 'Universal Design');
            assert.equal(result.body.report.severity, 'blocker');
            assert.equal(result.body.report.estimated_cost_rm, 3500);
            assert.equal(result.body.report.description, description);
            assert.deepEqual(await counts(), { hazards: 1, reports: 1 });
            assert.equal((await request('/api/reports')).body.reports.length, 1);
            assert.equal((await request('/api/hazards')).body.hazards[0].id, hazardId);
            assert.equal((await fixture.query('SELECT count(*)::int AS count FROM path_nodes')).rows[0].count, 3);
        });
        await t.test('invalid bodies, status filters and IDs return clear client errors', async () => {
            for (const input of [{ ...position, kind: 'driving' }, { ...position, lat: 100, kind: 'blocked' }, { kind: 'no_shade' }]) {
                assert.equal((await post(input)).status, 400);
            }
            assert.equal((await request('/api/reports?status=unknown')).status, 400);
            assert.equal((await review('/api/reports/1%20OR%201=1/fix')).status, 400);
            assert.equal((await request('/api/reports', { method: 'POST', body: '{' })).status, 400);
            assert.equal((await post({ ...position, kind: 'blocked', description: 'x'.repeat(17000) })).status, 413);
            assert.deepEqual(await counts(), { hazards: 1, reports: 1 });
        });
        await t.test('PostGIS rejects reports away from a mapped pedestrian path', async () => {
            assert.equal((await post({ lat: 0, lng: 0, kind: 'blocked' })).status, 422);
            assert.equal((await post({ ...position, edge_id: 99999, kind: 'blocked' })).status, 422);
            const snapped = await post({ lat: position.lat, lng: position.lng, kind: 'light_out' });
            assert.equal(snapped.status, 201); assert.equal(snapped.body.report.edge_id, 11);
            await check(snapped.body.report.id);
            await fix(snapped.body.report.id);
        });
        await t.test('a failed defect insert rolls back the hazard insert', async () => {
            const before = await counts();
            await fixture.query("ALTER TABLE defect_reports ADD CONSTRAINT reject_test_note CHECK (description <> 'force rollback')");
            try {
                const result = await post({ ...position, kind: 'blocked', description: 'force rollback' });
                assert.equal(result.status, 503);
                assert.deepEqual(await counts(), before);
                assert.doesNotMatch(JSON.stringify(result.body), /password|postgresql:|reject_test_note/);
            } finally { await fixture.query('ALTER TABLE defect_reports DROP CONSTRAINT reject_test_note'); }
        });
        await t.test('marking a report fixed updates its hazard and supports retries', async () => {
            assert.equal((await fix('999999')).status, 404);
            assert.equal((await request(`/api/reports/${reportId}/fix`, { method: 'POST' })).status, 401);
            assert.equal((await fix(reportId)).status, 409);
            const checked = await check(reportId);
            assert.equal(checked.status, 200);
            assert.ok(checked.body.report.checked_at);
            assert.equal(checked.body.report.responsible_team, 'Pilot review team');
            assert.equal((await check(reportId)).body.report.checked_at, checked.body.report.checked_at);
            assert.equal((await request('/api/hazards')).body.hazards[0].status, 'verified');
            const result = await fix(reportId);
            assert.equal(result.status, 200); assert.equal(result.body.report.status, 'fixed');
            assert.ok(result.body.report.fixed_at);
            assert.equal((await fix(reportId)).body.report.fixed_at, result.body.report.fixed_at);
            assert.deepEqual((await request('/api/reports')).body.reports, []);
            assert.deepEqual((await request('/api/hazards')).body.hazards, []);
            const hazard = await fixture.query('SELECT status FROM hazard_reports WHERE id = $1', [hazardId]);
            assert.equal(hazard.rows[0].status, 'fixed');
            assert.equal((await request('/api/reports?status=all')).body.reports.length, 2);
        });
        await t.test('fixing one report preserves another open report on the same edge', async () => {
            const a = await post({ ...position, kind: 'broken_surface' });
            const b = await post({ ...position, kind: 'broken_surface' });
            await check(a.body.report.id);
            await fix(a.body.report.id);
            assert.equal((await request('/api/hazards')).body.hazards[0].id, b.body.hazard.id);
            await check(b.body.report.id);
            await fix(b.body.report.id);
        });
        await t.test('concurrent submissions retain one hazard per report', async () => {
            const results = await Promise.all(Array.from({ length: 4 }, () => post({ ...position, kind: 'no_shade' })));
            assert.ok(results.every((result) => result.status === 201));
            assert.equal(new Set(results.map((result) => result.body.report.id)).size, 4);
            assert.equal((await request('/api/hazards')).body.hazards.length, 4);
            assert.equal((await request('/api/reports')).body.reports.length, 4);
        });
        await t.test('places, usable entrance anchors and facilities are stored without claiming verification', async () => {
            const assetPost = body => review('/api/assets', body);
            assert.equal((await request('/api/assets', { method: 'POST', body: '{}' })).status, 401);
            const destination = await assetPost({ kind: 'destination', category: 'healthcare', name: 'Test clinic', lat: 3.12115, lng: 101.659 });
            assert.equal(destination.status, 201);
            const entrance = await assetPost({ kind: 'entrance', parent_id: destination.body.id, category: 'healthcare', name: 'Test step-free door', lat: 3.12115, lng: 101.659 });
            assert.equal(entrance.status, 201);
            const seat = await assetPost({ kind: 'rest', category: 'other', name: 'Test bench', lat: 3.1223, lng: 101.658 });
            assert.equal(seat.status, 201);
            const result = await request('/api/walking-data');
            assert.equal(result.status, 200); assert.equal(result.body.assets.length, 3); assert.deepEqual(result.body.verifications, []);
            const access = result.body.assets.find(a => a.id === entrance.body.id);
            assert.equal(access.parent_id, destination.body.id); assert.equal(access.edge_id, 11);
            assert.ok(access.edge_fraction > .4 && access.edge_fraction < .6); assert.ok(access.connection_distance_m < .1);
            assert.deepEqual(access.properties, {}); assert.equal(access.source, 'community');
            assert.equal((await assetPost({ kind: 'entrance', name: 'Missing parent', lat: 3.12, lng: 101.658 })).status, 400);
            assert.equal((await assetPost({ kind: 'destination', name: 'Invalid coordinates', lat: 100, lng: 101.658 })).status, 400);
            assert.equal((await assetPost({ kind: 'bike_rental', name: 'Wrong scope', lat: 3.12, lng: 101.658 })).status, 400);
        });
        await t.test('field-specific observations persist history, expiry dates and reviewer evidence', async () => {
            const save = body => review('/api/verifications', body);
            const observed = new Date(Date.now() - 60000).toISOString(), until = new Date(Date.now() + 86400000).toISOString();
            const observation = { target_type: 'path', target_id: '11', status: 'verified', method: 'site_visit', reviewer: 'Integration audit team',
                observed_at: observed, valid_until: until, source_ref: 'Test field sheet', attributes: { path_open: true, has_steps: false, slope_pct: 2, surface_rating: 1 } };
            assert.equal((await save(observation)).status, 201);
            assert.equal((await save({ ...observation, status: 'reported', attributes: { path_open: false }, observed_at: new Date().toISOString() })).status, 201);
            const data = (await request('/api/walking-data')).body;
            assert.equal(data.verifications.length, 2); assert.equal(data.verifications[0].attributes.path_open, false);
            assert.equal(data.verifications[1].reviewer, 'Integration audit team'); assert.equal(data.verifications[1].valid_until, until);
            assert.equal((await save({ ...observation, method: 'osm_import' })).status, 400);
            assert.equal((await save({ ...observation, valid_until: null })).status, 400);
            assert.equal((await save({ ...observation, observed_at: new Date(Date.now() + 86400000).toISOString() })).status, 400);
            assert.equal((await save({ ...observation, target_id: '999999' })).status, 404);
            assert.equal((await save({ ...observation, attributes: { slope_pct: 101 } })).status, 400);
            assert.equal((await save({ ...observation, attributes: { clear_width_m: 1.25 } })).status, 201);
            assert.equal((await save({ ...observation, attributes: { clear_width_m: 0 } })).status, 400);
            assert.equal((await save({ ...observation, attributes: { audible_signal: true } })).status, 400);
            assert.equal((await save({ ...observation, attributes: { medical_risk_score: 99 } })).status, 400);
            const facility = data.assets.find(a => a.kind === 'rest');
            assert.equal((await save({ ...observation, target_type: 'facility', target_id: facility.id, attributes: { has_seat: true, path_connection: true, available: true, opening_hours: '24/7' } })).status, 201);
            const entrance = data.assets.find(a => a.kind === 'entrance');
            assert.equal((await save({ ...observation, target_type: 'entrance', target_id: entrance.id, attributes: { step_free: true, path_connection: true, available: true, opening_hours: 'Mo-Fr 09:00-17:00' } })).status, 201);
            const outage = await save({ ...observation, target_type: 'entrance', target_id: entrance.id,
                method: 'operator_record', attributes: { lift_available: false } });
            assert.equal(outage.status, 201);
            assert.equal((await request('/api/walking-data')).body.verifications.find(record => record.id === outage.body.id).attributes.lift_available, false);
            assert.equal((await save({ ...observation, target_type: 'facility', target_id: entrance.id, attributes: { available: true } })).status, 404);
        });
        await t.test('quick condition changes are stored as reports, including facility availability', async () => {
            const save = body => request('/api/condition-updates', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });
            const observation = { kind:'blocked',target_type:'path',target_id:'11',observed_at:new Date().toISOString(),status:'verified',reviewer:'Spoofed reviewer' };
            const result=await save(observation);assert.equal(result.status,201);assert.equal(result.body.status,'reported');
            const stored=(await request('/api/walking-data')).body.verifications.find(v=>v.id===result.body.id);
            assert.equal(stored.status,'reported');assert.equal(stored.attributes.path_open,false);assert.notEqual(stored.reviewer,'Spoofed reviewer');
            assert.equal(Date.parse(stored.valid_until)-Date.parse(stored.observed_at),86400000);
            assert.equal((await save({...observation,target_type:'facility'})).status,400);
            assert.equal((await save({...observation,target_id:'999999'})).status,404);
            const facility=(await request('/api/walking-data')).body.assets.find(a=>a.kind==='rest');
            assert.equal((await save({...observation,kind:'seat_unavailable',target_type:'facility',target_id:facility.id})).status,201);
        });
        await t.test('pilot imports preserve the example and isolate graph, reports and verification targets',async()=>{
            assert.equal((await request('/api/graph?area=unknown')).status,400);
            assert.equal((await request('/api/weather?area=unknown')).status,400);
            assert.equal((await request('/api/weather-warnings?area=unknown')).status,400);
            assert.equal((await request('/api/pilot-context?area=pasar-seni')).status,503);
            assert.equal((await request('/api/walking-data?area=pasar-seni')).status,503);
            const before=(await request('/api/walking-data?area=elmina')).body;
            const {bundle}=pilotFixture();await seedPilotArea(fixture,bundle);await seedPilotArea(fixture,bundle);
            const main=(await request('/api/graph?area=pasar-seni')).body;
            assert.equal(main.edges.length,bundle.graph.edges.length);assert.equal(main.source.area_id,'pasar-seni');
            assert.equal(main.source.dataset_id,bundle.context.dataset_id);
            assert.equal((await request('/api/graph?area=elmina')).body.edges.length,2);
            const context=(await request('/api/pilot-context?area=pasar-seni')).body;
            assert.equal(context.coverage.destinations,bundle.context.coverage.destinations);
            const walking=(await request('/api/walking-data?area=pasar-seni')).body;
            assert.equal(walking.assets.length,bundle.walking.assets.length);assert.deepEqual(walking.verifications,[]);
            assert.deepEqual((await request('/api/walking-data?area=elmina')).body.assets,before.assets);
            const point={lat:3.1425,lng:101.6945,kind:'blocked',description:'Synthetic test report',area_id:'pasar-seni'};
            const report=await post(point);assert.equal(report.status,201);
            assert.equal((await request('/api/reports?area=pasar-seni')).body.reports.length,1);
            assert.ok(!(await request('/api/reports?area=elmina')).body.reports.some(r=>r.id===report.body.report.id));
            assert.equal((await post({...point,area_id:'elmina'})).status,422);
            assert.equal((await fix(report.body.report.id, 'elmina')).status, 404);
            assert.equal((await check(report.body.report.id, 'pasar-seni')).status, 200);
            assert.equal((await fix(report.body.report.id, 'pasar-seni')).status, 200);
            const save=body=>request('/api/condition-updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const update={kind:'blocked',target_type:'path',target_id:String(main.edges[0].id),observed_at:new Date().toISOString(),area_id:'elmina'};
            assert.equal((await save(update)).status,404);
            assert.equal((await save({...update,area_id:'pasar-seni'})).status,201);
            const previousChecks=(await request('/api/walking-data?area=pasar-seni')).body.verifications;
            const station=walking.assets.find(asset=>asset.kind==='transit');
            const gate=walking.assets.find(asset=>asset.parent_id===station.id);
            const extraNodes = [
                { id: 100990000000009, lat: 3.1349, lng: 101.7120 },
                { id: 100990000000010, lat: 3.1349, lng: 101.7121 },
            ];
            const extraEdge = { ...bundle.graph.edges[0], id: 123456789012, osm_way_id: 990000005,
                from_node: extraNodes[0].id, to_node: extraNodes[1].id, length_m: 11,
                geometry: extraNodes.map(({ lat, lng }) => [lng, lat]) };
            const extra = { ...gate, id: '70000000000000', external_id: 'integration-supplemental-gate',
                name: 'Test supplementary gate', lat: 3.1349, lng: 101.7120, edge_id: extraEdge.id, edge_fraction: 0 };
            const augmented = { ...bundle,
                graph: { ...bundle.graph, nodes: [...bundle.graph.nodes, ...extraNodes], edges: [...bundle.graph.edges, extraEdge] },
                appended_graph: { nodes: extraNodes, edges: [extraEdge] },
                walking: { ...bundle.walking, assets: [...bundle.walking.assets, extra] }, supplemental_assets: [extra],
            };
            await seedPilotArea(fixture,augmented);
            await seedPilotArea(fixture,augmented);
            const after=(await request('/api/walking-data?area=pasar-seni')).body;
            assert.equal(after.assets.filter(asset=>asset.id===extra.id).length,1);
            const expanded = (await request('/api/graph?area=pasar-seni')).body;
            assert.equal(expanded.edges.filter(edge => edge.id === extraEdge.id).length, 1);
            assert.deepEqual(expanded.edges.find(edge => edge.id === extraEdge.id).geometry, extraEdge.geometry);
            assert.deepEqual(after.verifications,previousChecks);
            const assets = body => review('/api/assets', body);
            assert.equal((await assets({kind:'entrance',name:'Wrong area parent',parent_id:walking.assets.find(a=>a.kind==='destination').id,lat:3.1425,lng:101.6945,area_id:'elmina'})).status,404);
            const changed=structuredClone(bundle);changed.context.dataset_id='changed';changed.graph.source.dataset_id='changed';changed.walking.dataset_id='changed';
            await assert.rejects(()=>seedPilotArea(fixture,changed),/Another central KL dataset/);
            const unchanged=(await request('/api/walking-data?area=elmina')).body;
            assert.deepEqual(unchanged.verifications,before.verifications);
            assert.equal((await request('/api/graph?area=pasar-seni')).body.source.dataset_id,bundle.context.dataset_id);
        });
        await t.test('an asset report uses its own location and can be dismissed without recording a repair', async () => {
            const place = (await request('/api/walking-data?area=pasar-seni')).body.assets.find(asset => asset.kind === 'entrance');
            const posted = await post({ ...position, area_id: 'pasar-seni', asset_id: place.id, kind: 'blocked' });
            assert.equal(posted.status, 201);
            assert.equal(posted.body.report.lat, place.lat);
            assert.equal(posted.body.hazard.asset_id, place.id);
            assert.equal((await post({ ...position, asset_id: place.id, kind: 'blocked' })).status, 422);
            const dismissed = await check(posted.body.report.id, 'pasar-seni', true);
            assert.ok(dismissed.body.report.dismissed_at);
            assert.equal(dismissed.body.report.fixed_at, null);
            assert.deepEqual((await request('/api/hazards?area=pasar-seni')).body.hazards, []);
        });
        await t.test('community proposals stay private until screened and need a review before navigation', async () => {
            const base = '/api/community-routes?area=pasar-seni';
            const context = (await request('/api/pilot-context?area=pasar-seni')).body;
            const draft = { submission_id: randomUUID(), dataset_id: context.dataset_id, title: 'Test local shortcut',
                notes: 'Use the public path by the clinic.', public_ends: true, points: [[3.1425, 101.694], [3.1425, 101.696]] };
            const upload = body => request(base, { method: 'POST', body: JSON.stringify(body) });
            assert.equal((await upload({ ...draft, public_ends: false })).status, 400);
            assert.equal((await upload({ ...draft, dataset_id: 'different' })).status, 409);
            const submitted = await upload(draft);
            assert.equal(submitted.status, 201);
            const { route } = submitted.body;
            assert.equal(route.status, 'submitted');
            assert.ok(route.path.edge_ids.length > 0);
            assert.equal((await upload(draft)).body.route.id, route.id);
            assert.deepEqual((await request(base)).body.routes, []);
            assert.equal((await request(`${base}&receipt=${draft.submission_id}`)).body.routes[0].id, route.id);
            assert.equal((await request(`${base}&review=1`)).status, 401);

            const endpoint = id => `/api/community-routes/${id}/review?area=pasar-seni`;
            const evidence = { reviewer: 'Test route team', note: 'Tested the entire public path.' };
            const verify = { ...evidence, action: 'verify', field_checked: true, opening_hours: '24/7' };
            assert.equal((await request(endpoint(route.id), { method: 'POST' })).status, 401);
            assert.equal((await review(endpoint(route.id), verify)).status, 409);
            assert.equal((await review(endpoint(route.id), { ...evidence, action: 'publish' })).body.route.status, 'published');
            assert.equal((await request(base)).body.routes[0].status, 'published');
            assert.equal((await review(endpoint(route.id), { ...verify, field_checked: false })).status, 400);
            const checked = await review(endpoint(route.id), verify);
            assert.equal(checked.body.route.status, 'verified');
            assert.ok(Date.parse(checked.body.route.valid_until) > Date.now());
            const unmapped = await upload({ ...draft, submission_id: randomUUID(), points: [[3.1425, 101.694], [3.143, 101.694]] });
            assert.equal(unmapped.body.route.path, null);
            assert.equal((await review(endpoint(unmapped.body.route.id), { ...evidence, action: 'publish' })).status, 422);
        });
        await t.test('operator responsibility routes new reports and case handoffs are private and versioned', async () => {
            const area = 'pasar-seni';
            const targetsPath = `/api/operator/targets?area=${area}`;
            const graph = (await request(`/api/graph?area=${area}`)).body;
            const edge = graph.edges.find(edge => edge.name === 'Test public path');
            const [lng, lat] = edge.geometry[0];
            const ownership = { target_type: 'edge', target_id: String(edge.id), team: 'Township operations', reference: 'Asset register 2' };
            assert.equal((await request(targetsPath)).status, 401);
            assert.equal((await review('/api/operator/targets?area=elmina', ownership, 'PUT')).status, 404);
            const owned = await review(targetsPath, ownership, 'PUT');
            assert.equal(owned.status, 200);
            assert.equal((await review(targetsPath, ownership, 'PUT')).body.responsibility.updated_at, owned.body.responsibility.updated_at);
            const mapTargets = (await review(`${targetsPath}&q=${edge.id}`, undefined, 'GET')).body;
            assert.equal(mapTargets.total, 1);
            assert.equal(mapTargets.targets[0].responsibility.team, ownership.team);
            assert.equal(mapTargets.targets[0].check.status, 'incomplete');
            assert.equal(mapTargets.coverage.find(row => row.kind === 'path').owned, 1);

            const checkedAt = new Date().toISOString();
            const validThrough = new Date(Date.now() + 7 * 86400000).toISOString();
            const audit = await review('/api/verifications', { area_id: area, target_type: 'path', target_id: String(edge.id),
                status: 'verified', method: 'site_visit', reviewer: 'Operator test audit', observed_at: checkedAt, valid_until: validThrough,
                attributes: { path_open: true, has_steps: false, slope_pct: 3, surface_rating: 1, clear_width_m: 1.8 } });
            assert.equal(audit.status, 201);
            const due = (await review(`${targetsPath}&q=${edge.id}&state=due_soon`, undefined, 'GET')).body;
            assert.equal(due.targets[0].check.status, 'current');
            assert.equal(due.targets[0].check.next_due, validThrough);
            assert.equal(due.coverage.find(row => row.kind === 'path').due_soon, 1);

            const payload = { area_id: area, lat, lng, edge_id: edge.id, kind: 'blocked', description: 'Operator test case notes' };
            const initial = (await post(payload)).body.report;
            assert.equal(initial.responsible_team, ownership.team);
            assert.equal(initial.assignment_version, undefined);
            const [other] = (await review(`/api/reports?area=${area}&operator=1`, undefined, 'GET')).body.reports;
            assert.equal(other.assignment_version, 1);
            const assignment = `/api/reports/${initial.id}/assignment?area=${area}`;
            assert.equal((await request(assignment)).status, 401);
            const body = { team: 'Walkway contractor', due_on: '2026-11-19', work_order_ref: '=MY-001', version: 1 };
            const saved = await review(assignment, body, 'PATCH');
            assert.equal(saved.status, 200);
            assert.equal(saved.body.report.assignment_version, 2);
            assert.equal((await review(assignment, body, 'PATCH')).body.report.assignment_version, 2);
            assert.equal((await review(assignment, { ...body, team: 'Other team' }, 'PATCH')).status, 409);
            assert.equal((await review(assignment, { ...body, due_on: '2026-02-31', version: 2 }, 'PATCH')).status, 400);
            const history = (await review(assignment, undefined, 'GET')).body.history;
            assert.deepEqual(history.map(item => item.source), ['manual', 'responsibility']);
            const shared = (await request(`/api/reports?area=${area}`)).body.reports[0];
            assert.equal(shared.responsible_team, body.team);
            assert.equal(shared.work_order_ref, undefined);
            assert.equal(shared.due_on, undefined);
            assert.equal((await check(initial.id, area)).body.report.responsible_team, body.team);

            const second = await post(payload);
            assert.equal(second.body.report.responsible_team, ownership.team);
            const activity = (await review(`/api/operator/activity?area=${area}&days=7`, undefined, 'GET')).body;
            assert.equal(activity.hotspots.find(item => item.name === edge.name).open, 2);
            assert.ok(activity.teams.some(row => row.team === body.team));
            assert.equal((await review(`/api/operator/activity?area=${area}&days=14`, undefined, 'GET')).status, 400);

            const exportPath = `/api/operator/export?area=${area}`;
            assert.equal((await request(exportPath + '&format=json')).status, 401);
            const json = (await review(exportPath + '&format=json', undefined, 'GET')).body;
            assert.equal(json.area_id, area);
            assert.equal(json.rows.find(row => row.id === initial.id).work_order_ref, body.work_order_ref);
            assert.ok(!JSON.stringify(json).includes(payload.description));
            const csv = await fetch(`http://127.0.0.1:${port}${exportPath}`, { headers: { Authorization: `Bearer ${reviewKey}` } });
            assert.match(csv.headers.get('content-disposition'), /townshipgo-pasar-seni-cases.csv/);
            assert.match(await csv.text(), /"'=MY-001"/);
            const geo = await review(exportPath + '&dataset=checks&format=geojson', undefined, 'GET');
            assert.equal(geo.body.type, 'FeatureCollection');
            assert.equal(geo.body.features.find(feature => feature.properties.target_id === String(edge.id)).geometry.type, 'LineString');
            assert.equal((await review(targetsPath, { ...ownership, team: null }, 'PUT')).body.responsibility, null);
            assert.equal((await review(assignment, undefined, 'GET')).body.history.length, 2);
        });
        await t.test('database outages return 503 without exposing connection details', async () => {
            await fixture.end(); fixture = undefined;
            await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); dropped = true;
            const result = await request('/api/health');
            assert.equal(result.status, 503);
            assert.doesNotMatch(JSON.stringify(result.body), /township_local|postgresql:|township_test_/);
        });
    } finally {
        if (app && app.exitCode === null) {
            const exited = once(app, 'exit'); app.kill('SIGTERM'); await exited;
        }
        await fixture?.end();
        if (!dropped) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        await admin.end();
    }
});
