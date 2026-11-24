import { metres, pointAt } from '../lib/walking-geometry.ts';
import { lineGeometry } from '../lib/data/osm.ts';
import { sunVector } from '../lib/solar-shade.ts';

const radians = Math.PI / 180;
const GRID = 40;
const HOURS = { morning: 9, midday: 12, afternoon: 16 };

function metric(value, min, max) {
    if (typeof value !== 'number' && !/^\d+(?:\.\d+)?\s*m?$/.test(String(value ?? '').trim())) return null;
    const number = Number(String(value).replace(/m\s*$/, '').trim());
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function projectAt([lat, lng]) {
    const scaleX = 111320 * Math.cos(lat * radians);
    return ([x, y]) => [(x - lng) * scaleX, (y - lat) * 110574];
}

function inside([x, y], polygon) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [a, b] = polygon[i], [c, d] = polygon[j];
        if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit;
    }
    return hit;
}

function shadowIndex(objects, sun) {
    const index = new Map();
    if (sun[2] <= 0.12) return index;
    for (const { polygon, height, base = 0 } of objects) {
        const translated = metresUp => polygon.map(([x, y]) => [
            x - metresUp * sun[0] / sun[2], y - metresUp * sun[1] / sun[2],
        ]);
        const lower = translated(base), upper = translated(height);
        const polygons = [lower, upper, ...polygon.map((_, i) => {
            const next = (i + 1) % polygon.length;
            return [lower[i], lower[next], upper[next], upper[i]];
        })];
        const all = [...lower, ...upper], xs = all.map(p => p[0]), ys = all.map(p => p[1]);
        const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        const shape = { polygons, bounds };
        for (let x = Math.floor(bounds[0] / GRID); x <= Math.floor(bounds[2] / GRID); x++) {
            for (let y = Math.floor(bounds[1] / GRID); y <= Math.floor(bounds[3] / GRID); y++) {
                const key = `${x}:${y}`;
                if (!index.has(key)) index.set(key, []);
                index.get(key).push(shape);
            }
        }
    }
    return index;
}

function inShadow(index, point) {
    const [x, y] = point;
    return (index.get(`${Math.floor(x / GRID)}:${Math.floor(y / GRID)}`) ?? []).some(({ polygons, bounds }) =>
        x >= bounds[0] && y >= bounds[1] && x <= bounds[2] && y <= bounds[3] && polygons.some(p => inside(point, p)));
}

export function shadeObjects(elements, centre, survey = null) {
    const objects = [];
    let buildings = 0, crowns = 0;
    for (const element of elements) {
        const tags = element.tags ?? {};
        if (element.type === 'way' && tags.building && !['roof', 'no'].includes(tags.building) && !tags.min_height && !tags['building:min_level']) {
            const height = metric(tags.height, 1, 700) ?? (metric(tags['building:levels'], 1, 150) ?? 0) * 3;
            const line = lineGeometry(element);
            if (height && line.length >= 4 && line.length <= 1500 && line.every(p => p.every(Number.isFinite))
                && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1]) {
                objects.push({ ring: line.slice(0, -1), height, base: 0 });
                buildings++;
            }
        } else if (element.type === 'node' && tags.natural === 'tree') {
            const height = metric(tags.height, 1, 80), diameter = metric(tags.diameter_crown, .5, 60);
            if (!height || !diameter || !Number.isFinite(element.lon) || !Number.isFinite(element.lat)) continue;
            const longitudeScale = 111320 * Math.cos(element.lat * radians);
            const ring = Array.from({ length: 16 }, (_, i) => [
                element.lon + diameter / (2 * longitudeScale) * Math.cos(i * Math.PI / 8),
                element.lat + diameter / (2 * 110574) * Math.sin(i * Math.PI / 8),
            ]);
            objects.push({ ring, height, base: height });
            crowns++;
        }
    }
    for (const feature of survey?.features ?? []) {
        const roof = feature.properties?.kind === 'building';
        const height = metric(feature.properties?.height_m, 1, roof ? 700 : 80);
        const ring = feature.geometry?.coordinates?.[0];
        if (!height || !['canopy', 'building'].includes(feature.properties?.kind) ||
            feature.geometry?.type !== 'Polygon' || feature.geometry.coordinates.length !== 1 ||
            !Array.isArray(ring) || ring.length < 4 || ring.length > 1500 ||
            !ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) &&
                Math.abs(p[1] - centre[0]) < .08 && Math.abs(p[0] - centre[1]) < .08) ||
            ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
            throw new Error('Expected local closed WGS84 building or canopy polygons with height_m.');
        }
        objects.push({ ring: ring.slice(0, -1), height, base: roof ? 0 : height });
        if (roof) buildings++;
        else crowns++;
    }

    return { objects, buildings, crowns };
}

export function modelPilotShade(edges, elements, centre, modelDate, survey = null) {
    const project = projectAt(centre);
    const { objects, buildings, crowns } = shadeObjects(elements, centre, survey);
    const shapes = objects.map(({ ring, ...object }) => ({ ...object, polygon: ring.map(project) }));
    const paths = {};
    for (const [slot, hour] of Object.entries(HOURS)) {
        const index = shadowIndex(shapes, sunVector(modelDate, hour, [centre[1], centre[0]]));
        for (const edge of edges) {
            if (edge.covered || Number(edge.layer) < 0 || Number(edge.level) < 0 ||
                (edge.bridge && edge.bridge !== 'no') || (edge.tunnel && edge.tunnel !== 'no')) continue;
            const length = edge.geometry.slice(1).reduce((n, p, i) => n + metres(edge.geometry[i], p), 0);
            const samples = Math.max(1, Math.min(100, Math.ceil(length / 5)));
            let inShade = 0;
            for (let i = 0; i < samples; i++) {
                if (inShadow(index, project(pointAt(edge.geometry, (i + .5) / samples)))) inShade++;
            }
            if (!inShade) continue; // Missing height or canopy data cannot establish full sun.
            paths[edge.id] ??= { shade_source: 'modelled' };
            paths[edge.id][`shade_${slot}`] = Math.round(100 * inShade / samples) / 100;
        }
    }
    return { paths, shade: { model_date: modelDate, buildings, crowns } };
}
