import 'server-only';
import type { PoolClient } from 'pg';
import { getPool } from './postgres.ts';
import { RequestError, validateReportId } from './validation.ts';
import type { Assignment, Responsibility, TargetType } from '../operator.ts';
import type { PilotId } from '../pilots.ts';
import type { MaintenanceDefect } from '../types.ts';

const fields = 'target_type, target_id::text, team, reference, updated_at';

function inputObject(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('A JSON object is required.');
    return body as Record<string, unknown>;
}

function optionalText(value: unknown, label: string, max: number) {
    if (value == null) return null;
    if (typeof value !== 'string' || value.trim().length > max) throw new RequestError(`${label} must be at most ${max} characters.`);
    return value.trim() || null;
}

export function assignmentInput(body: unknown) {
    const input = inputObject(body);
    const version = input.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 2147483646) {
        throw new RequestError('Refresh the report to get its current assignment version.');
    }
    const date = optionalText(input.due_on, 'Due date', 10);
    if (date) {
        const time = Date.parse(date + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000') || !Number.isFinite(time) ||
            new Date(time).toISOString().slice(0, 10) !== date) throw new RequestError('Choose a valid due date.');
    }
    return { team: optionalText(input.team, 'Responsible team', 120), due_on: date,
        work_order_ref: optionalText(input.work_order_ref, 'Work order reference', 120), version };
}

export async function readResponsibilities(area: PilotId) {
    const { rows } = await getPool().query<Responsibility>(`SELECT ${fields} FROM maintenance_responsibilities WHERE area_id=$1`, [area]);
    return rows;
}

export async function responsibilityAt(client: Pick<PoolClient, 'query'>, area: PilotId, target: { target_type: TargetType; target_id: string }) {
    const { rows } = await client.query<Responsibility>(`SELECT ${fields} FROM maintenance_responsibilities
        WHERE area_id=$1 AND target_type=$2 AND target_id=$3`, [area, target.target_type, target.target_id]);
    return rows[0] ?? null;
}

export async function saveResponsibility(area: PilotId, body: unknown) {
    const input = inputObject(body);
    const type = input.target_type;
    if (type !== 'edge' && type !== 'asset') throw new RequestError('Choose a mapped path or facility.');
    const id = validateReportId(typeof input.target_id === 'string' ? input.target_id : '');
    const team = optionalText(input.team, 'Responsible team', 120), reference = optionalText(input.reference, 'Responsibility reference', 300);
    if (team && !reference) throw new RequestError('Record the operator reference for this responsibility.');
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const resource = type === 'edge'
            ? await client.query('SELECT id FROM path_edges WHERE id=$1 AND area_id=$2 AND pedestrian_access AND kind<>\'street\' FOR SHARE', [id, area])
            : await client.query('SELECT id FROM walking_assets WHERE id=$1 AND area_id=$2 FOR SHARE', [id, area]);
        if (!resource.rowCount) throw new RequestError('That mapped target was not found in this area.', 404);
        const result = team ? await client.query<Responsibility>(`INSERT INTO maintenance_responsibilities(area_id,target_type,target_id,team,reference)
            VALUES($1,$2,$3,$4,$5) ON CONFLICT (area_id,target_type,target_id) DO UPDATE
            SET team=EXCLUDED.team, reference=EXCLUDED.reference,
                updated_at=CASE WHEN maintenance_responsibilities.team=EXCLUDED.team AND maintenance_responsibilities.reference=EXCLUDED.reference
                    THEN maintenance_responsibilities.updated_at ELSE NOW() END
            RETURNING ${fields}`, [area, type, id, team, reference])
            : await client.query('DELETE FROM maintenance_responsibilities WHERE area_id=$1 AND target_type=$2 AND target_id=$3', [area, type, id]);
        await client.query('COMMIT');
        return team ? result.rows[0] : null;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

export async function recordAssignment(client: PoolClient, report: MaintenanceDefect, source: Assignment['source']) {
    await client.query(`INSERT INTO maintenance_assignments (report_id,version,team,due_on,work_order_ref,source)
        VALUES ($1,$2,$3,$4,$5,$6)`, [report.id, report.assignment_version, report.responsible_team,
        report.due_on, report.work_order_ref, source]);
}

export async function assignmentHistory(area: PilotId, id: string) {
    const { rows } = await getPool().query<Assignment>(`SELECT a.version, a.team, a.due_on::text, a.work_order_ref, a.source, a.assigned_at
        FROM defect_reports d LEFT JOIN maintenance_assignments a ON d.id=a.report_id
        WHERE d.id=$1 AND d.area_id=$2 ORDER BY a.version DESC`, [id, area]);
    if (!rows.length) throw new RequestError('The report was not found in this area.', 404);
    return rows.filter(row => row.version !== null);
}
