import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewSnapshot } from '../scripts/preview-snapshot.mjs';
import { planJourney } from '../lib/journeys.ts';
import { DEFAULT_ORIGIN } from '../lib/precinct.ts';
import { DEFAULT_NEEDS } from '../lib/walking.ts';
import { loadPagesPilot,pagesPilotMetadata } from '../scripts/pilot-export.mjs';
import { pilotFixture } from './helpers/pilot-fixture.mjs';

test('Pages uses the real Elmina example while a missing KL bundle stays pending',async t=>{
    const dir=mkdtempSync(join(tmpdir(),'township-pending-pages-'));
    t.after(()=>rmSync(dir,{recursive:true,force:true}));
    const pilot=await loadPagesPilot(join(dir,'missing.json'));
    assert.equal(pilot,null);
    assert.deepEqual(pagesPilotMetadata(pilot),{areas:['elmina'],default_area:'elmina',pilot_status:{'pasar-seni':'awaiting-source-data','um-campus':'awaiting-source-data',elmina:'available'}});
});

test('a valid KL source enables the pilot; corrupt or private sources never fall back silently',async t=>{
    const dir=mkdtempSync(join(tmpdir(),'township-ready-pages-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
    const file=join(dir,'bundle.json'),{bundle}=pilotFixture();
    writeFileSync(file,JSON.stringify(bundle));
    const loaded=await loadPagesPilot(file);
    assert.equal(loaded.context.dataset_id,bundle.context.dataset_id);
    assert.deepEqual(pagesPilotMetadata(loaded),{areas:['pasar-seni','elmina'],default_area:'pasar-seni',pilot_status:{'pasar-seni':'available','um-campus':'awaiting-source-data',elmina:'available'}});
    writeFileSync(file,'{invalid');await assert.rejects(()=>loadPagesPilot(file),SyntaxError);
    bundle.walking.verifications.push({reviewer:'Private test record'});
    writeFileSync(file,JSON.stringify(bundle));await assert.rejects(()=>loadPagesPilot(file),/field-auditor/);
});

test('Pages defaults and navigation availability agree with the built source bundle',()=>{
    for(const ready of ['true','false',''])execFileSync(process.execPath,['--input-type=module','-e',`
        import assert from 'node:assert/strict';
        import {isPilotAvailable,pilotFromParams,DEFAULT_PILOT} from './lib/pilots.ts';
        const ready=process.env.NEXT_PUBLIC_KL_PILOT_AVAILABLE==='true';
        assert.equal(DEFAULT_PILOT,ready?'pasar-seni':'elmina');
        assert.equal(pilotFromParams(new URLSearchParams()),DEFAULT_PILOT);
        assert.equal(isPilotAvailable('pasar-seni'),ready);assert.equal(isPilotAvailable('elmina'),true);
        // Keep explicit KL links intact so the UI can explain its unavailable state.
        assert.equal(pilotFromParams(new URLSearchParams('area=pasar-seni')),'pasar-seni');
        assert.equal(pilotFromParams(new URLSearchParams('destId=elmina_rainbow_bridge')),'elmina');
    `],{env:{...process.env,NEXT_PUBLIC_SITE_MODE:'pages',NEXT_PUBLIC_KL_PILOT_AVAILABLE:ready}});
});

test('the public snapshot plans actual Elmina walks without inventing field checks', t => {
    const dir = mkdtempSync(join(tmpdir(), 'township-pages-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    execFileSync(process.execPath, ['scripts/osm-to-graph.mjs', '--in', 'precinct.json', '--out-json', join(dir, 'graph.json')]);
    const source = JSON.parse(readFileSync('precinct.json', 'utf8'));
    const snapshot = createPreviewSnapshot(JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')), source, '2026-11-17T04:00:00Z');
    assert.equal(snapshot.graph.edges.length, 602);
    assert.ok(snapshot.graph.edges.every(e => e.pedestrian_access && e.kind !== 'street'));
    assert.deepEqual(snapshot.walking.verifications, []);
    assert.deepEqual(snapshot.hazards.hazards, []);
    assert.deepEqual(snapshot.reports.reports, []);
    assert.equal(snapshot.walking.assets.length, 4);
    for (const destination of snapshot.walking.assets.filter(a => a.kind === 'destination')) {
        for (const profile of ['everyday', 'senior', 'cane_walker', 'wheelchair', 'stroller']) {
            const plan = planJourney(snapshot.graph.nodes, snapshot.graph.edges, snapshot.walking, { origin: DEFAULT_ORIGIN,
                destination, profile, needs: DEFAULT_NEEDS, departure_at: snapshot.walking.as_of });
            assert.ok(plan.routes.direct, `${profile}: ${destination.name}`);
            assert.equal(plan.routes.direct.suitability, 'yellow');
            assert.ok(plan.routes.direct.total_min <= 30);
        }
    }
});

test('Pages data uses the project prefix, a current planning clock and never sends shared writes', () => {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import {loadGraph,loadWalkingData,loadHazards,loadReports,submitReport,createWalkingAsset,recordVerification,markReportFixed,loadWeather} from './lib/api.ts';
        const urls=[];
        globalThis.fetch=async url=>{urls.push(url);return Response.json(String(url).includes('walking-data')?{assets:[],verifications:[],as_of:'2000-01-01T00:00:00Z'}:String(url).includes('/graph.json')?{source:{area_id:'elmina'},nodes:[],edges:[]}:{});};
        await loadGraph();const walking=await loadWalkingData();await loadHazards();await loadReports('all');
        assert.deepEqual(urls,['/Township_Test/pilot/graph.json','/Township_Test/map-area/elmina-world.json','/Township_Test/pilot/walking-data.json','/Township_Test/pilot/hazards.json','/Township_Test/pilot/reports.json']);
        assert.ok(Math.abs(Date.parse(walking.as_of)-Date.now())<2000);
        for(const call of [()=>submitReport({}),()=>createWalkingAsset({}),()=>recordVerification({}),()=>markReportFixed('1')])await assert.rejects(call,/Nothing was submitted/);
        assert.equal(urls.length,5);
        globalThis.fetch=async ()=>{throw new Error('Weather outage');};
        const weather=await loadWeather();assert.equal(weather.source,'unavailable');assert.equal(weather.feels_like_c,null);
    `], { env: { ...process.env, NEXT_PUBLIC_SITE_MODE: 'pages', NEXT_PUBLIC_BASE_PATH: '/Township_Test' } });
});

test('area-scoped public data keeps the project prefix and distinct source files',()=>{
    execFileSync(process.execPath,['--input-type=module','-e',`
        import assert from 'node:assert/strict';
        import {loadGraph,loadWalkingData,loadHazards,loadReports,loadPilotContext} from './lib/api.ts';
        const urls=[];globalThis.fetch=async url=>{urls.push(url);return Response.json(String(url).includes('/graph.json')?{source:{area_id:'pasar-seni'},nodes:[],edges:[]}:{});};
        await loadGraph('pasar-seni');await loadWalkingData('elmina');await loadHazards('pasar-seni');await loadReports('all','elmina');await loadPilotContext('pasar-seni');
        assert.deepEqual(urls,['/Township_Test/pilot/pasar-seni/graph.json','/Township_Test/map-area/pasar-seni-world.json','/Township_Test/pilot/elmina/walking-data.json','/Township_Test/pilot/pasar-seni/hazards.json','/Township_Test/pilot/elmina/reports.json','/Township_Test/pilot/pasar-seni/context.json']);
    `],{env:{...process.env,NEXT_PUBLIC_SITE_MODE:'pages',NEXT_PUBLIC_BASE_PATH:'/Township_Test'}});
});
