import { evidenceFor, malaysiaHour } from './verification.ts';
import { slotForHour, type PathEdge } from './routing.ts';
import type { SolarModel, ShadeReading } from './solar-shade.ts';
import type { JourneyStep, WalkingAsset, VerificationRecord } from './walking.ts';
import { pointAt, sliceLine, type LngLat } from './walking-geometry.ts';

export interface ShadeStretch extends ShadeReading {
    edge_id?: number;
    geometry: LngLat[];
}
export interface RouteShade {
    sun_s: number;
    unknown_s: number;
    daylight_s: number;
    sun_m: number;
    unknown_m: number;
    longest_sun_m: number;
    stretches: ShadeStretch[];
}

type ShadeProbe = (point: LngLat, at: number) => ShadeReading;
const unknown: ShadeReading = { condition: 'unknown', source: 'unknown' };

export function groupShadeChecks(records: VerificationRecord[]) {
    const grouped = new Map<string, VerificationRecord[]>();
    for (const record of records) {
        if (!Object.keys(record.attributes).some(key => key.startsWith('shade_') || key === 'covered' || key === 'sheltered')) continue;
        const key = `${record.target_type}:${record.target_id}`;
        const current = grouped.get(key);
        if (current) current.push(record);
        else grouped.set(key, [record]);
    }
    return grouped;
}

export function pathShade(edge: PathEdge, records: VerificationRecord[], at: number, point: LngLat, model: SolarModel): ShadeReading {
    const reading = model.atPoint(point, at);
    if (reading.condition === 'night') return reading;
    if (!records.length && edge.covered === true) return { condition: 'covered', source: 'mapped' };
    if (!records.length) return model.isGroundWay(edge.osm_way_id) ? reading : unknown;
    const time = new Date(at).toISOString();
    const target = edge.is_crossing ? 'crossing' : 'path', id = edge.source_edge_id ?? edge.id;
    const evidence = evidenceFor(records, target, id, time);
    const nearbyChecks = records.filter(record => {
        if (record.attributes.shade_observed === undefined) return false;
        const offset = Math.abs(at - Date.parse(record.observed_at)) % 86400000;
        return Math.min(offset, 86400000 - offset) <= 30 * 60000;
    });
    const timedCheck = evidenceFor(nearbyChecks, target, id, time).shade_observed;
    const roof = evidence.covered;
    if (roof?.status === 'verified' && roof.value === true) return { condition: 'covered', source: 'checked' };
    if (!roof && edge.covered === true) return { condition: 'covered', source: 'mapped' };
    const slot = slotForHour(malaysiaHour(time));
    const check = timedCheck?.status === 'verified' ? timedCheck : evidence[`shade_${slot}`];
    if (check?.status === 'verified' && (check.value === 0 || check.value === 1)) {
        return { condition: check.value === 1 ? 'shade' : 'sun', source: 'checked' };
    }
    return model.isGroundWay(edge.osm_way_id) ? reading : unknown;
}

export function spotShade(asset: WalkingAsset, at: string, records: VerificationRecord[], model?: SolarModel): ShadeReading {
    const light = model?.atPoint([asset.lng, asset.lat], Date.parse(at));
    if (light?.condition === 'night') return light;
    const evidence = evidenceFor(records, asset.kind === 'entrance' ? 'entrance' : 'facility', asset.id, at);
    const cover = evidence.sheltered ?? evidence.covered;
    if (cover?.status === 'verified' && cover.value === true) return { condition: 'covered', source: 'checked' };
    if (!cover && (asset.properties.sheltered === true || asset.properties.covered === true)) return { condition: 'covered', source: 'mapped' };
    const level = asset.properties.osm_level;
    return (typeof level === 'string' && level.trim() !== '' && Number(level) !== 0) ? unknown : light ?? unknown;
}

export function journeyShade(steps: JourneyStep[], departure: string, data: {
    edges: Map<number, PathEdge>;
    checks: ReturnType<typeof groupShadeChecks>;
    assets: WalkingAsset[];
    speed: number;
    model: SolarModel;
}): RouteShade {
    const profile: RouteShade = { sun_s: 0, unknown_s: 0, daylight_s: 0, sun_m: 0, unknown_m: 0, longest_sun_m: 0, stretches: [] };
    const departureAt = Date.parse(departure);
    let continuousSun = 0;

    function measure(line: LngLat[], length: number, duration: number, start: number, probe: ShadeProbe, edgeId?: number) {
        if (duration <= 0 || !line.length) return;
        const samples = Math.max(1, Math.min(120, Math.ceil(Math.max(length / 10, duration / 20))));
        const ds = duration / samples, dm = length / samples;
        for (let i = 0; i < samples; i++) {
            const reading = probe(pointAt(line, (i + .5) / samples), departureAt + 1000 * (start + (i + .5) * ds));
            if (reading.condition !== 'night') profile.daylight_s += ds;
            if (reading.condition === 'unknown') { profile.unknown_s += ds; profile.unknown_m += dm; }
            if (reading.condition === 'sun') {
                profile.sun_s += ds;
                profile.sun_m += dm;
                continuousSun += dm;
                profile.longest_sun_m = Math.max(profile.longest_sun_m, continuousSun);
            } else continuousSun = 0;
            if (!length || line.length < 2) continue;
            const geometry = sliceLine(line, i / samples, (i + 1) / samples);
            const last = profile.stretches.at(-1), end = last?.geometry.at(-1);
            if (last?.condition === reading.condition && last.source === reading.source && last.edge_id === edgeId &&
                end?.[0] === geometry[0][0] && end?.[1] === geometry[0][1]) last.geometry.push(...geometry.slice(1));
            else profile.stretches.push({ ...reading, edge_id: edgeId, geometry });
        }
    }

    for (const step of steps) {
        if (step.kind === 'turn') continue;
        const line = step.coordinates.map(([lat, lng]): LngLat => [lng, lat]);
        const start = step.start_min * 60, duration = (step.end_min - step.start_min) * 60;
        const edge = step.edge_id === undefined ? undefined : data.edges.get(step.edge_id);
        if (step.kind === 'rest' && line.length === 3) {
            const asset = data.assets.find(asset => asset.id === step.asset_id);
            const detour = Math.min(step.distance_m / (2 * data.speed), duration / 2);
            const checks = asset ? data.checks.get(`facility:${asset.id}`) ?? [] : [];
            measure(line.slice(0, 2), step.distance_m / 2, detour, start, data.model.atPoint);
            measure([line[1]], 0, duration - 2 * detour, start + detour,
                asset ? (_, at) => spotShade(asset, new Date(at).toISOString(), checks, data.model) : data.model.atPoint);
            measure(line.slice(1), step.distance_m / 2, detour, start + duration - detour, data.model.atPoint);
        } else {
            const wait = Math.min(step.wait_s ?? 0, duration);
            const checks = edge ? data.checks.get(`${edge.is_crossing ? 'crossing' : 'path'}:${edge.id}`) ?? [] : [];
            const probe = edge ? (point: LngLat, at: number) => pathShade(edge, checks, at, point, data.model) : data.model.atPoint;
            measure(line.slice(0, 1), 0, wait, start, probe);
            measure(line, step.distance_m, duration - wait, start + wait, probe, step.edge_id);
        }
    }
    return profile;
}
