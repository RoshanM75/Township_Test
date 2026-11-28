import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { PILOTS } from '../lib/pilots.ts';
import { csvRows } from '../lib/data/csv.ts';
import { districtPopulation, railDemand, satelliteScenes, transitContext, wikidataLandmarks } from '../lib/data/context.ts';
import { csvFile, download, fileDigest, gtfsFiles } from './data-download.mjs';
import { mappedWayfinding } from './pilot-osm-details.mjs';
import { loadWalkingWorld,representativeShade } from './walking-world-source.mjs';
import { connectTransitStops } from './pilot-transit-links.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: options } = parseArgs({ options: {
    'sources-dir': { type: 'string' }, 'fetch-gtfs': { type: 'boolean' },
    'archive-url': { type: 'string' }, 'archive-date': { type: 'string' },
    'out-dir': { type: 'string' },
} });
const directory = resolve(options['sources-dir'] ?? resolve(root, '.local/sources/walking-details'));
const output = resolve(options['out-dir'] ?? resolve(root, 'data'));
const archive = options['archive-url'];
const archiveDate = options['archive-date'] ?? null;
if (archive && (!archive.startsWith('https://') || !/^\d{4}-\d{2}-\d{2}$/.test(archiveDate ?? ''))) {
    throw new Error('Supply a public HTTPS archive URL and the archive capture date.');
}
const areas = ['pasar-seni', 'um-campus'];
const feeds = [
    ['gtfs-rail', 'rapid-rail-kl', 'rail.zip'],
    ['gtfs-bus', 'rapid-bus-kl', 'bus.zip'],
    ['gtfs-feeder', 'rapid-bus-mrtfeeder', 'feeder.zip'],
];
const gtfsDocs = 'https://developer.data.gov.my/realtime-api/gtfs-static.en';
const umTransport = 'https://jhb.um.edu.my/transport';
const treeInventory = 'https://jhb.um.edu.my/news/campus-safety-current-measures-for-managing-high-risk-trees';

async function readOptional(path) {
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

async function supplied(path) {
    try { await access(path); return true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
}

function source(id, name, url, license, status, records, note, extra = {}) {
    return { id, name, url, license, status, data_at: null, fetched_at: null, records, note, ...extra };
}

const importFiles = new Map();
let previousRequest = 0;
for (const [id, agency, filename] of feeds) {
    const path = resolve(directory, filename);
    let ready = await supplied(path);
    let downloaded = null;
    if (options['fetch-gtfs']) {
        if (previousRequest) await new Promise(done => setTimeout(done, Math.max(0, 16000 - (Date.now() - previousRequest))));
        previousRequest = Date.now();
        try {
            downloaded = await download(`https://api.data.gov.my/gtfs-static/prasarana?category=${agency}`, path, { maxBytes: 60000000 });
            ready = true;
        } catch (error) {
            console.warn(`${agency}: ${error.message}. Keeping supplied or previously published data.`);
        }
    }
    if (ready) importFiles.set(id, { agency, path, license: 'CC BY 4.0', url: gtfsDocs,
        data_at: downloaded?.fetched_at?.slice(0, 10) ?? archiveDate, fetched_at: downloaded?.fetched_at ?? null,
        archive_url: downloaded ? null : archive ?? null, sha256: await fileDigest(path) });
}

const shuttle = resolve(directory, 'um-shuttle.zip');
if (await supplied(shuttle)) {
    const meta = await readOptional(resolve(directory, 'um-shuttle.source.json'));
    if (!meta || !/^https:\/\//.test(meta.url ?? '') || !meta.license || !/^\d{4}-\d{2}-\d{2}$/.test(meta.data_at ?? '')) {
        throw new Error('Campus shuttle GTFS requires a dated, reusable operator source in um-shuttle.source.json.');
    }
    importFiles.set('um-shuttle', { agency: 'um-shuttle', path: shuttle, url: meta.url, license: meta.license,
        data_at: meta.data_at, fetched_at: null, archive_url: null, sha256: await fileDigest(shuttle) });
}

const populationPath = resolve(root, 'data/pasar-seni/source/population_district.csv.gz');
const [headers, ...rows] = csvRows(gunzipSync(await readFile(populationPath)).toString('utf8'));
const population = rows.map(row => Object.fromEntries(headers.map((key, i) => [key, row[i] ?? ''])));
const ridershipPath = resolve(directory, 'rapid-rail-od.csv');
const hasDemand = await supplied(ridershipPath);
const snapshots = [];
for (const area of areas) {
    const data = resolve(root, 'data', area);
    const bundle = JSON.parse(await readFile(resolve(data, 'bundle.json'), 'utf8'));
    const path = resolve(output, area, 'walking-details.json');
    const prior = await readOptional(path);
    const reference = prior?.area_id === area ? prior.context : null;
    const raw = JSON.parse(gunzipSync(await readFile(resolve(data, 'source', `${area}-osm.json.gz`))).toString('utf8'));
    const date = raw.osm3s.timestamp_osm_base.slice(0, 10);
    const survey = await readOptional(resolve(directory, `${area}.shade.geojson`));
    if (survey && (survey.type !== 'FeatureCollection' || !Array.isArray(survey.features) ||
        !/^https:\/\//.test(survey.source_url ?? '') || !survey.license || !/^\d{4}-\d{2}-\d{2}$/.test(survey.data_at ?? ''))) {
        throw new Error('A canopy survey needs a local GeoJSON FeatureCollection, source_url, license and data_at.');
    }
    const world=await loadWalkingWorld(area,survey??undefined);
    if(survey){ // Explicit source file with a reusable licence; the validated geometry is shared by future builds.
        const publicSource=resolve(data,'source','pedestrian-survey.geojson');
        await writeFile(publicSource,JSON.stringify(survey));
    }
    const shade={paths:Object.fromEntries(Object.entries(representativeShade(bundle.graph.edges,world.solar,world.world.ways,date)).map(([id,values])=>[id,{...values,shade_source:'modelled'}])),shade:{model_date:date,buildings:world.solar.buildings,crowns:world.solar.crowns}};
    const { paths, facilities, entrances, qids } = mappedWayfinding(bundle, raw);
    const mappedPathCount = Object.keys(paths).length;
    for (const [edge, values] of Object.entries(shade.paths)) paths[edge] = { ...paths[edge], ...values };
    const sources = new Map((reference?.sources ?? []).map(item => [item.id, item]));
    const put = item => sources.set(item.id, item);
    put(source('osm-details', 'Mapped access and facility details', 'https://www.openstreetmap.org/copyright', 'ODbL',
        'loaded', mappedPathCount + Object.keys(facilities).length + entrances.length,
        'Source tags and street-level station entrances. Location and access details still need field checks.', { data_at: date }));
    put(source('shade-model', 'Building and canopy shade estimate', 'https://www.openstreetmap.org/copyright',
        'ODbL', 'partial', Object.keys(shade.paths).length,
        `Daylight estimates using ${shade.shade.buildings} building footprints and ${shade.shade.crowns} source-qualified canopy shapes. Unknown height or canopy stays missing. Roof cover is separate.`,
        { data_at: date }));
    for(const item of world.imported)put(source(`walking-model-${item.id}`,item.name,item.url,item.license,'loaded',item.records,'Source-qualified geometry shared by maps and solar estimates; not a live field check.',{data_at:item.data_at}));
    sources.delete('shade-survey');
    put(source('dosm', 'DOSM district population', 'https://data.gov.my/data-catalogue/population_district',
        'CC BY 4.0', 'loaded', 1, 'District context shared by the two Kuala Lumpur walking areas.'));
    if (area === 'um-campus') {
        put(source('um-inclusive', 'UM Inclusive Map', 'https://hep.um.edu.my/index', 'Reference only', 'partial', 0,
            'Official access map for choosing what to audit. No campus facility export was supplied.'));
        put(source('um-facilities', 'UM Facilities and tree inventory', treeInventory, 'Reference only', 'partial', 0,
            'UM describes campus shade-tree mapping from 2015. A reusable, updated street-level survey is needed for canopy coverage.'));
        if (!sources.has('um-shuttle')) put(source('um-shuttle', 'UM shuttle timetable', umTransport, 'Reference only', 'partial', 0,
            'Use the operator timetable. A current point-level campus shuttle feed and boarding checks have not been supplied.'));
    } else {
        put(source('mrt-station-plan', 'MRT Corp Pasar Seni station plan', 'https://www.mymrt.com.my/wp-content/uploads/2024/11/S16-PASAR-SENI.pdf',
            'Plan reference; OSM geometry is ODbL', 'partial', entrances.length, 'Station gate names cross-referenced with the plan. Lift operation and inside-station routes require current checks.'));
        put(source('access-kl', 'IncluCity Access KL · Central Market', 'https://inclucity.my/access-kl/central-market', 'Reference only',
            'partial', 0, 'External venue audit for checks at Central Market. No audited asset export or redistribution permission was supplied.'));
        put(source('dbkl-landscape', 'DBKL landscape plan', 'https://www.dbkl.gov.my/penerbitan-dan-laporan/pelan-induk-landskap-kuala-lumpur-2040-pilkl-2040',
            'Reference only', 'partial', 0, 'Planning reference. Public, reusable canopy geometry and walkway closures can be added when supplied.'));
    }
    const priorTransit = reference?.transit ?? bundle.context.transit;
    const transit = { stops: [...priorTransit.stops], routes: [...priorTransit.routes], service_dates: [],
        calendars: { ...priorTransit.calendars } };
    for (const [id, feed] of importFiles) {
        if (id === 'um-shuttle' && area !== 'um-campus') continue;
        const part = transitContext(await gtfsFiles(feed.path, PILOTS[area].bounds), feed.agency, area);
        transit.stops = [...transit.stops.filter(stop => stop.agency !== feed.agency), ...part.stops];
        transit.routes = [...transit.routes.filter(route => route.agency !== feed.agency), ...part.routes];
        for (const key of Object.keys(transit.calendars)) if (key.startsWith(`${feed.agency}:`)) delete transit.calendars[key];
        Object.assign(transit.calendars, part.calendars);
        const previous = sources.get(id);
        const previousCapture = previous?.sha256 === feed.sha256 ? previous : null;
        const archiveUrl = feed.archive_url ?? (feed.fetched_at ? null : previousCapture?.archive_url) ?? null;
        put(source(id, id === 'um-shuttle' ? 'UM campus shuttle GTFS' : `Prasarana GTFS · ${feed.agency}`,
            feed.url, feed.license, part.stops.length ? 'loaded' : 'partial', part.stops.length,
            `${archiveUrl ? 'Archived publisher feed. ' : ''}Scheduled service uses the published calendar. Stop points and boarding tags require local checks.`,
            { data_at: feed.data_at ?? previousCapture?.data_at ?? null, fetched_at: feed.fetched_at ?? previousCapture?.fetched_at ?? null,
                sha256: feed.sha256, archive_url: archiveUrl }));
    }
    transit.service_dates = [...new Set(Object.values(transit.calendars).filter(c => c.from).map(c => `${c.from}–${c.to}`))];
    transit.stops = connectTransitStops(transit.stops, [...bundle.walking.assets, ...entrances], bundle.graph.edges);
    const railStops = transit.stops.filter(stop => stop.agency === 'rapid-rail-kl');
    let demand = reference?.demand ?? bundle.context.demand;
    if (hasDemand) {
        const label = stop => `${stop.name} (${stop.id.split(':').at(-1)})`;
        const joinId = code => code.toUpperCase().replace(/^([A-Z]+)0+(?=\d)/, '$1');
        const names = new Map(railStops.map(stop => [joinId(stop.id.split(':').at(-1)), label(stop)]));
        const match = value => {
            if (typeof value !== 'string') return '';
            if (/^A0\s*:/i.test(value)) return value;
            const code = value.split(':')[0].trim();
            return names.get(joinId(code)) ?? railStops.find(stop => stop.name.toUpperCase() === value.trim().toUpperCase())?.name ?? '';
        };
        let latest = '', passage = [];
        for await (const row of csvFile(ridershipPath)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '') || row.date < latest) continue;
            const origin = match(row.origin), destination = match(row.destination);
            if ((!origin || /^A0\s*:/i.test(origin)) && (!destination || /^A0\s*:/i.test(destination))) continue;
            if (row.date > latest) { latest = row.date; passage = []; }
            passage.push({ ...row, origin, destination });
        }
        demand = railDemand(passage, railStops.flatMap(stop => [stop.name, label(stop)]));
        const metadata = await readOptional(resolve(directory, 'rapid-rail-od.source.json'));
        const archive_url = /^https:\/\//.test(metadata?.archive_url ?? '') ? metadata.archive_url : null;
        put(source('ridership', 'Rapid Rail daily station journeys', 'https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily',
            'CC BY 4.0', demand.stations.length ? 'loaded' : 'partial', demand.stations.length, demand.note,
            { data_at: demand.data_at, sha256: await fileDigest(ridershipPath), archive_url }));
    } else if (!sources.has('ridership')) put(source('ridership', 'Rapid Rail daily station journeys',
        'https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily', 'See dataset licence', 'not_loaded', 0,
        'Supply a published daily rail OD file. Counts are station demand rather than walking footfall.'));
    const wiki = await readOptional(resolve(directory, `${area}.wikidata.json`));
    const landmarks = [...new Map([...qids, ...(reference?.landmarks ?? bundle.context.landmarks),
        ...wikidataLandmarks(wiki, area)].map(landmark => [landmark.id, landmark])).values()];
    put(source('wikidata', 'Wikidata landmark links', 'https://www.wikidata.org/', 'CC0 structured data',
        'partial', landmarks.length, 'Linked entries include IDs tagged by OpenStreetMap. Additional names and descriptions require the Wikidata extract.'));
    const scenes = await readOptional(resolve(directory, `${area}.scenes.json`));
    const environment = { ...(reference?.environment ?? bundle.context.environment),
        ...(scenes ? { scenes: satelliteScenes(scenes, area) } : {}) };
    put(source('satellite', 'Sentinel-2 / ESA WorldCover', 'https://planetarycomputer.microsoft.com/dataset/esa-worldcover',
        'See dataset licence', environment.scenes.length ? 'partial' : 'not_loaded', environment.scenes.length,
        'Optional scene footprints and land cover for survey planning. Path shade uses detailed building and canopy geometry.'));
    const demographics = districtPopulation(population, area);
    sources.get('dosm').data_at = demographics.year;

    snapshots.push({ path, details: {
        area_id: area, dataset_id: bundle.context.dataset_id, entrances,
        context: { sources: [...sources.values()], transit, landmarks, demographics, demand, environment,
            walking_details: { paths, facilities, shade: shade.shade } },
    } });
    console.log(`${PILOTS[area].short_name}: ${Object.keys(paths).length} path details, ${Object.keys(facilities).length} facility details, ${transit.stops.length} timetable stops.`);
}
for (const { path, details } of snapshots) {
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(details) + '\n');
    await rename(`${path}.tmp`, path);
}
