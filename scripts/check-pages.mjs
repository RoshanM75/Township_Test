import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validatePilotSnapshot } from './pilot-export.mjs';
import { metres } from '../lib/walking-geometry.ts';

const out = new URL('../out/', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('site-config.json', out), 'utf8'));
const prefix = metadata.base_path;
for (const route of ['', 'resident/', 'dashboard/', 'verification/']) {
    const html = await readFile(new URL(`${route}index.html`, out), 'utf8');
    assert.ok(html.includes('TownshipGo') || html.includes('Loading'), `Missing actual app HTML: ${route}`);
    const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m => /href="([^"]+)"/.exec(m[0])?.[1]).filter(Boolean);
    assert.ok(styles.length, `Missing styles: ${route}`);
    const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(p => p.includes('/_next/'));
    assert.ok(assets.length, `Missing app JavaScript: ${route}`);
    for (const path of [...styles, ...assets]) {
        assert.ok(path.startsWith(`${prefix}/_next/`), `An asset escapes the project base path: ${path}`);
        const file = resolve(out.pathname, decodeURIComponent(path.slice(prefix.length + 1).split('?')[0]));
        assert.ok(file.startsWith(resolve(out.pathname) + '/'));
        await access(file);
    }
}
const graph = JSON.parse(await readFile(new URL('pilot/graph.json', out), 'utf8'));
const data = JSON.parse(await readFile(new URL('pilot/walking-data.json', out), 'utf8'));
assert.ok(graph.nodes.length && graph.edges.length);
assert.ok(graph.edges.every(e => e.pedestrian_access === true && e.kind !== 'street'));
assert.equal(data.verifications.length, 0, 'The public source build must never publish local observations.');
assert.equal(data.assets.filter(a => a.kind === 'destination').length, 2);
assert.ok(metadata.areas.includes('elmina'),'Keep the working Elmina example available.');
assert.ok(metadata.areas.includes(metadata.default_area),'The default area needs actual source data.');
const klReady=metadata.areas.includes('pasar-seni');
assert.equal(metadata.pilot_status['pasar-seni'],klReady?'available':'awaiting-source-data');
const umReady=metadata.areas.includes('um-campus');
assert.equal(metadata.pilot_status['um-campus'],umReady?'available':'awaiting-source-data');
assert.equal(metadata.default_area,klReady?'pasar-seni':umReady?'um-campus':'elmina');
if(!klReady){
    const home=await readFile(new URL('index.html',out),'utf8');
    assert.ok(home.includes('Central KL pilot · data pending'),'The public site must explain the pending KL source.');
    assert.ok(!home.includes('Discover central KL on foot'),'Do not advertise unavailable KL routing.');
}
const areaCounts=[];
for(const area of metadata.areas){
    const read=async name=>JSON.parse(await readFile(new URL(`pilot/${area}/${name}.json`,out),'utf8'));
    const context=await read('context');assert.equal(context.area_id,area);
    const mapArea = JSON.parse(await readFile(new URL(`map-area/${area}.geojson`, out), 'utf8'));
    assert.ok(mapArea.features.length, `Missing local basemap for ${area}.`);
    const terrain = JSON.parse(await readFile(new URL(`map-area/${area}-terrain.json`, out), 'utf8'));
    assert.ok(terrain.sample_count > 100 && terrain.source_resolution_m === 90, `Missing dated elevation grid for ${area}.`);
    assert.ok(terrain.sample_spacing_m >= terrain.source_resolution_m && terrain.max_m > terrain.min_m);
    assert.ok(mapArea.features.some(feature => feature.properties.kind === 'contour'), `Missing local terrain contours for ${area}.`);
    assert.ok(mapArea.features.filter(feature => feature.properties.kind === 'building').every(feature => ['height','levels','approximate','satellite','overture-height','survey'].includes(feature.properties.heightSource) && Number.isFinite(feature.properties.height) && feature.properties.height > feature.properties.base), `Invalid building dimensions for ${area}.`);
    await access(new URL(`map-area/${area}-terrain/relief.png`,out));
    const [w,s,e,n]=terrain.bounds;
    for(let z=terrain.minzoom;z<=terrain.maxzoom;z++){
        const size=2**z, tileX=lng=>Math.floor((lng+180)/360*size), tileY=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*size);
        for(let x=tileX(w);x<=tileX(e);x++)for(let y=tileY(n);y<=tileY(s);y++)await access(new URL(`map-area/${area}-terrain/${z}/${x}/${y}.png`,out));
    }
    const solar = JSON.parse(await readFile(new URL(`map-area/${area}-shade.json`, out), 'utf8'));
    assert.ok(solar.centre.every(Number.isFinite) && Array.isArray(solar.objects), `Invalid shade geometry for ${area}.`);
    const world=JSON.parse(await readFile(new URL(`map-area/${area}-world.json`,out),'utf8'));
    assert.equal(world.area,area);assert.equal(world.version,1);assert.ok(Object.keys(world.geometry).length&&world.sources.some(s=>s.id==='osm'));
    assert.ok(mapArea.features.some(feature=>feature.properties.kind==='infrastructure'));
    assert.equal(solar.coverage,'partial');
    await access(new URL(`map-area/${area}-survey-gaps.csv`,out));await access(new URL(`map-area/${area}-survey-gaps.geojson`,out));
    if (area !== 'elmina') assert.ok(solar.objects.length, `Missing mapped-height buildings for ${area}.`);
    for (const neighbourhood of context.neighbourhoods ?? []) {
        const [lat, lng] = neighbourhood.coordinates;
        assert.ok(mapArea.features.some(feature => feature.properties.kind === 'street' &&
            feature.geometry.coordinates.some(point => metres([lng, lat], point) < 500)),
        `Missing detailed base streets near ${neighbourhood.name}.`);
    }
    if (area === 'um-campus') assert.ok(mapArea.features.some(feature => feature.properties.kind === 'building'), 'UM needs mapped 3D building footprints.');
    const areaGraph=await read('graph');areaCounts.push(`${area}: ${areaGraph.edges.length} pedestrian segments`);
    if(area!=='elmina'){
        validatePilotSnapshot({area_id:area,graph:areaGraph,walking:await read('walking-data'),hazards:await read('hazards'),reports:await read('reports'),context});
        for(const name of ['paths','places','transit','satellite']){
            const layer=JSON.parse(await readFile(new URL(`pilot/${area}/gis/${name}.geojson`,out),'utf8'));
            assert.equal(layer.type,'FeatureCollection');
        }
    }
}
await access(new URL('planning-worker/solar-shade.js', out));
await access(new URL('planning-worker/planning-entry.js',out));
const entry=await readFile(new URL('planning-worker/planning-entry.js',out),'utf8');
assert.ok(entry.includes('./planning-dispatch.js'),'The planning worker needs browser-compatible module paths.');
await access(new URL('.nojekyll', out));
await access(new URL('offline-walks.html', out));
await access(new URL('walk-offline-worker.js', out));
console.log(`Static app checked: HTML, CSS, JavaScript and ${areaCounts.join('; ')} under ${prefix || '/'}.`);
