import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const output = new URL('../public/map-area/', import.meta.url);
const extracts = {
    'pasar-seni': ['data/pasar-seni/source/pasar-seni-osm.json.gz', 'data/pasar-seni/source/map-context.json.gz'],
    'um-campus': ['data/um-campus/source/um-campus-osm.json.gz', 'data/um-campus/source/map-context.json.gz'],
    elmina: ['precinct.json', 'data/elmina/source/elmina-map-osm.json.gz'],
};
const metres = value => {
    const match = /^(\d+(?:\.\d+)?)\s*m?$/.exec(value ?? '');
    return match ? Number(match[1]) : null;
};
const footways = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'crossing']);
const majorRoads = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const localRoads = new Set(['residential', 'unclassified', 'living_street', 'service']);
const greens = new Set(['park', 'garden', 'pitch', 'grass', 'forest', 'wood', 'recreation_ground', 'grassland']);
const railways = new Set(['rail', 'light_rail', 'subway', 'tram', 'monorail']);
const civicPlaces = new Set(['university', 'library', 'hospital', 'community_centre', 'marketplace', 'place_of_worship', 'arts_centre', 'theatre']);
const attractions = new Set(['attraction', 'museum', 'gallery']);
const watercourses = new Set(['river', 'canal', 'stream']);

function nameOf(tags) {
    return (tags['name:en'] || tags.name || tags['name:ms'] || '').trim().replace(/\s+/g, ' ');
}

function geometryOf(way) {
    if (!way.geometry?.every(p => p && Number.isFinite(p.lon) && Number.isFinite(p.lat))) return [];
    return way.geometry.map(p => [p.lon, p.lat]);
}

function mapFeature(element, line) {
    if (line.length < 2) return null;
    const tags = element.tags ?? {};
    const name = nameOf(tags);
    const closed = line.length >= 4 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1];
    const feature = (kind, type, properties = {}) => ({
        type: 'Feature', properties: { kind, ...(name ? { name } : {}), ...properties },
        geometry: { type, coordinates: type === 'Polygon' ? [line] : line },
    });
    if (closed && tags.building && tags.building !== 'no') {
        const base = metres(tags.min_height) ?? 0;
        const levels = Number(tags['building:levels']);
        const height = metres(tags.height) ?? (Number.isFinite(levels) && levels > 0 ? 3 * levels : base + 7);
        const use = ['university', 'school', 'hospital', 'civic'].includes(tags.building) ? 'civic'
            : ['commercial', 'retail', 'office'].includes(tags.building) ? 'commercial' : 'other';
        if (height > base) return feature('building', 'Polygon', { height, base, use });
    }
    if (closed && (tags.natural === 'water' || tags.water)) return feature('water', 'Polygon');
    if (closed && [tags.leisure, tags.landuse, tags.natural].some(value => greens.has(value))) return feature('green', 'Polygon');
    if (watercourses.has(tags.waterway)) return feature('watercourse', 'LineString');
    if (railways.has(tags.railway) && !['yes', 'building_passage'].includes(tags.tunnel) && !(Number(tags.layer) < 0)) {
        return feature('rail', 'LineString');
    }
    const highway = tags.highway?.replace(/_link$/, '');
    if (majorRoads.has(highway)) return feature('street', 'LineString', { road: 'major' });
    if (localRoads.has(highway)) return feature('street', 'LineString', { road: 'local' });
    if (footways.has(highway)) return feature('path', 'LineString');
    return null;
}

function placeLabel(element, line, feature) {
    const tags = element.tags ?? {};
    const name = nameOf(tags);
    if (!name || name.length > 80 || [...name].some(character => character.codePointAt(0) > 65535)) return null;

    let kind;
    if (['station', 'halt'].includes(tags.railway) || tags.public_transport === 'station') kind = 'station';
    else if (civicPlaces.has(tags.amenity) || attractions.has(tags.tourism) || ['suburb', 'quarter', 'neighbourhood'].includes(tags.place)
        || tags.historic || (tags.bridge && tags.bridge !== 'no' && tags.highway)) kind = 'landmark';
    else if (feature?.properties.kind === 'green' || feature?.properties.kind === 'water') kind = feature.properties.kind;
    else if (feature?.properties.kind === 'building' && tags.building !== 'roof') kind = 'building';
    else return null;

    let location;
    if (Number.isFinite(element.lon) && Number.isFinite(element.lat)) {
        location = [element.lon, element.lat];
    } else if (Number.isFinite(element.center?.lon) && Number.isFinite(element.center?.lat)) {
        location = [element.center.lon, element.center.lat];
    } else if (line.length) {
        const longs = line.map(point => point[0]), lats = line.map(point => point[1]);
        location = [(Math.min(...longs) + Math.max(...longs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    }
    if (!location) return null;
    return { type: 'Feature', properties: { kind: 'label', labelKind: kind, name }, geometry: { type: 'Point', coordinates: location } };
}

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
    const features = [];
    if (area === 'pasar-seni') {
        const extension = await readMapSource('data/pasar-seni/source/expanded-map-osm.json.gz');
        const streets = await readMapSource('data/pasar-seni/source/expanded-map-streets.geojson.gz');
        for (const element of extension?.elements ?? []) {
            const key = `${element.type}:${element.id}`;
            if (!elements.has(key)) elements.set(key, element);
        }
        features.push(...streets?.features ?? []);
    }
    const names = new Set();
    for (const element of elements.values()) {
        const line = element.type === 'way' ? geometryOf(element) : [];
        const feature = mapFeature(element, line);
        if (feature) features.push(feature);
        const label = placeLabel(element, line, feature);
        if (label) {
            const [lng, lat] = label.geometry.coordinates;
            const key = `${label.properties.name.toLowerCase()}:${Math.round(lng * 1000)}:${Math.round(lat * 1000)}`;
            if (!names.has(key)) features.push(label);
            names.add(key);
        }
    }
    await writeFile(new URL(`${area}.geojson`, output), JSON.stringify({ type: 'FeatureCollection', features }));
}
