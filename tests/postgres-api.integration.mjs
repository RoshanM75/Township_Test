import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
            env: { ...process.env, DATABASE_URL: connection.href }, stdio: ['ignore', 'pipe', 'pipe'],
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
            assert.equal((await request('/api/reports/1%20OR%201=1/fix', { method: 'POST' })).status, 400);
            assert.equal((await request('/api/reports', { method: 'POST', body: '{' })).status, 400);
            assert.equal((await post({ ...position, kind: 'blocked', description: 'x'.repeat(17000) })).status, 413);
            assert.deepEqual(await counts(), { hazards: 1, reports: 1 });
        });
        await t.test('PostGIS rejects reports away from a mapped pedestrian path', async () => {
            assert.equal((await post({ lat: 0, lng: 0, kind: 'blocked' })).status, 422);
            assert.equal((await post({ ...position, edge_id: 99999, kind: 'blocked' })).status, 422);
            const snapped = await post({ lat: position.lat, lng: position.lng, kind: 'light_out' });
            assert.equal(snapped.status, 201); assert.equal(snapped.body.report.edge_id, 11);
            await request(`/api/reports/${snapped.body.report.id}/fix`, { method: 'POST' });
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
            assert.equal((await request('/api/reports/999999/fix', { method: 'POST' })).status, 404);
            const result = await request(`/api/reports/${reportId}/fix`, { method: 'POST' });
            assert.equal(result.status, 200); assert.equal(result.body.report.status, 'fixed');
            assert.equal((await request(`/api/reports/${reportId}/fix`, { method: 'POST' })).status, 200);
            assert.deepEqual((await request('/api/reports')).body.reports, []);
            assert.deepEqual((await request('/api/hazards')).body.hazards, []);
            const hazard = await fixture.query('SELECT status FROM hazard_reports WHERE id = $1', [hazardId]);
            assert.equal(hazard.rows[0].status, 'fixed');
            assert.equal((await request('/api/reports?status=all')).body.reports.length, 2);
        });
        await t.test('fixing one report preserves another open report on the same edge', async () => {
            const a = await post({ ...position, kind: 'broken_surface' });
            const b = await post({ ...position, kind: 'broken_surface' });
            await request(`/api/reports/${a.body.report.id}/fix`, { method: 'POST' });
            assert.equal((await request('/api/hazards')).body.hazards[0].id, b.body.hazard.id);
            await request(`/api/reports/${b.body.report.id}/fix`, { method: 'POST' });
        });
        await t.test('concurrent submissions retain one hazard per report', async () => {
            const results = await Promise.all(Array.from({ length: 4 }, () => post({ ...position, kind: 'no_shade' })));
            assert.ok(results.every((result) => result.status === 201));
            assert.equal(new Set(results.map((result) => result.body.report.id)).size, 4);
            assert.equal((await request('/api/hazards')).body.hazards.length, 4);
            assert.equal((await request('/api/reports')).body.reports.length, 4);
        });
        await t.test('places, usable entrance anchors and facilities are stored without claiming verification', async () => {
            const assetPost = body => request('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
            const save = body => request('/api/verifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
            assert.equal((await request(`/api/reports/${report.body.report.id}/fix?area=elmina`,{method:'POST'})).status,404);
            assert.equal((await request(`/api/reports/${report.body.report.id}/fix?area=pasar-seni`,{method:'POST'})).status,200);
            const save=body=>request('/api/condition-updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const update={kind:'blocked',target_type:'path',target_id:String(main.edges[0].id),observed_at:new Date().toISOString(),area_id:'elmina'};
            assert.equal((await save(update)).status,404);
            assert.equal((await save({...update,area_id:'pasar-seni'})).status,201);
            const previousChecks=(await request('/api/walking-data?area=pasar-seni')).body.verifications;
            const station=walking.assets.find(asset=>asset.kind==='transit');
            const gate=walking.assets.find(asset=>asset.parent_id===station.id);
            const extra={...gate,id:'70000000000000',external_id:'integration-supplemental-gate',name:'Test supplementary gate'};
            const augmented={...bundle,walking:{...bundle.walking,assets:[...bundle.walking.assets,extra]},supplemental_assets:[extra]};
            await seedPilotArea(fixture,augmented);
            await seedPilotArea(fixture,augmented);
            const after=(await request('/api/walking-data?area=pasar-seni')).body;
            assert.equal(after.assets.filter(asset=>asset.id===extra.id).length,1);
            assert.deepEqual(after.verifications,previousChecks);
            const assets=body=>request('/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            assert.equal((await assets({kind:'entrance',name:'Wrong area parent',parent_id:walking.assets.find(a=>a.kind==='destination').id,lat:3.1425,lng:101.6945,area_id:'elmina'})).status,404);
            const changed=structuredClone(bundle);changed.context.dataset_id='changed';changed.graph.source.dataset_id='changed';changed.walking.dataset_id='changed';
            await assert.rejects(()=>seedPilotArea(fixture,changed),/Another central KL dataset/);
            const unchanged=(await request('/api/walking-data?area=elmina')).body;
            assert.deepEqual(unchanged.verifications,before.verifications);
            assert.equal((await request('/api/graph?area=pasar-seni')).body.source.dataset_id,bundle.context.dataset_id);
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
