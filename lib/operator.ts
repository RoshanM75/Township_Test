import { reportStatus } from './report-status.ts';
import { evidenceFor } from './verification.ts';
import type { MaintenanceDefect } from './types.ts';
import type { AssetKind, VerificationRecord, VerificationTarget } from './walking.ts';
import type { PilotId } from './pilots.ts';

export type TargetType = 'edge' | 'asset';
export type TargetKind = 'path' | 'crossing' | AssetKind;
export type CheckStatus = 'current' | 'expired' | 'incomplete';
export const TARGET_LABELS: Record<TargetKind, string> = {
    path: 'Paths', crossing: 'Crossings', entrance: 'Entrances', rest: 'Rest facilities', toilet: 'Toilets',
    shelter: 'Shelters', water: 'Drinking water', transit: 'Transit locations', destination: 'Destinations',
};
export const ACCESS_CHECKLISTS = {
    path: ['path_open', 'has_steps', 'slope_pct', 'surface_rating', 'clear_width_m'],
    crossing: ['path_open', 'has_steps', 'slope_pct', 'surface_rating', 'clear_width_m', 'crossing_type', 'has_kerb_ramp',
        'has_tactile', 'audible_signal'],
    entrance: ['available', 'path_connection', 'step_free', 'opening_hours'],
    rest: ['available', 'path_connection', 'has_seat', 'step_free'],
    toilet: ['available', 'path_connection', 'accessible_toilet'],
    shelter: ['available', 'path_connection', 'sheltered'],
    water: ['available', 'path_connection', 'water_available'],
    transit: ['available'],
    destination: ['available'],
} satisfies Record<TargetKind, string[]>;

export interface Responsibility {
    target_type: TargetType;
    target_id: string;
    team: string;
    reference: string;
    updated_at: string;
}

export interface Assignment {
    team: string | null;
    due_on: string | null;
    work_order_ref: string | null;
    version: number;
    source: 'responsibility' | 'review' | 'manual';
    assigned_at: string;
}

export type OperatorGeometry = { type: 'Point'; coordinates: [number, number] } |
    { type: 'LineString'; coordinates: [number, number][] };

export interface OperatorTarget {
    target_type: TargetType;
    target_id: string;
    kind: TargetKind;
    name: string;
    geometry: OperatorGeometry;
    responsibility: Responsibility | null;
    check: { status: CheckStatus; current: number; required: number; missing: string[]; next_due: string | null };
}

const DAY = 86_400_000;
export const malaysiaDate = (instant: string) => new Date(Date.parse(instant) + 8 * 3600000).toISOString().slice(0, 10);
export const isOverdue = (report: MaintenanceDefect, today: string) =>
    report.status !== 'fixed' && Boolean(report.due_on && report.due_on < today);

export function reportTarget(report: Pick<MaintenanceDefect, 'edge_id' | 'asset_id'>) {
    if (report.asset_id) return { target_type: 'asset' as const, target_id: report.asset_id };
    return report.edge_id == null ? null : { target_type: 'edge' as const, target_id: String(report.edge_id) };
}

export const targetKey = (target: { target_type: TargetType; target_id: string }) => `${target.target_type}:${target.target_id}`;

function issueKey(report: MaintenanceDefect) {
    const target = reportTarget(report);
    return target ? `${targetKey(target)}:${report.kind ?? report.category}` : `report:${report.id}`;
}

export function rankOpenCases(reports: MaintenanceDefect[], today: string) {
    const open = reports.filter(report => report.status !== 'fixed');
    const counts = new Map<string, number>();
    for (const report of open) {
        const key = issueKey(report);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return open.map(report => ({ report, count: counts.get(issueKey(report))! })).sort((a, b) =>
        Number(b.report.severity === 'blocker') - Number(a.report.severity === 'blocker') ||
        Number(isOverdue(b.report, today)) - Number(isOverdue(a.report, today)) ||
        b.count - a.count || (a.report.created_at ?? '').localeCompare(b.report.created_at ?? '') ||
        String(a.report.id).localeCompare(String(b.report.id)));
}

export function targetCheck(kind: TargetKind, id: string, records: VerificationRecord[], at: string) {
    const type: VerificationTarget = kind === 'path' || kind === 'crossing' || kind === 'entrance' ? kind : 'facility';
    const latest = evidenceFor(records, type, id, at);
    const fields = kind === 'entrance' && latest.lift_available ? [...ACCESS_CHECKLISTS[kind], 'lift_available'] : ACCESS_CHECKLISTS[kind];
    const missing = fields.filter(field => latest[field]?.status !== 'verified');
    const expired = missing.some(field => latest[field]?.status === 'stale' &&
        records.some(record => record.id === latest[field].record_id && record.status === 'verified'));
    const nextDue = fields.map(field => latest[field]?.status === 'verified' ? latest[field].valid_until : null)
        .filter((date): date is string => !!date).sort()[0] ?? null;
    return { status: (missing.length === 0 ? 'current' : expired ? 'expired' : 'incomplete') as CheckStatus,
        current: fields.length - missing.length, required: fields.length, missing, next_due: nextDue };
}

export function coverageByKind(targets: OperatorTarget[], asOf: string) {
    const horizon = Date.parse(asOf) + 14 * DAY;
    return (Object.keys(TARGET_LABELS) as TargetKind[]).map(kind => {
        const matching = targets.filter(target => target.kind === kind);
        return { kind, total: matching.length, owned: matching.filter(target => target.responsibility).length,
            current: matching.filter(target => target.check.status === 'current').length,
            expired: matching.filter(target => target.check.status === 'expired').length,
            incomplete: matching.filter(target => target.check.status === 'incomplete').length,
            due_soon: matching.filter(target => target.check.next_due && Date.parse(target.check.next_due) <= horizon).length };
    });
}

function medianHours(reports: MaintenanceDefect[], field: 'checked_at' | 'fixed_at') {
    const durations = reports.map(report => Date.parse(report[field] ?? '') - Date.parse(report.created_at ?? ''))
        .filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    if (!durations.length) return null;
    const lower = durations[Math.floor((durations.length - 1) / 2)];
    const upper = durations[Math.ceil((durations.length - 1) / 2)];
    return Math.round((lower + upper) / (2 * 3600000) * 10) / 10;
}

export const windowStart = (asOf: string, days: number) => new Date(Date.parse(asOf) - days * DAY).toISOString();
const within = (date: string | null | undefined, from: string, to: string) => !!date && date >= from && date <= to;

export function selectPeriodCases(reports: MaintenanceDefect[], from: string, to: string) {
    return reports.filter(report => report.status !== 'fixed' ||
        [report.created_at, report.checked_at, report.fixed_at, report.dismissed_at].some(value => within(value, from, to)));
}

export function operatorActivity(reports: MaintenanceDefect[], area: PilotId, days: number, asOf: string) {
    const from = windowStart(asOf, days);
    const today = malaysiaDate(asOf);
    const opened = reports.filter(report => within(report.created_at, from, asOf));
    const checked = reports.filter(report => !report.dismissed_at && within(report.checked_at, from, asOf));
    const resolved = reports.filter(report => !report.dismissed_at && within(report.fixed_at, from, asOf));
    const fixed = resolved.filter(report=>report.kind!=='check_requested');
    const resolvedFieldChecks=resolved.filter(report=>report.kind==='check_requested').length;
    const open = reports.filter(report => report.status !== 'fixed');
    const teams = new Map<string | null, { team: string | null; open: number; checked: number; overdue: number }>();
    for (const report of open) {
        const team = report.responsible_team || null;
        const row = teams.get(team) ?? { team, open: 0, checked: 0, overdue: 0 };
        row.open++;
        if (report.checked_at) row.checked++;
        if (isOverdue(report, today)) row.overdue++;
        teams.set(team, row);
    }

    const groups = new Map<string, MaintenanceDefect[]>();
    for (const report of opened.filter(report => !report.dismissed_at && reportTarget(report))) {
        const key = issueKey(report);
        const group = groups.get(key) ?? [];
        group.push(report);
        groups.set(key, group);
    }
    const openIds = new Set(open.map(report => String(report.id)));
    const hotspots = Array.from(groups.entries()).filter(([, group]) => group.length > 1).map(([key, group]) => {
        const active = group.filter(report => openIds.has(String(report.id)));
        const latest = group.reduce((newest, report) => (report.created_at ?? '') > (newest.created_at ?? '') ? report : newest);
        const point = latest.lat != null && latest.lng != null ? [latest.lat, latest.lng] as [number, number] : null;
        return { key, name: latest.location_name ?? 'Mapped location', kind: latest.kind ?? latest.category, point,
            count: group.length, open: active.length,
            critical: group.some(report => report.severity === 'blocker'), report_id: active.length ? String(active[0].id) : null };
    }).sort((a, b) => b.count - a.count || b.open - a.open || a.name.localeCompare(b.name));

    // Use equal rolling intervals so that activity from two different dates is comparable.
    const steps = days === 7 ? 7 : 6;
    const buckets = Array.from({ length: steps }, (_, index) => {
        const start = new Date(Date.parse(from) + (index / steps) * days * DAY).toISOString();
        const end = index === steps - 1 ? asOf : new Date(Date.parse(from) + ((index + 1) / steps) * days * DAY).toISOString();
        const inside = (stamp: string | null | undefined) => !!stamp && stamp >= start && (index === steps - 1 ? stamp <= end : stamp < end);
        return { start, end, reported: opened.filter(report => inside(report.created_at)).length,
            fixed: fixed.filter(report => inside(report.fixed_at)).length };
    });
    return { area_id: area, days, from, as_of: asOf, reported: opened.length, checked: checked.length, fixed: fixed.length, resolved_field_checks:resolvedFieldChecks,
        dismissed: reports.filter(report => within(report.dismissed_at, from, asOf)).length,
        median_check_hours: medianHours(checked, 'checked_at'), median_fix_hours: medianHours(fixed, 'fixed_at'),
        open: open.length, unassigned: teams.get(null)?.open ?? 0, overdue: open.filter(report => isOverdue(report, today)).length,
        teams: [...teams.values()].sort((a, b) => b.open - a.open || (a.team ?? '').localeCompare(b.team ?? '')),
        hotspots: hotspots.slice(0, 20), buckets };
}

export type OperatorActivity = ReturnType<typeof operatorActivity>;
export type CoverageRow = ReturnType<typeof coverageByKind>[number];

export function caseExportRow(report: MaintenanceDefect, area: PilotId, dataset: string) {
    const target = reportTarget(report);
    return { id: String(report.id), area_id: area, dataset_id: dataset, target_type: target?.target_type ?? null,
        target_id: target?.target_id ?? null, location: report.location_name ?? null, kind: report.kind ?? null,
        severity: report.severity ?? null, status: reportStatus(report), team: report.responsible_team ?? null,
        due_on: report.due_on ?? null, work_order_ref: report.work_order_ref ?? null, assignment_version: report.assignment_version ?? 0, reported_at: report.created_at ?? null,
        checked_at: report.checked_at ?? null, fixed_at: report.fixed_at ?? null, dismissed_at: report.dismissed_at ?? null,
        estimated_cost_rm: (report.estimated_cost_rm ?? 0) > 0 ? report.estimated_cost_rm! : null,
        latitude: report.lat ?? null, longitude: report.lng ?? null };
}

export function checkExportRow(target: OperatorTarget, area: PilotId, dataset: string) {
    return { area_id: area, dataset_id: dataset, target_type: target.target_type, target_id: target.target_id, kind: target.kind,
        name: target.name, team: target.responsibility?.team ?? null, responsibility_ref: target.responsibility?.reference ?? null,
        check_status: target.check.status, current_fields: target.check.current, required_fields: target.check.required,
        missing_fields: target.check.missing.join(' | '), next_due: target.check.next_due, osm_attribution: '© OpenStreetMap contributors (ODbL)' };
}

type CsvValue = string | number | null;
export function operatorCsv<K extends string>(fields: readonly K[], rows: Record<K, CsvValue>[]) {
    const escape = (value: CsvValue) => {
        if (value === null) return '';
        if (typeof value === 'number') return String(value);
        const text = /^[\s\p{Cf}]*[=+@-]|^[\r\n\t]/u.test(value) ? "'" + value : value;
        return '"' + text.replaceAll('"', '""') + '"';
    };
    return fields.join(',') + '\r\n' + rows.map(row => fields.map(field => escape(row[field])).join(',')).join('\r\n') + '\r\n';
}
