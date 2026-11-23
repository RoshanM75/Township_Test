'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { loadOperatorActivity } from '@/lib/api';
import type { OperatorActivity } from '@/lib/operator';
import { PILOTS, type PilotId } from '@/lib/pilots';
import ExportControls from './ExportControls';

const Map = dynamic(() => import('@/components/map/InteractiveMap'), { ssr: false });
const localDay = (date: string) => new Date(date).toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short' });
const hours = (value: number | null) => value === null ? '—' : `${value.toLocaleString('en-MY')} h`;

export default function ActivityPanel({ area, reviewerKey, onOpenCase }: {
    area: PilotId; reviewerKey: string; onOpenCase: (id: string) => void;
}) {
    const [days, setDays] = useState(30);
    const [refresh, setRefresh] = useState(0);
    const [data, setData] = useState<OperatorActivity | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let cancelled = false;
        void loadOperatorActivity(area, reviewerKey, days).then(result => {
            if (!cancelled) { setData(result); setError(''); }
        }).catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Maintenance activity is unavailable.'); });
        return () => { cancelled = true; };
    }, [area, reviewerKey, days, refresh]);
    const summary = data?.days === days ? data : null;
    const [selected, setSelected] = useState<string | null>(null);
    return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-xl font-extrabold">Maintenance activity</h2>
            <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col text-sm font-semibold">Reporting period
                    <select className="min-h-11 rounded-lg border border-slate-400 px-3" value={days}
                        onChange={event => { setDays(Number(event.target.value)); setSelected(null); setError(''); }}>
                        {[7, 30, 90].map(value => <option key={value} value={value}>Last {value} days</option>)}
                    </select>
                </label>
                <button className="min-h-11 rounded-lg border border-slate-400 px-3 text-sm font-bold" onClick={() => setRefresh(count => count + 1)}>Refresh activity</button>
            </div>
        </header>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        {!summary && !error && <p role="status">Loading pilot activity…</p>}
        {summary && <>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[['Reported', summary.reported], ['Checked', summary.checked], ['Fixed', summary.fixed], ['Dismissed', summary.dismissed],
                    ['Median time to check', hours(summary.median_check_hours)], ['Median time to fix', hours(summary.median_fix_hours)],
                    ['Open now', summary.open], ['Overdue now', summary.overdue]].map(([label, value]) => <div key={label}
                    className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <dt className="text-sm font-semibold text-slate-700">{label}</dt>
                    <dd className="mt-1 text-2xl font-extrabold tabular-nums">{value}</dd>
                </div>)}
            </dl>
            <p className="text-sm text-slate-600">Activity counts each event in the reporting period. Open and overdue totals reflect the current backlog.
                Updated {new Date(summary.as_of).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })} MYT.</p>
            <div className="grid gap-4 lg:grid-cols-2">
                <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
                    <h3 className="font-bold">Reports and fixes over time</h3>
                    {summary.buckets.some(bucket => bucket.reported || bucket.fixed) ? <ActivityBars buckets={summary.buckets} />
                        : <p className="text-sm text-slate-600">No reports or fixes in the selected period.</p>}
                </section>
                <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
                    <h3 className="font-bold">Current work by team</h3>
                    {summary.teams.length ? <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 text-slate-700">
                            <tr><th className="pb-2">Team</th><th className="px-1 pb-2">Open</th><th className="px-1 pb-2">Checked</th><th className="pb-2">Overdue</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">{summary.teams.map(row => <tr key={JSON.stringify(row.team)}>
                            <th scope="row" className="break-words py-2 pr-2 font-medium">{row.team ?? 'Unassigned'}</th>
                            <td className="px-1 tabular-nums">{row.open}</td><td className="px-1 tabular-nums">{row.checked}</td><td className="tabular-nums">{row.overdue}</td>
                        </tr>)}</tbody>
                    </table> : <p className="text-sm text-slate-600">No open work in this pilot.</p>}
                </section>
            </div>
            <section className="space-y-3">
                <h3 className="font-bold">Repeat report locations</h3>
                <p className="text-sm text-slate-600">Two or more reports of the same issue on the same mapped target in this period.</p>
                {summary.hotspots.length ? <div className="grid gap-4 lg:grid-cols-2">
                    <div className="h-64 overflow-hidden rounded-xl border border-slate-300">
                        <Map reduceMotion startCoords={PILOTS[area].centre} selectedPinId={selected} onPinSelect={id => setSelected(String(id))}
                            pins={summary.hotspots.flatMap((item, index) => item.point ? [{ id: item.key, lat: item.point[0], lng: item.point[1],
                                title: item.name, detail: `${item.count} reports · ${item.open} open`, rank: index + 1,
                                severity: item.critical ? 'blocker' as const : 'comfort' as const }] : [])} />
                    </div>
                    <ol className="max-h-64 space-y-2 overflow-y-auto">
                        {summary.hotspots.map((item, index) => <li key={item.key} className="rounded-lg border border-slate-200 p-2 text-sm">
                            <button className="min-h-10 text-left font-bold underline" aria-pressed={selected === item.key} onClick={() => setSelected(item.key)}>
                                {index + 1}. {item.name}
                            </button>
                            <p>{item.kind.replaceAll('_', ' ')} · {item.count} reports · {item.open} open</p>
                            {item.report_id && <button className="min-h-10 font-bold text-[#7F1D22] underline"
                                onClick={() => onOpenCase(item.report_id!)}>Open a related case</button>}
                        </li>)}
                    </ol>
                </div> : <p className="text-sm text-slate-600">No repeat locations in the selected period.</p>}
            </section>
            <ExportControls area={area} reviewerKey={reviewerKey} dataset="cases" days={days} />
            <p className="text-sm text-slate-600">Case exports include current open cases and records with activity in this period.</p>
        </>}
    </section>;
}

function ActivityBars({ buckets }: { buckets: OperatorActivity['buckets'] }) {
    const largest = Math.max(1, ...buckets.map(bucket => Math.max(bucket.reported, bucket.fixed)));
    return <ol className="space-y-3">
        {buckets.map(bucket => <li className="space-y-1 text-xs" key={bucket.start}>
            <p className="font-semibold">{localDay(bucket.start)} – {localDay(bucket.end)}</p>
            {([['Reported', bucket.reported, 'bg-[#A4262C]'], ['Fixed', bucket.fixed, 'bg-emerald-700']] as const)
                .map(([label, count, colour]) => <div key={label} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 tabular-nums">{label} {count}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                        <span className={`block h-full rounded-full ${colour}`} style={{ width: `${100 * count / largest}%` }} />
                    </span>
                </div>)}
        </li>)}
    </ol>;
}
