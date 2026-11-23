import 'server-only';
import { readGraph, readReports } from './repository.ts';
import { pilotContext } from './pilots.ts';
import { walkingData } from './walking-data.ts';
import { readResponsibilities } from './responsibilities.ts';
import { RequestError } from './validation.ts';
import { targetKey, targetCheck, operatorActivity, TARGET_LABELS, type OperatorTarget, type TargetKind } from '../operator.ts';
import type { PilotId } from '../pilots.ts';
import type { WalkingData } from '../walking.ts';
import type { PathEdge } from '../routing.ts';

export function periodDays(search: URLSearchParams) {
    const value = search.get('days') ?? '30';
    if (!['7', '30', '90'].includes(value)) throw new RequestError('Choose a 7, 30 or 90 day period.');
    return Number(value);
}

export async function operatorReports(area: PilotId) {
    const date = (value: string | null | undefined) => value ? new Date(value).toISOString() : null;
    return (await readReports(true, area, true)).map(row => ({ ...row,
        created_at: date(row.created_at) ?? undefined, checked_at: date(row.checked_at), fixed_at: date(row.fixed_at),
        dismissed_at: date(row.dismissed_at),
    }));
}

export async function readOperatorActivity(area: PilotId, days: number) {
    const [reports, context] = await Promise.all([operatorReports(area), pilotContext(area)]);
    return { ...operatorActivity(reports, area, days, new Date().toISOString()), dataset_id: context.dataset_id };
}

export async function operatorTargets(area: PilotId) {
    const [graph, walking, responsibilities] = await Promise.all([readGraph(area), walkingData(area), readResponsibilities(area)]);
    const asOf = new Date().toISOString();
    const data: WalkingData = walking;
    const byTarget = new Map(responsibilities.map(row => [targetKey(row), row]));
    const byEvidence = new Map<string, WalkingData['verifications']>();
    for (const record of data.verifications) {
        const key = `${record.target_type}:${record.target_id}`;
        const records = byEvidence.get(key) ?? [];
        records.push({ ...record, observed_at: new Date(record.observed_at).toISOString(),
            created_at: new Date(record.created_at).toISOString(), valid_until: record.valid_until ? new Date(record.valid_until).toISOString() : null });
        byEvidence.set(key, records);
    }
    const makeTarget = (target_type: OperatorTarget['target_type'], target_id: string, kind: TargetKind, name: string,
        geometry: OperatorTarget['geometry']): OperatorTarget => {
        const verificationType = kind === 'path' || kind === 'crossing' || kind === 'entrance' ? kind : 'facility';
        const records = byEvidence.get(`${verificationType}:${target_id}`) ?? [];
        return { target_type, target_id, kind, name, geometry, responsibility: byTarget.get(targetKey({ target_type, target_id })) ?? null,
            check: targetCheck(kind, target_id, records, asOf) };
    };
    const targets = (graph.edges as PathEdge[]).filter(edge => edge.pedestrian_access !== false && edge.kind !== 'street').map(edge =>
        makeTarget('edge', String(edge.id), edge.is_crossing ? 'crossing' : 'path',
            edge.name || (edge.is_crossing ? 'Mapped crossing' : 'Mapped footpath'), { type: 'LineString', coordinates: edge.geometry }));
    targets.push(...data.assets.map(asset => makeTarget('asset', asset.id, asset.kind, asset.name,
        { type: 'Point', coordinates: [asset.lng, asset.lat] })));
    return { targets, dataset_id: graph.source.dataset_id, as_of: asOf };
}

export function filterOperatorTargets(targets: OperatorTarget[], search: URLSearchParams, asOf: string) {
    const kind = search.get('kind') ?? 'all';
    const state = search.get('state') ?? 'all';
    const q = (search.get('q') ?? '').trim().toLowerCase();
    const rawOffset = search.get('offset') ?? '0';
    if (kind !== 'all' && !Object.hasOwn(TARGET_LABELS, kind)) throw new RequestError('Choose a supported target type.');
    if (!['all','current','expired','incomplete','due_soon','unassigned'].includes(state)) throw new RequestError('Choose a supported coverage filter.');
    if (q.length > 160 || !/^\d{1,6}$/.test(rawOffset)) throw new RequestError('Use a shorter name or a valid page number.');
    const offset = Number(rawOffset), pageSize = 25;
    const due = Date.parse(asOf) + 14 * 86_400_000;
    const matches = targets.filter(target => (kind === 'all' || target.kind === kind)
        && (state === 'all' || (state === 'unassigned' ? !target.responsibility
            : state === 'due_soon' ? target.check.next_due && Date.parse(target.check.next_due) <= due : target.check.status === state))
        && (!q || target.target_id === q || target.name.toLowerCase().includes(q) ||
            target.responsibility?.team.toLowerCase().includes(q))).sort((a, b) =>
        Number(b.check.status === 'expired') - Number(a.check.status === 'expired') ||
        a.name.localeCompare(b.name) || a.target_id.localeCompare(b.target_id));
    return { targets: matches.slice(offset, offset + pageSize), total: matches.length, offset,
        next_offset: offset + pageSize < matches.length ? offset + pageSize : null };
}
