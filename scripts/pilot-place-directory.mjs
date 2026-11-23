import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { sourceId } from '../lib/data/osm.ts';
import { pointInPilot } from '../lib/pilots.ts';
import { openingAt } from '../lib/verification.ts';
import { projectPoint } from '../lib/walking-geometry.ts';

const OSM = 'https://www.openstreetmap.org/';

/** Join published visitor facts to existing OSM identities. Access checks remain independent. */
export async function attachLocalDirectory(bundle, directory, folder) {
    const area = bundle.area_id;
    if (directory.dataset_id !== bundle.context.dataset_id) {
        console.warn(`${area}: skipping place directory for a different map revision.`);
        return bundle;
    }
    assert.match(directory.reviewed_on, /^\d{4}-\d{2}-\d{2}$/);
    const supplements = [], properties = {};
    const sources = new Map();
    for (const record of directory.records) {
        assert.match(record.osm, /^(node|way|relation)\/\d+$/);
        assert.equal(new URL(record.url).protocol, 'https:', 'Use an attributed public source.');
        assert.ok(record.publisher?.length && record.name?.length, 'Directory entries need a name and source.');
        if (record.hours) assert.notEqual(openingAt(record.hours, directory.reviewed_on + 'T12:00:00Z'), null);
        let place = bundle.walking.assets.find(asset => asset.source_ref === OSM + record.osm && asset.kind !== 'entrance');
        if (record.park_gates) {
            const raw = JSON.parse(gunzipSync(await readFile(resolve(folder, 'source', `${area}-osm.json.gz`))));
            const added = parkAccessPoints(bundle, raw.elements, record, place);
            place = added.place;
            supplements.push(...added.assets);
        }
        assert.ok(place, `Could not match directory entry ${record.name} to the archived map.`);
        properties[place.id] = {
            official_name: record.name, official_source: record.url, official_publisher: record.publisher,
            official_reviewed_on: directory.reviewed_on,
            ...(record.address ? { official_address: record.address } : {}),
            ...(record.phone ? { official_phone: record.phone } : {}),
            ...(record.hours ? { official_hours: record.hours } : {}),
            ...(record.closed_holidays ? { official_closed_holidays: true } : {}),
            ...(record.visit_note ? { official_visit_note: record.visit_note } : {}),
        };
        const source = sources.get(record.url);
        if (source) source.records++;
        else sources.set(record.url, { id: `place-directory-${sources.size + 1}`, name: record.publisher,
            url: record.url, license: 'Published factual listings with attribution', status: 'partial',
            fetched_at: directory.reviewed_on, data_at: null, records: 1,
            note: 'Selected records matched to the pilot map. Published hours and contacts do not establish accessible entry or current path conditions.' });
    }
    const assets = [...bundle.walking.assets, ...supplements].map(asset => properties[asset.id]
        ? { ...asset, properties: { ...asset.properties, ...properties[asset.id] } } : asset);
    const merged = supplements.map(asset => assets.find(item => item.id === asset.id));
    const coverage = { ...bundle.context.coverage,
        destinations: bundle.context.coverage.destinations + supplements.filter(asset => asset.kind === 'destination').length,
        entrances: bundle.context.coverage.entrances + supplements.filter(asset => asset.kind === 'entrance').length,
        unconnected_places: bundle.context.coverage.unconnected_places +
            supplements.filter(asset => asset.kind === 'entrance' && asset.edge_id === null).length,
    };
    return { ...bundle, walking: { ...bundle.walking, assets }, directory_properties: properties,
        supplemental_assets: [...bundle.supplemental_assets ?? [], ...merged],
        context: { ...bundle.context, coverage, sources: [...bundle.context.sources, ...sources.values()] } };
}

function parkAccessPoints(bundle, elements, record, existing) {
    const area = bundle.area_id;
    const park = elements.find(item => `${item.type}/${item.id}` === record.osm);
    assert.equal(park?.tags?.leisure, 'park');
    const gateNodes = record.park_gates.map(id => {
        const gate = elements.find(item => item.type === 'node' && item.id === id);
        assert.ok(gate?.tags?.entrance && !['no', 'private'].includes(gate.tags.access)
            && pointInPilot([gate.lat, gate.lon], area), 'A recorded gate must be on the archived public map.');
        return gate;
    });
    const first = gateNodes[0];
    const key = `osm:${park.type}:${park.id}`;
    const place = existing ?? {
        id: sourceId(area, key), external_id: `${area}:${key}`, parent_id: null,
        kind: 'destination', category: 'park', name: park.tags['name:en'] ?? park.tags.name,
        lat: first.lat, lng: first.lon, source: 'osm', source_ref: OSM + record.osm,
        properties: { osm_name: park.tags.name, osm_type: park.type, osm_id: String(park.id) },
        edge_id: null, edge_fraction: null, connection_distance_m: null, anchor_lat: null, anchor_lng: null,
    };
    const known = new Set(bundle.walking.assets.map(asset => asset.id));
    const paths = new Map(elements.filter(item => item.type === 'way').map(item => [String(item.id), item]));
    const gates = gateNodes.map(gate => {
        const edge = bundle.graph.edges.find(edge => (edge.from_node === gate.id || edge.to_node === gate.id ||
            paths.get(String(edge.osm_way_id))?.nodes?.includes(gate.id)) &&
            projectPoint(edge.geometry, [gate.lon, gate.lat]).distance < 0.5);
        const anchor = edge ? projectPoint(edge.geometry, [gate.lon, gate.lat]) : null;
        const key = `osm:${park.type}:${park.id}:door:${gate.id}`;
        return {
            id: sourceId(area, key), external_id: `${area}:${key}`, parent_id: place.id,
            kind: 'entrance', category: 'park', name: gate.tags['name:en'] ?? gate.tags.name,
            lat: gate.lat, lng: gate.lon, source: 'osm', source_ref: OSM + `node/${gate.id}`,
            properties: { connection_model: 'mapped_entrance' }, edge_id: edge?.id ?? null,
            edge_fraction: anchor?.fraction ?? null, connection_distance_m: anchor?.distance ?? null,
            anchor_lat: anchor?.point[1] ?? null, anchor_lng: anchor?.point[0] ?? null,
        };
    }).filter(item => !known.has(item.id));
    return { place, assets: [...existing ? [] : [place], ...gates] };
}
