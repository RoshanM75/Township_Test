import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { PILOTS } from '../lib/pilots.ts';
import { shadeObjects } from './pilot-shade.mjs';
import { buildCartography } from './map-cartography.mjs';
import { buildTerrain } from './map-terrain.mjs';

const output = new URL('../public/map-area/', import.meta.url);
const extracts = {
    'pasar-seni': ['data/pasar-seni/source/pasar-seni-osm.json.gz', 'data/pasar-seni/source/map-context.json.gz'],
    'um-campus': ['data/um-campus/source/um-campus-osm.json.gz', 'data/um-campus/source/map-context.json.gz'],
    elmina: ['precinct.json', 'data/elmina/source/elmina-map-osm.json.gz'],
};
await mkdir(output, { recursive: true });
async function readMapSource(source) {
    try {
        const file = await readFile(new URL(`../${source}`, import.meta.url));
        return JSON.parse(source.endsWith('.gz') ? gunzipSync(file) : file);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return null;
    }
}

for (const [area, sources] of Object.entries(extracts)) {
    const elements = new Map();
    for (const source of sources) {
        const map = await readMapSource(source);
        for (const element of map?.elements ?? []) elements.set(`${element.type}:${element.id}`, element);
    }
    const additionalPolygons = [];
    const additionalStreets = [];
    const supplementalBuildings = [];
    if (area === 'pasar-seni') {
        const extension = await readMapSource('data/pasar-seni/source/expanded-map-osm.json.gz');
        const streets = await readMapSource('data/pasar-seni/source/expanded-map-streets.geojson.gz');
        for (const element of extension?.elements ?? []) {
            const key = `${element.type}:${element.id}`;
            if (!elements.has(key)) elements.set(key, element);
        }
        additionalStreets.push(...streets?.features ?? []);
        const buildings = await readMapSource('data/pasar-seni/source/bukit-bintang-buildings.geojson.gz');
        for (const feature of buildings?.features ?? []) {
            const [type, id] = feature.id.split('/');
            const existing = elements.get(`${type}:${id}`);
            if (existing?.geometry?.length >= 4 && existing.tags?.building) {
                // Preserve the newer outline and use archived height tags where the current outline has none.
                if (!existing.tags.height && !existing.tags['building:levels']) {
                    const { height, 'building:levels': levels } = feature.properties;
                    if (height || levels) existing.tags = { height, 'building:levels': levels, ...existing.tags };
                }
                continue;
            }
            // Relations with usable geometry are rendered by the multipolygon importer.
            const hasRelationShape = existing?.type === 'relation' && existing.members?.some(member => member.geometry?.length);
            const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
            for (const [index, polygon] of polygons.entries()) {
                const element = { type: 'way', id: `${feature.id}:${index}`, tags: feature.properties,
                    geometry: polygon[0].map(([lon, lat]) => ({ lon, lat })) };
                if (!element.tags?.building) continue;
                if (!hasRelationShape) additionalPolygons.push({ element, geometry: { type: 'Polygon', coordinates: polygon } });
                // Courtyards remain open on the basemap. The shade model uses solid single-ring footprints.
                if (polygon.length === 1) supplementalBuildings.push(element);
            }
        }
    }
    const features = buildCartography([...elements.values()], additionalPolygons, additionalStreets);
    const terrain = await buildTerrain(area, output);
    if (terrain) features.push(...terrain.contours);
    await writeFile(new URL(`${area}.geojson`, output), JSON.stringify({ type: 'FeatureCollection', features }));
    const counts = features.reduce((counts, feature) => ({...counts,[feature.properties.kind]:(counts[feature.properties.kind]??0)+1}),{});
    console.log(`${area}: ${features.length} map features (${counts.building??0} buildings/parts, ${counts.path??0} paths, ${counts.label??0} place labels).`);
    const [lat, lng] = PILOTS[area].centre;
    const { objects } = shadeObjects([...elements.values(), ...supplementalBuildings], [lat, lng]);
    const nonGroundWays = [...elements.values()].filter(element => {
        const tags = element.tags ?? {};
        return element.type === 'way' && tags.highway && (Number(tags.layer) !== 0 && Number.isFinite(Number(tags.layer))
            || Number(tags.level) !== 0 && Number.isFinite(Number(tags.level)) || (tags.bridge && tags.bridge !== 'no')
            || (tags.tunnel && tags.tunnel !== 'no') || tags.indoor === 'yes');
    }).map(element => String(element.id));
    await writeFile(new URL(`${area}-shade.json`, output), JSON.stringify({ centre: [lng, lat], objects, non_ground_ways: nonGroundWays }));
}
