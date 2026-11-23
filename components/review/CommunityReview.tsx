'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { loadCommunityQueue, reviewCommunityRoute } from '@/lib/api';
import { communityStatusLabel, type CommunityRoute, type RoutePoint } from '@/lib/community-routes';
import type { PilotId } from '@/lib/pilots';
import { CommunityPathMap, communityDate } from '@/components/walking/CommunityRoutes';

type QueueItem = CommunityRoute & { points: RoutePoint[] };
const input = 'mt-1 min-h-11 w-full rounded-lg border border-slate-400 px-3 py-2';
const button = 'min-h-11 rounded-lg border border-slate-400 px-3 py-2 font-bold disabled:opacity-50';

export default function CommunityReview({ area, reviewerKey }: { area: PilotId; reviewerKey: string }) {
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [team, setTeam] = useState('');
    const [note, setNote] = useState('');
    const [hours, setHours] = useState('');
    const [fieldChecked, setFieldChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    useEffect(() => {
        if (!reviewerKey) return;
        let cancelled = false;
        void loadCommunityQueue(area, reviewerKey).then(({ routes }) => {
            if (!cancelled) { setQueue(routes); setError(''); }
        }).catch((err: unknown) => {
            if (!cancelled) { setQueue([]); setError(err instanceof Error ? err.message : 'Could not load community routes.'); }
        });
        return () => { cancelled = true; };
    }, [area, refresh, reviewerKey]);
    const selected = queue.find(route => route.id === selectedId);
    async function review(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
        if (!selected || !action || busy) return;
        setBusy(true); setError(''); setStatus('');
        try {
            const { route } = await reviewCommunityRoute(area, selected.id, reviewerKey,
                { action, reviewer: team, note, field_checked: fieldChecked, opening_hours: hours });
            setQueue(previous => previous.map(item => item.id === route.id ? { ...item, ...route } : item));
            setNote(''); setFieldChecked(false); setStatus(`${route.title} · ${communityStatusLabel(route)}`);
        } catch (err) { setError(err instanceof Error ? err.message : 'Could not update the route.'); }
        finally { setBusy(false); }
    }
    if (!reviewerKey) return null;
    return <section className="space-y-3 rounded-xl border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Community route review</h2>
            <button type="button" className={button} onClick={() => setRefresh(value => value + 1)}>Refresh submissions</button>
        </div>
        {status && <p role="status">{status}</p>}
        {error && <p role="alert" className="text-red-800">{error}</p>}
        {!queue.length && !error && <p>No submissions for this walking area.</p>}
        {queue.length > 0 && <label className="block font-semibold">Route submission
            <select className={input} value={selectedId} onChange={event => {
                setSelectedId(event.target.value); setNote(''); setHours(queue.find(route => route.id === event.target.value)?.opening_hours ?? ''); setFieldChecked(false); setStatus('');
            }}>
                <option value="">Choose a route to review</option>
                {queue.map(route => <option value={route.id} key={route.id}>{route.title} · {communityStatusLabel(route)}</option>)}
            </select>
        </label>}
        {selected && <div className="space-y-3">
            <CommunityPathMap area={area} points={selected.path?.coordinates ?? selected.points} />
            <p className="break-words">{selected.notes}</p>
            <p className="text-sm">{selected.path ? `${selected.path.length_m} m on ${selected.path.edge_ids.length} mapped paths`
                : 'The proposal contains a gap or cannot be matched. Review it for a future map update.'} · Submitted {communityDate(selected.created_at)}</p>
            {selected.path && <details className="text-sm">
                <summary className="cursor-pointer min-h-11 font-semibold">Path IDs for field observations</summary>
                <p className="break-words">{selected.path.edge_ids.join(', ')}</p>
            </details>}
            {selected.review_note && <p className="text-sm">{selected.review_note} · {selected.reviewer}</p>}
            {selected.checked_at && <p className="text-sm">Field checked {communityDate(selected.checked_at)}. Review due {communityDate(selected.valid_until)}.</p>}
            {selected.status !== 'declined' && <form className="space-y-3" onSubmit={review}>
                <label className="block font-semibold">Reviewer team<input required className={input} maxLength={120} value={team} onChange={event => setTeam(event.target.value)} /></label>
                <label className="block font-semibold">Review note<textarea required className={input} maxLength={800} rows={2} value={note}
                    placeholder="Record public access, gates, route conditions or the reason for declining."
                    onChange={event => setNote(event.target.value)} /></label>
                {selected.published_at && <label className="block font-semibold">Checked public access hours
                    <input className={input} maxLength={160} value={hours} placeholder="24/7 or Mo-Fr 08:00-18:00" onChange={event => setHours(event.target.value)} />
                </label>}
                {selected.published_at && <label className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" className="h-5 w-5 shrink-0" checked={fieldChecked} onChange={event => setFieldChecked(event.target.checked)} />
                    We walked the full route and checked its connections, public access, gates and time restrictions.
                </label>}
                <div className="flex flex-wrap gap-2">
                    {selected.status === 'submitted' && <button type="submit" value="publish" className={button} disabled={busy || !selected.path}>Publish suggestion</button>}
                    {selected.published_at && <button type="submit" value="verify" className={button} disabled={busy || !fieldChecked || !hours.trim()}>Record field check</button>}
                    <button type="submit" value="decline" className={button} disabled={busy}>Decline route</button>
                </div>
            </form>}
        </div>}
    </section>;
}
