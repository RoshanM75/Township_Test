import 'server-only';
import { getPool } from './postgres.ts';
import { RequestError, validateReportId } from './validation.ts';
import type { AssetKind, ObservationValue, PlaceCategory, VerificationRecord, VerificationTarget } from '../walking.ts';
import { PILOTS, type PilotId } from '../pilots.ts';
import { validateArea } from './pilots.ts';
import { observationFields } from '../verification-fields.ts';

const KINDS: AssetKind[] = ['destination', 'entrance', 'rest', 'shelter', 'toilet', 'water', 'transit'];
const CATEGORIES: PlaceCategory[] = ['healthcare', 'food', 'park', 'community', 'shopping', 'transport', 'other'];

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('An object is required.');
    return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = false): string {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new RequestError(`${label} must be text${required ? ' and cannot be empty' : ''} (maximum ${max} characters).`);
    return value.trim();
}
function attributes(value: unknown, target: VerificationTarget) {
    const input = object(value), output: Record<string, ObservationValue> = {};
    const fields = new Map(observationFields(target).map(field => [field.key, field]));
    for (const [field, v] of Object.entries(input)) {
        const spec = fields.get(field);
        if (!spec) throw new RequestError(`Unsupported observation: ${field}.`);
        if (spec.kind === 'boolean') {
            if (typeof v !== 'boolean') throw new RequestError(`${field} must be true or false.`);
        } else if (spec.kind === 'number') {
            const min = spec.percent ? 0 : spec.min ?? -Infinity;
            const max = spec.percent ? 1 : spec.max ?? Infinity;
            if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (field === 'surface_rating' && !Number.isInteger(v))) throw new RequestError(`${field} is out of range.`);
        } else if (spec.kind === 'choice') {
            if (typeof v !== 'string' || !spec.options?.includes(v)) throw new RequestError(`Choose a valid value for ${field}.`);
        } else if (field === 'opening_hours') text(v, 'Opening hours', 100);
        output[field] = v as ObservationValue;
    }
    return output;
}

export async function walkingData(area:PilotId='elmina') {
    const [assets, records] = await Promise.all([
        getPool().query(`SELECT a.id::text, a.external_id, a.parent_id::text, a.kind, a.category, a.name, a.lat, a.lng,
            a.source, a.source_ref, a.properties, a.edge_id::float8 AS edge_id, a.edge_fraction, a.connection_distance_m,
            ST_Y(ST_LineInterpolatePoint(e.geom, a.edge_fraction)) AS anchor_lat,
            ST_X(ST_LineInterpolatePoint(e.geom, a.edge_fraction)) AS anchor_lng
            FROM walking_assets a LEFT JOIN path_edges e ON e.id = a.edge_id WHERE a.area_id=$1 ORDER BY a.name, a.id`,[area]),
        getPool().query(`SELECT id::text, target_type, target_id::text, status, observed_at, valid_until, reviewer,
            method, source_ref, notes, attributes, created_at FROM verification_records WHERE area_id=$1 ORDER BY observed_at DESC, id DESC`,[area]),
    ]);
    const meta=await getPool().query('SELECT value FROM app_metadata WHERE key=$1',[`pilot:${area}:revision`]);
    if(area!=='elmina'&&!meta.rows[0])throw new RequestError(`The ${PILOTS[area].short_name} walking dataset has not been imported into this server yet.`,503);
    return { assets: assets.rows, verifications: records.rows, as_of: new Date().toISOString(),area_id:area,dataset_id:meta.rows[0]?.value??'elmina-original' };
}

export async function addAsset(body: unknown) {
    const input = object(body);
    const area=validateArea(input.area_id);
    const kind = String(input.kind) as AssetKind, category = String(input.category || 'other') as PlaceCategory;
    if (!KINDS.includes(kind) || !CATEGORIES.includes(category)) throw new RequestError('Choose a valid place type and category.');
    const name = text(input.name, 'Name', 120, true), sourceRef = text(input.source_ref, 'Source reference', 500);
    const lat = input.lat, lng = input.lng;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90 || typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) throw new RequestError('Valid coordinates are required.');
    const parent = input.parent_id == null || input.parent_id === '' ? null : validateReportId(String(input.parent_id));
    if (kind === 'entrance' && !parent) throw new RequestError('An entrance must belong to a destination or transit stop.');
    if (kind !== 'entrance' && parent) throw new RequestError('Only entrances can have a parent destination.');
    const properties = attributes(input.properties ?? {}, kind === 'entrance' ? 'entrance' : 'facility');
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        if (parent) {
            const p = await client.query("SELECT id FROM walking_assets WHERE id = $1 AND area_id=$2 AND kind IN ('destination','transit') FOR SHARE", [parent,area]);
            if (!p.rowCount) throw new RequestError('The parent destination was not found.', 404);
        }
        const nearest = await client.query(`SELECT id, ST_LineLocatePoint(geom, ST_SetSRID(ST_MakePoint($1,$2),4326)) AS fraction,
            ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS distance
            FROM path_edges WHERE pedestrian_access AND area_id=$3
            AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,30)
            ORDER BY distance LIMIT 1`, [lng, lat,area]);
        const anchor = nearest.rows[0];
        const result = await client.query(`INSERT INTO walking_assets(parent_id,kind,category,name,lat,lng,source,source_ref,properties,edge_id,edge_fraction,connection_distance_m,area_id)
            VALUES($1,$2,$3,$4,$5,$6,'community',$7,$8,$9,$10,$11,$12) RETURNING id::text`,
        [parent, kind, category, name, lat, lng, sourceRef, JSON.stringify(properties), anchor?.id ?? null, anchor?.fraction ?? null, anchor?.distance ?? null,area]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

export async function addVerification(body: unknown) {
    const input = object(body), target = String(input.target_type) as VerificationTarget;
    if (!['path', 'crossing', 'entrance', 'facility'].includes(target)) throw new RequestError('Choose a valid verification target.');
    const id = validateReportId(String(input.target_id));
    const claimedArea=input.area_id===undefined?null:validateArea(input.area_id);
    const status = String(input.status) as VerificationRecord['status'];
    if (!['verified', 'reported', 'unverified'].includes(status)) throw new RequestError('Choose a valid observation status.');
    const method = String(input.method) as VerificationRecord['method'];
    if (!['site_visit', 'photo_review', 'operator_record', 'osm_import'].includes(method)) throw new RequestError('Choose how the observation was made.');
    if (status === 'verified' && method === 'osm_import') throw new RequestError('An OSM import is mapped information, not an on-site verification.');
    const observed = Date.parse(String(input.observed_at)), until = input.valid_until ? Date.parse(String(input.valid_until)) : null;
    if (!Number.isFinite(observed) || observed > Date.now() + 300000) throw new RequestError('The observation time cannot be in the future.');
    if (until !== null && (!Number.isFinite(until) || until <= observed || until > observed + 366 * 86400000)) throw new RequestError('The review date must be after the observation and within one year.');
    if (status === 'verified' && until === null) throw new RequestError('Verified observations need a review date.');
    const reviewer = text(input.reviewer, 'Auditor or team', 80, true), reference = text(input.source_ref, 'Source reference', 500), notes = text(input.notes, 'Notes', 2000);
    const values = attributes(input.attributes, target);
    if (!Object.keys(values).length) throw new RequestError('Record at least one observed condition.');
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const entity = target === 'path' || target === 'crossing'
            ? await client.query('SELECT id,area_id FROM path_edges WHERE id=$1 AND is_crossing=$2 FOR SHARE', [id, target === 'crossing'])
            : await client.query(`SELECT id,area_id,connection_distance_m FROM walking_assets WHERE id=$1 AND ${target === 'entrance' ? "kind='entrance'" : "kind IN ('rest','shelter','toilet','water','transit')"} FOR SHARE`, [id]);
        if (!entity.rowCount) throw new RequestError('The verification target was not found.', 404);
        const area=entity.rows[0].area_id;
        if(claimedArea&&area!==claimedArea)throw new RequestError('The target belongs to another walking area.',404);
        if (typeof values.connection_length_m === 'number' && values.connection_length_m + .5 < Number(entity.rows[0].connection_distance_m ?? 0)) {
            throw new RequestError('A measured connection cannot be shorter than the straight-line distance to the path.');
        }
        const result = await client.query(`INSERT INTO verification_records(target_type,target_id,status,observed_at,valid_until,reviewer,method,source_ref,notes,attributes,area_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id::text`,
        [target, id, status, new Date(observed), until === null ? null : new Date(until), reviewer, method, reference, notes, JSON.stringify(values),area]);
        await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}
