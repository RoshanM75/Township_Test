import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { KL_CORE_BOUNDS, PILOTS, pointInBounds, pointInPilot } from '../lib/pilots.ts';
import { mappedAssets, preparePilotGraph, representative } from '../lib/data/osm.ts';
import { transitContext } from '../lib/data/context.ts';
import { metres } from '../lib/walking-geometry.ts';
import { fileDigest, gtfsFiles } from './data-download.mjs';
import { loadPagesPilot, validatePilotSnapshot } from './pilot-export.mjs';
import { attachKLExpansion, klNeighbourhoods } from './pilot-kl-expansion.mjs';
import { mappedWayfinding } from './pilot-osm-details.mjs';
import { connectTransitStops } from './pilot-transit-links.mjs';

const { values } = parseArgs({ options: {
    'archive-dir': { type: 'string', default: '.local/sources/kl-expansion' },
    'transit-dir': { type: 'string', default: '.local/sources/walking-details' },
    'osm-file': { type: 'string' },
    'osm-url': { type: 'string' },
} });
const area = 'pasar-seni';
const { bounds } = PILOTS[area];
const nodeOffset = 100_000_000_000_000;
const folder = fileURLToPath(new URL('../data/pasar-seni/', import.meta.url));
const osmKey = element => `${element.type}/${element.id}`;
const osmUrl = 'https://www.openstreetmap.org/';
const mapAssets = 'https://github.com/spacingouty09/map-assets/blob/7cf245e3f3bf65c5391545c7474bf1a8831eba41/';
const bukitBintangArchive = 'https://github.com/Nitteswaran/shadesmart/blob/3454680e5181f37b932616e01e5b61d19e702ebe/data/osm/kl/';
const streets = 'https://github.com/tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025/blob/73ad6ffdbeb0feb74cace66788788ea049389be5/';
const healthcare = 'https://github.com/jerrychong25/malaysia-map-data/blob/c66d725428def71bbcab69f9cb53a6c4b531fe23/';
const placeArchive = 'https://github.com/sirhafizho/wheelcheck/blob/8e3fcefc3b5d9b9631797f248eb6198cbc3cd88d/data/places-seed.sql.gz';
const archive = path => join(values['archive-dir'], path);
const archiveData = (url, name, id) => ({ id, name, url, license: 'ODbL', status: 'loaded', fetched_at: null, data_at: null });

async function readJson(path) {
    const file = await readFile(path);
    return JSON.parse(path.endsWith('.gz') ? gunzipSync(file) : file);
}

async function readOsm(path, source, note) {
    const raw = await readJson(path);
    assert.ok(Array.isArray(raw.elements), 'An OpenStreetMap source must provide Overpass geometry.');
    return { raw, source: { ...source, note, data_at: raw.osm3s?.timestamp_osm_base ?? null, sha256: await fileDigest(path), records: 0 } };
}

function overlaps(line) {
    if (!line.length) return false;
    const [south, west, north, east] = bounds;
    return line.some(([lat]) => lat >= south) && line.some(([lat]) => lat <= north) &&
        line.some(([, lng]) => lng >= west) && line.some(([, lng]) => lng <= east);
}

function inExtent(element) {
    const shape = element.geometry ?? element.members?.flatMap(member => member.geometry ?? []);
    if (shape?.length) return overlaps(shape.filter(Boolean).map(p => [p.lat, p.lon]));
    const point = representative(element);
    return point && pointInPilot(point, area);
}

function healthcareElements(file) {
    return file.features.flatMap(feature => {
        const match = /^(node|way|relation)\/(\d+)$/.exec(feature.id ?? feature.properties['@id'] ?? '');
        if (!match || !feature.properties.name) return [];
        const [type, coordinates] = [feature.geometry.type, feature.geometry.coordinates];
        const lines = (type === 'Polygon' ? [coordinates[0]] : type === 'MultiPolygon' ? coordinates.map(polygon => polygon[0]) : []);
        const tags = Object.fromEntries(Object.entries(feature.properties).filter(([key, value]) =>
            key !== '@id' && typeof value === 'string'));
        const record = { type: match[1], id: Number(match[2]), tags };
        if (type === 'Point') return [{ ...record, lat: coordinates[1], lon: coordinates[0] }];
        if (lines.length) return [{ ...record, geometry: lines[0].map(([lon, lat]) => ({ lat, lon })) }];
        return [];
    });
}

async function archivedPuduPlaces(path) {
    const tagsByCategory = {
        HOSPITAL: { healthcare: 'yes' }, MALL: { shop: 'yes' }, RESTAURANT: { amenity: 'restaurant' },
        MOSQUE: { amenity: 'place_of_worship' }, HOTEL: { tourism: 'hotel' }, PARK: { leisure: 'park' },
    };
    const elements = [];
    const archive = createReadStream(path);
    const lines = createInterface({ input: archive.pipe(createGunzip()), crlfDelay: Infinity });
    let columns;
    try {
        for await (const line of lines) {
            if (!columns) {
                columns = /^COPY public\.places \(([^)]+)\) FROM stdin;$/.exec(line)?.[1].split(', ');
                continue;
            }
            if (line === '\\.') break;
            const cells = line.split('\t');
            const value = name => cells[columns.indexOf(name)];
            const osm = /^osm:(node|way|relation):(\d+)$/.exec(value('osm_id'));
            const category = tagsByCategory[value('category')];
            const location = value('location');
            const name = value('name');
            if (!osm || value('data_source') !== 'OSM' || !category || !name || name === '\\N' ||
                !/^0101000020E6100000[\da-f]{32}$/i.test(location)) continue;
            const point = Buffer.from(location, 'hex');
            const lon = point.readDoubleLE(9), lat = point.readDoubleLE(17);
            if (!pointInBounds([lat, lon], [3.128, 101.708, 3.142, 101.720])) continue;
            const wheelchair = value('osm_wheelchair_tag');
            elements.push({ type: osm[1], id: Number(osm[2]),
                ...(osm[1] === 'node' ? { lat, lon } : { center: { lat, lon } }),
                tags: { ...category, name, ...(['yes', 'no', 'limited'].includes(wheelchair) ? { wheelchair } : {}) } });
        }
    } finally {
        archive.destroy();
        lines.close();
    }
    assert.ok(columns && elements.length, 'The Pudu archive needs geocoded places derived from OpenStreetMap.');
    return elements;
}

function streetFeatures(roads, current) {
    const mappedIds = new Set(current.filter(element => element.type === 'way' && element.tags?.highway)
        .map(element => String(element.id)));
    const seen = new Set();
    const major = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
    return roads.features.flatMap(feature => {
        const { osmid, highway_main: highway, tunnel, name, u, v } = feature.properties;
        const ids = String(osmid ?? '').match(/\d+/g) ?? [];
        const coordinates = feature.geometry.coordinates;
        if (feature.geometry.type !== 'LineString' || !highway || (tunnel && tunnel !== 'no') ||
            !ids.length || ids.some(id => mappedIds.has(id)) || !overlaps(coordinates.map(([x, y]) => [y, x]))) return [];
        const key = `${Math.min(u, v)}:${Math.max(u, v)}:${ids.sort().join(',')}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const label = typeof name === 'string' ? name : Array.isArray(name) ? name.find(value => typeof value === 'string') : '';
        return [{ type: 'Feature', geometry: feature.geometry,
            properties: { kind: 'street', road: major.includes(highway.replace(/_link$/, '')) ? 'major' : 'local',
                ...(label ? { name: label.startsWith('[') ? label.match(/['"]([^'"]+)['"]/)?.[1] ?? '' : label } : {}) } }];
    });
}

async function newGraph(bundle, extraWays, core, work) {
    const input = join(work, 'osm.json');
    const output = join(work, 'graph.json');
    const originalWays = new Set(bundle.graph.edges.map(edge => edge.osm_way_id));
    const additions = extraWays.filter(way => !originalWays.has(way.id) && way.geometry?.every(Boolean) &&
        !way.tags['foot:conditional'] && !way.tags['access:conditional']);
    const ids = new Set(additions.map(way => way.id));
    const raw = { elements: [...core.filter(e => e.type === 'way' && originalWays.has(e.id)), ...additions] };
    await writeFile(input, JSON.stringify(raw));
    execFileSync(process.execPath, ['scripts/osm-to-graph.mjs', '--in', input, '--out-json', output], { stdio: 'inherit' });
    const parsed = await readJson(output);
    const prepared = preparePilotGraph(parsed, raw, area);
    const baseNodes = new Map(bundle.graph.nodes.map(node => [node.id, node]));
    const sourceNodes = new Map(parsed.nodes.map(node => [node.id, node]));
    const nodes = new Map();
    function appendNode(id) {
        const node = sourceNodes.get(id);
        const existing = baseNodes.get(id);
        if (existing && metres([existing.lng, existing.lat], [node.lng, node.lat]) <= 2) return existing;
        const newId = nodeOffset + id;
        if (!nodes.has(newId)) nodes.set(newId, { ...node, id: newId });
        return nodes.get(newId);
    }
    const edges = prepared.edges.filter(edge => ids.has(edge.osm_way_id)).map(edge => {
        const from = appendNode(edge.from_node);
        const to = appendNode(edge.to_node);
        const geometry = [[from.lng, from.lat], ...edge.geometry.slice(1, -1), [to.lng, to.lat]];
        const length_m = geometry.slice(1).reduce((sum, point, index) => sum + metres(geometry[index], point), 0);
        return { ...edge, from_node: from.id, to_node: to.id, geometry, length_m };
    }).filter(edge => edge.length_m > 0);
    const attached = new Set(edges.flatMap(edge => [edge.from_node, edge.to_node]));
    return { nodes: [...nodes.values()].filter(node => attached.has(node.id)), edges };
}

async function transitForExpansion(bundle, assets, edges) {
    const transit = { stops: [], routes: [], service_dates: [], calendars: {} };
    const sources = [];
    for (const [key, agency] of [['rail', 'rapid-rail-kl'], ['bus', 'rapid-bus-kl'], ['feeder', 'rapid-bus-mrtfeeder']]) {
        const path = join(values['transit-dir'], `${key}.zip`);
        const source = bundle.context.sources.find(item => item.id === `gtfs-${key}`);
        assert.equal(await fileDigest(path), source?.sha256, `The ${key} archive must match the existing published snapshot.`);
        const part = transitContext(await gtfsFiles(path, bounds), agency, area);
        transit.stops.push(...connectTransitStops(part.stops, assets, edges));
        transit.routes.push(...part.routes);
        transit.service_dates.push(...part.service_dates);
        Object.assign(transit.calendars, part.calendars);
        sources.push({ ...source, records: part.stops.length });
    }
    return { transit, sources };
}

function anchorsFromSources(all, transit) {
    const osmAnchor = (id, name, key, point) => {
        const element = all.get(key);
        assert.ok(element, `Missing neighbourhood map reference: ${key}.`);
        return { id, name, coordinates: point ?? representative(element), source_ref: osmUrl + key };
    };
    const bukitBintang = transit.stops.find(stop => stop.agency === 'rapid-rail-kl' && /bukit bintang/i.test(stop.name)
        && stop.routes.some(route => route.endsWith(':MRT') || route.includes('kajang')))
        ?? transit.stops.find(stop => stop.agency === 'rapid-rail-kl' && /bukit bintang/i.test(stop.name));
    assert.ok(bukitBintang, 'Expanded Prasarana calendar is missing Bukit Bintang.');
    return [
        osmAnchor('bangsar', 'Bangsar', 'way/25385811'),
        osmAnchor('brickfields', 'Brickfields', 'node/5470951521'),
        osmAnchor('perdana', 'Perdana Botanical Gardens', 'way/111547419'),
        osmAnchor('pudu', 'Pudu', 'node/2575356400'),
        { id: 'bukit-bintang', name: 'Bukit Bintang', coordinates: [bukitBintang.lat, bukitBintang.lng],
            source_ref: 'https://developer.data.gov.my/realtime-api/gtfs-static.en' },
    ];
}

const temporary = await mkdtemp(join(tmpdir(), 'township-kl-expansion-'));
try {
    const bundle = await loadPagesPilot(join(folder, 'bundle.json'), area, { includeExpansion: false });
    const core = await readJson(join(folder, 'source/pasar-seni-osm.json.gz'));
    const context = await readJson(join(folder, 'source/map-context.json.gz'));
    const um = {
        path: join(folder, '../um-campus/source/um-campus-osm.json.gz'),
        url: 'https://github.com/RoshanM75/Township_Test/blob/6972bc49e7bf6db5ed616ce9780bb1e45d5e8e08/data/um-campus/source/um-campus-osm.json.gz',
    };
    const input = [
        await readOsm(um.path, archiveData(um.url, 'OpenStreetMap · western KL overlap', 'kl-osm-west'),
            'Bangsar and adjacent mapped places and pedestrian ways from the UM source archive.'),
    ];
    for (const [key, label] of [['areas/kl-sentral', 'KL Sentral and Brickfields'], ['areas/klec-midvalley', 'KL Eco City and Mid Valley'],
        ['areas/klcc', 'KLCC and eastern walking links'], ['regions/klang-valley', 'Klang Valley rail and waterways']]) {
        const path = `${key}/raw/overpass.json`;
        input.push(await readOsm(archive(`map-assets/${path}`), archiveData(mapAssets + path,
            `OpenStreetMap · ${label}`, `kl-osm-${key.split('/')[1]}`),
        'Clipped source archive. Paths and access tags are dated map observations.'));
    }
    for (const [file, label, id] of [['raw.json', 'Bukit Bintang streets and footpaths', 'kl-osm-bintang'],
        ['pois.json', 'Bukit Bintang local places', 'kl-osm-bintang-places']]) {
        input.push(await readOsm(archive(`shadesmart/data/osm/kl/${file}`), archiveData(bukitBintangArchive + file,
            `OpenStreetMap · ${label}`, id), 'Source Overpass records from the Bukit Bintang and KLCC area.'));
    }
    if (values['osm-file']) {
        assert.ok(values['osm-url'] && new URL(values['osm-url']).protocol === 'https:', 'Supply the published URL of the new OSM extract.');
        input.unshift(await readOsm(values['osm-file'], archiveData(values['osm-url'], 'OpenStreetMap · central KL extension', 'kl-osm-extended'),
            'Additional OpenStreetMap topology for central Kuala Lumpur.'));
    }
    for (const kind of ['clinic', 'dentist', 'hospital']) {
        const path = `healthcare/kuala_lumpur_${kind}.geojson`;
        const file = archive(`facilities/${path}`);
        const elements = healthcareElements(await readJson(file));
        input.push({ raw: { elements }, source: { ...archiveData(healthcare + path, `OpenStreetMap · KL ${kind} directory`, `kl-health-${kind}`),
            data_at: null, sha256: await fileDigest(file), records: 0, note: 'May 2024 archive. Current service, hours and access require checking.' } });
    }
    const placeFile = archive('wheelcheck/data/places-seed.sql.gz');
    input.push({
        raw: { elements: await archivedPuduPlaces(placeFile) },
        source: { ...archiveData(placeArchive, 'OpenStreetMap · Pudu local places', 'kl-osm-pudu-places'),
            sha256: await fileDigest(placeFile), records: 0,
            note: 'OpenStreetMap venue records from the WheelCheck archive. Imports coordinates, names, place categories and mapped wheelchair tags.' },
    });
    const all = new Map([...context.elements, ...core.elements].map(element => [osmKey(element), element]));
    const metadata = new Map();
    const added = [];
    const ways = [];
    for (const { raw, source } of input) {
        for (const element of raw.elements) {
            const key = osmKey(element);
            if (all.has(key) || !inExtent(element)) continue;
            const { type, id, lat, lon, geometry, nodes, tags, center, members } = element;
            const record = { type, id, lat, lon, geometry, nodes, tags, center, members };
            all.set(key, record);
            added.push(record);
            metadata.set(key, source);
            source.records++;
            if (type === 'way' && tags?.highway && nodes && geometry &&
                !geometry.filter(Boolean).every(p => pointInBounds([p.lat, p.lon], KL_CORE_BOUNDS))) ways.push(record);
        }
    }
    const graph = await newGraph(bundle, ways, core.elements, temporary);
    const edges = [...bundle.graph.edges, ...graph.edges];
    const knownAssets = new Set(bundle.walking.assets.map(asset => asset.id));
    const mappedEntrances = new Set(bundle.walking.assets.filter(asset => asset.kind === 'entrance'
        && asset.properties.connection_model === 'mapped_entrance').map(asset => asset.parent_id));
    const raw = { elements: [...all.values()] };
    const assets = mappedAssets(raw, edges, area, bounds).filter(asset => !knownAssets.has(asset.id)
        && !(asset.properties.connection_model === 'approximate_approach' && mappedEntrances.has(asset.parent_id)))
        .map(asset => {
            const source = metadata.get(asset.source_ref.slice(osmUrl.length));
            return source ? { ...asset, properties: { ...asset.properties, map_archive: source.url,
                ...(source.data_at ? { map_snapshot: source.data_at } : {}) } } : asset;
        }).sort((a, b) => Number(a.parent_id !== null) - Number(b.parent_id !== null));
    const allGraph = { nodes: [...bundle.graph.nodes, ...graph.nodes], edges };
    const allAssets = [...bundle.walking.assets, ...assets];
    const details = mappedWayfinding({ area_id: area, graph: { ...graph, edges: graph.edges.map(edge => ({
        ...edge, from_node: edge.from_node % nodeOffset, to_node: edge.to_node % nodeOffset,
    })) }, walking: { assets } }, raw);
    const { transit, sources } = await transitForExpansion(bundle, allAssets, edges);
    const anchors = anchorsFromSources(all, transit);
    const roadPath = '03_osm_network/road_edges/Kuala_Lumpur_osm_drive_edges.geojson';
    const roadFile = archive(`streets/${roadPath}`);
    const roads = streetFeatures(await readJson(roadFile), [...all.values()]);
    sources.push(...input.map(item => item.source).filter(source => source.records), {
        ...archiveData(streets + roadPath, 'OpenStreetMap · Kuala Lumpur street basemap', 'kl-street-basemap'),
        sha256: await fileDigest(roadFile), records: roads.length, note: 'Street centrelines for map display. Routing uses the mapped pedestrian network.',
    });
    const expansion = { base_dataset_id: bundle.context.dataset_id, graph, assets, paths: details.paths,
        facilities: details.facilities, landmarks: details.qids, sources, transit,
        neighbourhoods: klNeighbourhoods(anchors, allGraph, bundle.context.origin.coordinates) };
    validatePilotSnapshot(attachKLExpansion(bundle, expansion));
    for (const [name, object] of Object.entries({
        'expansion.json.gz': expansion,
        'source/expanded-map-osm.json.gz': { elements: added },
        'source/expanded-map-streets.geojson.gz': { type: 'FeatureCollection', features: roads },
    })) {
        await writeFile(join(folder, name), gzipSync(JSON.stringify(object), { level: 9 }));
    }
    console.log(`Expanded KL: ${graph.edges.length} additional paths, ${assets.length} added places and entrances, ${transit.stops.length} transit stops.`);
    console.table(expansion.neighbourhoods.map(n => ({ neighbourhood: n.name, paths: n.local_paths, start: !!n.start, core: n.connected_to_core })));
} finally {
    await rm(temporary, { recursive: true, force: true });
}
