import 'server-only';
import { getPool } from './postgres.ts';
import { RequestError, type NewReport } from './validation.ts';
import { estimateDefectCost } from '../scoring.ts';
import type { HazardKind } from '../routing.ts';
import type { PilotId } from '../pilots.ts';
import { pilotContext } from './pilots.ts';

const PROBLEMS: Record<HazardKind, { category: string; severity: 'blocker' | 'comfort'; label: string }> = {
    blocked: { category: 'Access Barrier', severity: 'blocker', label: 'Path is blocked' },
    no_ramp: { category: 'Universal Design', severity: 'blocker', label: 'No ramp at the kerb' },
    light_out: { category: 'Safety Electrical', severity: 'comfort', label: 'Streetlight is not working' },
    no_shade: { category: 'Shade Infrastructure', severity: 'comfort', label: 'No shade here' },
    broken_surface: { category: 'Pavement Renewal', severity: 'comfort', label: 'Pavement is broken' },
    lift_out: { category: 'Access Barrier', severity: 'blocker', label: 'Lift is out of service' },
    details_outdated: { category: 'Place information', severity: 'comfort', label: 'Place details need updating' },
};

export async function readGraph(area: PilotId = 'elmina') {
    const pool = getPool();
    const [nodes, edges] = await Promise.all([
        pool.query('SELECT id::float8 AS id, lat, lng FROM path_nodes WHERE area_id=$1 ORDER BY id',[area]),
        pool.query(`SELECT id::float8 AS id, from_node::float8 AS from_node, to_node::float8 AS to_node,
            osm_way_id::text, name, source_highway, pedestrian_access, foot_direction,
            ST_AsGeoJSON(geom)::jsonb->'coordinates' AS geometry,
            length_m, kind, covered, has_steps, slope_pct, surface_rating, is_crossing, crossing_type,
            crossing_width_m, ped_green_s, cycle_s, has_kerb_ramp, has_refuge,
            shade_morning, shade_midday, shade_afternoon, shade_source, lit_ratio, lighting_source
            FROM path_edges WHERE pedestrian_access AND area_id=$1 ORDER BY id`,[area]),
    ]);
    const context=await pilotContext(area);
    return { nodes: nodes.rows, edges: edges.rows,
        source: { name: 'OpenStreetMap', pedestrian_only: true, attribution: '© OpenStreetMap contributors (ODbL)',area_id:area,
            dataset_id:context.dataset_id,origin:context.origin,featured_ids:context.featured_ids,snapshot_at:context.sources.find(s=>s.id==='osm'||s.id==='geofabrik')?.data_at??null } };
}

export async function readHazards(area: PilotId = 'elmina') {
    const { rows } = await getPool().query(`SELECT id::float8 AS id, edge_id::float8 AS edge_id,
        lat, lng, kind, status, asset_id::text FROM hazard_reports WHERE status <> 'fixed' AND area_id=$1 ORDER BY id`,[area]);
    return rows;
}

const REPORT_FIELDS = `id::text, hazard_report_id::text, edge_id::float8 AS edge_id,
    lat, lng, kind, description, category, severity, location_name, estimated_cost_rm,
    reported_by_proxy, status, created_at, asset_id::text, checked_at, fixed_at, dismissed_at, responsible_team, review_note`;

export async function readReports(includeFixed = false, area: PilotId = 'elmina') {
    const { rows } = await getPool().query(`SELECT ${REPORT_FIELDS} FROM defect_reports
        WHERE ($1::boolean OR status <> 'fixed') AND area_id=$2 ORDER BY created_at DESC, id DESC`, [includeFixed,area]);
    return rows;
}

export async function createReport(report: NewReport) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const area = report.area_id ?? 'elmina';
        const asset = report.asset_id ? (await client.query<{
            id: string; name: string; kind: string; edge_id: string | null; lat: number; lng: number;
        }>(`SELECT id::text, name, kind, edge_id::text, lat, lng FROM walking_assets
            WHERE id=$1 AND area_id=$2 FOR SHARE`, [report.asset_id, area])).rows[0] : null;
        if (report.asset_id && !asset) throw new RequestError('The selected asset was not found in this area.', 422);
        if (report.kind === 'lift_out' && asset?.kind !== 'entrance') {
            throw new RequestError('Choose the entrance served by the lift.', 422);
        }
        const lat = asset?.lat ?? report.lat;
        const lng = asset?.lng ?? report.lng;
        // Check the claimed edge against the reported position on the server using PostGIS.
        const { rows } = await client.query<{ id: string; name: string | null; length_m: number; is_crossing: boolean }>(`
            SELECT id::text, name, length_m, is_crossing FROM path_edges
            WHERE pedestrian_access AND ($3::bigint IS NULL OR id = $3)
              AND area_id=$4 AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 150)
            ORDER BY ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
            LIMIT 1 FOR SHARE`, [lng, lat, asset ? asset.edge_id : report.edge_id ?? null, area]);
        const edge = rows[0];
        if (!edge && !asset) throw new RequestError('Choose a location within 150 metres of a mapped footpath.', 422);
        const problem = PROBLEMS[report.kind];
        const location = asset?.name || edge?.name || `${edge?.is_crossing ? 'Crossing' : 'Walkway'} #${edge?.id}`;
        const description = report.description || `${problem.label} reported on ${location}`;
        const { rows: hazards } = await client.query(`INSERT INTO hazard_reports(edge_id, lat, lng, kind, area_id, asset_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id::float8 AS id, edge_id::float8 AS edge_id, lat, lng, kind, status, asset_id::text`,
        [edge?.id ?? null, lat, lng, report.kind, area, asset?.id ?? null]);
        const { rows: defects } = await client.query(`INSERT INTO defect_reports
            (hazard_report_id, edge_id, lat, lng, kind, description, category, severity, location_name,
             estimated_cost_rm, reported_by_proxy, area_id, asset_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING ${REPORT_FIELDS}`,
        [hazards[0].id, edge?.id ?? null, lat, lng, report.kind, description, problem.category, problem.severity, location,
            report.kind === 'details_outdated' || report.kind === 'lift_out' ? 0 : estimateDefectCost(report.kind, edge?.length_m),
            report.reported_by_proxy, area, asset?.id ?? null]);
        await client.query('COMMIT');
        return { hazard: hazards[0], report: defects[0] };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function reviewReport(id: string, area: PilotId, check?: { team: string; note: string; dismiss: boolean }) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const old = (await client.query(`SELECT ${REPORT_FIELDS} FROM defect_reports
            WHERE id=$1 AND area_id=$2 FOR UPDATE`, [id, area])).rows[0];
        if (!old) throw new RequestError('The report was not found.', 404);
        if (old.status === 'fixed' || (check && old.checked_at)) {
            await client.query('COMMIT');
            return old;
        }
        if (!check && !old.checked_at) throw new RequestError('Check the report before marking it fixed.', 409);
        const { rows } = check
            ? await client.query(`UPDATE defect_reports SET checked_at=NOW(), responsible_team=$2, review_note=$3,
                status=CASE WHEN $4 THEN 'fixed' ELSE status END,
                dismissed_at=CASE WHEN $4 THEN NOW() ELSE NULL END
                WHERE id=$1 RETURNING ${REPORT_FIELDS}`, [id, check.team, check.note, check.dismiss])
            : await client.query(`UPDATE defect_reports SET status='fixed', fixed_at=NOW()
                WHERE id=$1 RETURNING ${REPORT_FIELDS}`, [id]);
        await client.query('UPDATE hazard_reports SET status=$2 WHERE id=$1',
            [old.hazard_report_id, check && !check.dismiss ? 'verified' : 'fixed']);
        await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function databaseHealth() {
    const { rows } = await getPool().query(`SELECT postgis_lib_version() AS postgis_version,
        (SELECT count(*)::int FROM path_nodes) AS nodes,
        (SELECT count(*)::int FROM path_edges WHERE pedestrian_access) AS edges`);
    return { database: 'ok', ...rows[0] };
}
