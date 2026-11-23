'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { loadOperatorTargets, updateResponsibility } from '@/lib/api';
import { TARGET_LABELS, targetKey, type OperatorTarget } from '@/lib/operator';
import type { PilotId } from '@/lib/pilots';
import { observationFields } from '@/lib/verification-fields';
import ExportControls from './ExportControls';

const TargetMap = dynamic(() => import('@/components/map/InteractiveMap'), { ssr: false });
const input = 'min-h-11 rounded-lg border border-slate-400 bg-white px-3';
const button = 'min-h-11 rounded-lg border border-slate-400 bg-white px-3 text-sm font-bold disabled:opacity-50';
const LABELS = { current: 'Current checks', expired: 'Expired checks', incomplete: 'Checks incomplete' };

export default function TargetsPanel({ area, reviewerKey, initial }: {
    area: PilotId; reviewerKey: string; initial?: Pick<OperatorTarget, 'target_id' | 'target_type'>;
}) {
    const [name, setName] = useState(initial?.target_id ?? ''), [q, setQuery] = useState(name);
    const [kind, setKind] = useState('all'), [state, setState] = useState('all');
    const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
    const [data, setData] = useState<Awaited<ReturnType<typeof loadOperatorTargets>> | null>(null);
    const [selectedKey, setSelectedKey] = useState(initial ? targetKey(initial) : '');
    const [error, setError] = useState('');
    useEffect(() => {
        let cancelled = false;
        void loadOperatorTargets(area, reviewerKey, new URLSearchParams({ kind, state, q, offset: String(offset) })).then(result => {
            if (!cancelled) { setData(result); setError(''); }
        }).catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Mapped targets are unavailable.'); });
        return () => { cancelled = true; };
    }, [area, reviewerKey, kind, state, q, offset, refresh]);
    const selected = data?.targets.find(target => targetKey(target) === selectedKey);
    return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-xl font-extrabold">Access checks and responsibility</h2>
        <p className="text-sm text-slate-600">Coverage counts current field checks for each target’s access checklist. A completed checklist can include a checked barrier.</p>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        {!data && !error && <p role="status">Loading mapped targets…</p>}
        {data && <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200"><tr>{['Mapped targets', 'Total', 'With team', 'Current', 'Expired', 'Incomplete', 'Due in 14 days']
                    .map(label => <th className="px-2 py-2" key={label}>{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">{data.coverage.filter(row => row.total > 0).map(row => <tr key={row.kind}>
                    <th scope="row" className="px-2 py-2 font-semibold">{TARGET_LABELS[row.kind]}</th>
                    {[row.total, row.owned, row.current, row.expired, row.incomplete, row.due_soon].map((value, i) =>
                        <td key={i} className="px-2 py-2 tabular-nums">{value.toLocaleString('en-MY')}</td>)}
                </tr>)}</tbody>
            </table>
        </div>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setQuery(name.trim()); setOffset(0); setSelectedKey(''); }}>
            <label className="flex grow flex-col text-sm font-semibold">Search by name, team or ID
                <input className={input} value={name} maxLength={160} onChange={event => setName(event.target.value)} />
            </label>
            <button className={button}>Search targets</button>
            <label className="flex flex-col text-sm font-semibold">Target type
                <select className={input} value={kind} onChange={event => { setKind(event.target.value); setOffset(0); }}>
                    <option value="all">All types</option>
                    {Object.entries(TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
            </label>
            <label className="flex flex-col text-sm font-semibold">Show
                <select className={input} value={state} onChange={event => { setState(event.target.value); setOffset(0); }}>
                    <option value="all">All targets</option><option value="unassigned">No responsible team</option><option value="current">Current checks</option>
                    <option value="expired">Expired checks</option><option value="incomplete">Incomplete checks</option><option value="due_soon">Review due in 14 days</option>
                </select>
            </label>
        </form>
        {data && <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-2">
                <p className="text-sm text-slate-600" role="status">{data.total > 0
                    ? `Showing ${data.offset + 1}–${data.offset + data.targets.length} of ${data.total.toLocaleString('en-MY')}` : 'No matching targets.'}</p>
                <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                    {data.targets.map(target => <li key={targetKey(target)}>
                        <button type="button" className="min-h-11 w-full px-3 py-2 text-left hover:bg-slate-50"
                            aria-pressed={selectedKey === targetKey(target)} onClick={() => setSelectedKey(targetKey(target))}>
                            <strong>{target.name}</strong><span className="block text-xs text-slate-600">{target.target_id} · {LABELS[target.check.status]}
                                {target.responsibility ? ` · ${target.responsibility.team}` : ' · Unassigned'}</span>
                        </button>
                    </li>)}
                </ul>
                {data.total > 25 && <div className="flex flex-wrap gap-2">
                    <button className={button} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous targets</button>
                    <button className={button} disabled={data.next_offset === null} onClick={() => setOffset(data.next_offset ?? offset)}>Next targets</button>
                </div>}
            </div>
            {selected && <TargetDetail key={targetKey(selected)} area={area} reviewerKey={reviewerKey} target={selected}
                onSaved={() => setRefresh(count => count + 1)} />}
        </div>}
        <ExportControls area={area} reviewerKey={reviewerKey} dataset="checks" />
    </section>;
}

function TargetDetail({ area, reviewerKey, target, onSaved }: {
    area: PilotId; reviewerKey: string; target: OperatorTarget; onSaved: () => void;
}) {
    const [team, setTeam] = useState(target.responsibility?.team ?? '');
    const [ref, setRef] = useState(target.responsibility?.reference ?? '');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const verificationType = target.kind === 'path' || target.kind === 'crossing' || target.kind === 'entrance' ? target.kind : 'facility';
    const fields = new Map(observationFields(verificationType).map(item => [item.key, item.label]));
    const points = (target.geometry.type === 'Point' ? [target.geometry.coordinates] : target.geometry.coordinates)
        .map(([lng, lat]): [number, number] => [lat, lng]);
    async function save(clear: boolean) {
        setBusy(true); setMessage('');
        try {
            const { responsibility } = await updateResponsibility(area, reviewerKey,
                { target_type: target.target_type, target_id: target.target_id, team: clear ? null : team, reference: ref });
            if (!responsibility) { setTeam(''); setRef(''); }
            setMessage(responsibility ? 'Responsibility saved for future reports.' : 'Responsibility removed.');
            onSaved();
        } catch (err) { setMessage(err instanceof Error ? err.message : 'The responsibility could not be saved.'); }
        finally { setBusy(false); }
    }
    return <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
        <h3 className="font-bold">{target.name}</h3>
        <div className="h-52 overflow-hidden rounded-lg">
            <TargetMap reduceMotion startCoords={points[0]} endCoords={points.length > 1 ? points.at(-1) : undefined} showLayerControls={false}
                routes={points.length > 1 ? [{ id: target.target_id, name: target.name, route_type: 'direct', coordinates: points }] : []} />
        </div>
        <p className="text-sm">{LABELS[target.check.status]} · {target.check.current} of {target.check.required} fields checked.</p>
        {target.check.next_due && <p className="text-sm">Next field check expiry {new Date(target.check.next_due).toLocaleDateString('en-MY',
            { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium' })}.</p>}
        {target.check.missing.length > 0 && <details className="text-sm">
            <summary className="cursor-pointer font-semibold">Fields that need a current check</summary>
            <ul className="list-disc pl-5">{target.check.missing.map(field => <li key={field}>{fields.get(field) ?? field}</li>)}</ul>
        </details>}
        <Link className="inline-flex min-h-11 items-center font-bold text-[#7F1D22] underline"
            href={`/verification?area=${area}&type=${verificationType}&target=${target.target_id}`}>Open verification record</Link>
        <form className="space-y-3 border-t border-slate-200 pt-3" onSubmit={event => { event.preventDefault(); void save(false); }}>
            <label className="flex flex-col text-sm font-semibold">Responsible team<input className={input} value={team}
                required maxLength={120} onChange={event => setTeam(event.target.value)} /></label>
            <label className="flex flex-col text-sm font-semibold">Responsibility reference<input className={input} value={ref}
                required maxLength={300} placeholder="Asset register or handover reference" onChange={event => setRef(event.target.value)} /></label>
            <div className="flex flex-wrap gap-2">
                <button className={button} disabled={busy}>{busy ? 'Saving…' : 'Save responsibility'}</button>
                {target.responsibility && <button type="button" className={button} disabled={busy} onClick={() => void save(true)}>Clear responsibility</button>}
            </div>
            {message && <p role="status" className="text-sm">{message}</p>}
        </form>
    </div>;
}
