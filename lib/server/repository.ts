import 'server-only';
import { getPool } from './postgres.ts';
import { RequestError, type NewReport, type validateReportCheck } from './validation.ts';
import { estimateDefectCost } from '../scoring.ts';
import type { HazardKind } from '../routing.ts';
import type { PilotId } from '../pilots.ts';
import { pilotContext } from './pilots.ts';
import { assignmentInput, recordAssignment, responsibilityAt } from './responsibilities.ts';
import type { MaintenanceDefect } from '../types.ts';
import { reportTarget } from '../operator.ts';
import { observationFields } from '../verification-fields.ts';

const PROBLEMS: Record<HazardKind, { category: string; severity: 'blocker' | 'comfort'; label: string }> = {
    check_requested: { category: 'Condition verification', severity: 'comfort', label: 'Field check requested' },
    blocked: { category: 'Access Barrier', severity: 'blocker', label: 'Path is blocked' },
    no_ramp: { category: 'Universal Design', severity: 'blocker', label: 'No ramp at the kerb' },
    light_out: { category: 'Safety Electrical', severity: 'comfort', label: 'Streetlight is not working' },
    shade_correction: { category: 'Shade map correction', severity: 'comfort', label: 'Shade map correction' },
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
    reported_by_proxy, status, created_at, asset_id::text, checked_at, fixed_at, dismissed_at, responsible_team, review_note, observed_at, shade_change, map_updated_at, requested_field`;

const OPERATOR_REPORT_FIELDS = `${REPORT_FIELDS}, due_on::text, work_order_ref, assignment_version`;

export async function readReports(includeFixed = false, area: PilotId = 'elmina', forOperator = false) {
    const { rows } = await getPool().query<MaintenanceDefect>(`SELECT ${forOperator ? OPERATOR_REPORT_FIELDS : REPORT_FIELDS} FROM defect_reports
        WHERE ($1::boolean OR status <> 'fixed') AND area_id=$2 ORDER BY created_at DESC, id DESC`, [includeFixed, area]);
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
              AND area_id=$4 AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5)
            ORDER BY ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
            LIMIT 1 FOR SHARE`, [lng, lat, asset ? asset.edge_id : report.edge_id ?? null, area, report.kind === 'shade_correction' ? 30 : 150]);
        const edge = rows[0];
        if (!edge && !asset) throw new RequestError(report.kind === 'shade_correction'
            ? 'Choose a point along the affected path segment.' : 'Choose a location within 150 metres of a mapped footpath.', 422);
        const verificationType=asset ? asset.kind==='entrance'?'entrance':'facility' : edge?.is_crossing?'crossing':'path';
        if(report.requested_field&&!observationFields(verificationType).some(field=>field.key===report.requested_field))
            throw new RequestError('The requested field does not apply to this mapped target.');
        const problem = PROBLEMS[report.kind];
        const location = asset?.name || edge?.name || `${edge?.is_crossing ? 'Crossing' : 'Walkway'} #${edge?.id}`;
        const description = report.description || `${problem.label} reported on ${location}`;
        const target = reportTarget({ edge_id: edge ? Number(edge.id) : null, asset_id: asset?.id });
        const responsibility = target ? await responsibilityAt(client, area, target) : null;
        const { rows: hazards } = await client.query(`INSERT INTO hazard_reports(edge_id, lat, lng, kind, area_id, asset_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id::float8 AS id, edge_id::float8 AS edge_id, lat, lng, kind, status, asset_id::text`,
        [edge?.id ?? null, lat, lng, report.kind, area, asset?.id ?? null]);
        const { rows: defects } = await client.query(`INSERT INTO defect_reports
            (hazard_report_id, edge_id, lat, lng, kind, description, category, severity, location_name,
             estimated_cost_rm, reported_by_proxy, area_id, asset_id, responsible_team, assignment_version, observed_at, shade_change, requested_field)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            RETURNING ${REPORT_FIELDS}`,
        [hazards[0].id, edge?.id ?? null, lat, lng, report.kind, description, problem.category, problem.severity, location,
            report.kind === 'check_requested' || report.kind === 'details_outdated' || report.kind === 'lift_out' || report.kind === 'shade_correction' ? 0 : estimateDefectCost(report.kind, edge?.length_m),
            report.reported_by_proxy, area, asset?.id ?? null, responsibility?.team ?? null, responsibility ? 1 : 0, report.observed_at ?? null, report.shade_change ?? null,report.requested_field??null]);
        if (responsibility) await recordAssignment(client, { ...defects[0], assignment_version: 1 }, 'responsibility');
        await client.query('COMMIT');
        return { hazard: hazards[0], report: defects[0] };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function reviewReport(id: string, area: PilotId, check?: ReturnType<typeof validateReportCheck>) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const old = (await client.query<MaintenanceDefect>(`SELECT ${OPERATOR_REPORT_FIELDS} FROM defect_reports
            WHERE id=$1 AND area_id=$2 FOR UPDATE`, [id, area])).rows[0];
        if (!old) throw new RequestError('The report was not found.', 404);
        if (old.status === 'fixed' || (check && old.checked_at)) {
            await client.query('COMMIT');
            return old;
        }
        if (!check && !old.checked_at) throw new RequestError('Check the report before marking it fixed.', 409);
        const shadeReview = check && !check.dismiss && old.kind === 'shade_correction';
        if (shadeReview) {
            if (!check.shade_result || !old.observed_at || !old.edge_id) throw new RequestError('Choose the shade or cover condition you checked.');
            const { rows: [target] } = await client.query<{ is_crossing: boolean }>(
                'SELECT is_crossing FROM path_edges WHERE id=$1 AND area_id=$2 FOR SHARE', [old.edge_id, area]);
            if (!target) throw new RequestError('The reported segment is unavailable.', 409);
            const attributes = check.shade_result === 'roof_removed' ? { covered: false } : { shade_observed: Number(check.shade_result === 'shade') };
            await client.query(`INSERT INTO verification_records
                (target_type,target_id,status,observed_at,valid_until,reviewer,method,source_ref,notes,attributes,area_id)
                VALUES ($1,$2,'verified',$3,GREATEST($3::timestamptz,NOW()) + $4::interval,$5,'operator_record',$6,$7,$8,$9)`,
            [target.is_crossing ? 'crossing' : 'path', old.edge_id, old.observed_at,
                check.shade_result === 'roof_removed' ? '90 days' : '30 days', check.team, `report:${id}`, check.note, JSON.stringify(attributes), area]);
        }
        // A request asks for evidence, not confirmation of a defect. Resolve
        // it only with a real, current observation of the specified target.
        const fieldRequest=check && !check.dismiss && old.kind==='check_requested';
        if(fieldRequest) {
            const type=old.asset_id ? (await client.query<{kind:string}>('SELECT kind FROM walking_assets WHERE id=$1 AND area_id=$2',[old.asset_id,area])).rows[0]?.kind==='entrance'?'entrance':'facility'
                : (await client.query<{is_crossing:boolean}>('SELECT is_crossing FROM path_edges WHERE id=$1 AND area_id=$2',[old.edge_id,area])).rows[0]?.is_crossing?'crossing':'path';
            const latest=(await client.query<{current:boolean}>(`SELECT status='verified' AND valid_until>NOW() AND created_at>=$4::timestamptz AS current
                FROM verification_records WHERE area_id=$1 AND target_type=$2 AND target_id=$3 AND observed_at<=NOW()
                AND ($5::text IS NULL OR attributes ? $5::text)
                ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1`,[area,type,old.asset_id??String(old.edge_id),old.created_at,old.requested_field??null])).rows[0];
            if(!latest?.current)throw new RequestError('Record a current field observation for the requested condition in the verification workspace before marking this request checked.',409);
        }
        const assign = Boolean(check && !old.responsible_team);
        const { rows } = check
            ? await client.query<MaintenanceDefect>(`UPDATE defect_reports SET checked_at=NOW(), responsible_team=COALESCE(responsible_team,$2), review_note=$3,
                status=CASE WHEN $4 THEN 'fixed' ELSE status END, dismissed_at=CASE WHEN $4 THEN NOW() ELSE NULL END,
                assignment_version=assignment_version + CASE WHEN $5 THEN 1 ELSE 0 END,
                map_updated_at=CASE WHEN $6 THEN NOW() ELSE map_updated_at END
                WHERE id=$1 RETURNING ${OPERATOR_REPORT_FIELDS}`, [id, check.team, check.note, check.dismiss, assign, Boolean(shadeReview||fieldRequest)])
            : await client.query<MaintenanceDefect>(`UPDATE defect_reports SET status='fixed', fixed_at=NOW(),
                map_updated_at=CASE WHEN EXISTS (
                    SELECT 1 FROM verification_records v WHERE v.area_id=defect_reports.area_id AND v.target_id=COALESCE(defect_reports.asset_id,defect_reports.edge_id)
                    AND v.target_type IN (CASE WHEN defect_reports.asset_id IS NULL THEN 'path' ELSE 'entrance' END,CASE WHEN defect_reports.asset_id IS NULL THEN 'crossing' ELSE 'facility' END)
                    AND v.status='verified' AND v.valid_until>NOW() AND v.observed_at>=defect_reports.checked_at
                ) THEN NOW() ELSE map_updated_at END
                WHERE id=$1 RETURNING ${OPERATOR_REPORT_FIELDS}`, [id]);
        if (assign) await recordAssignment(client, rows[0], 'review');
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


export async function assignReport(id: string, area: PilotId, input: ReturnType<typeof assignmentInput>) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const { rows: [old] } = await client.query<MaintenanceDefect>(`SELECT ${OPERATOR_REPORT_FIELDS} FROM defect_reports
            WHERE id=$1 AND area_id=$2 FOR UPDATE`, [id, area]);
        if (!old) throw new RequestError('The report was not found in this area.', 404);
        if (old.status === 'fixed') throw new RequestError('This report is already closed.', 409);
        const same = old.responsible_team === input.team && old.due_on === input.due_on && old.work_order_ref === input.work_order_ref;
        if (same) {
            await client.query('COMMIT');
            return old;
        }
        if (old.assignment_version !== input.version) throw new RequestError('Another operator updated this assignment. Refresh and review the changes.', 409);
        const { rows: [report] } = await client.query<MaintenanceDefect>(`UPDATE defect_reports SET responsible_team=$2, due_on=$3,
            work_order_ref=$4, assignment_version=assignment_version+1 WHERE id=$1 RETURNING ${OPERATOR_REPORT_FIELDS}`,
        [id, input.team, input.due_on, input.work_order_ref]);
        await recordAssignment(client, report, 'manual');
        await client.query('COMMIT');
        return report;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}
