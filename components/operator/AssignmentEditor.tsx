'use client';

import { useEffect, useState } from 'react';
import { loadAssignmentHistory, updateReportAssignment } from '@/lib/api';
import type { Assignment } from '@/lib/operator';
import type { PilotId } from '@/lib/pilots';
import type { MaintenanceDefect } from '@/lib/types';

type Props = { report: MaintenanceDefect; area: PilotId; reviewerKey: string; onSaved: (report: MaintenanceDefect) => void };
const input = 'mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3';

export default function AssignmentEditor(props: Props) {
    const { report, area, reviewerKey } = props;
    const [opened, setOpened] = useState(false);
    const [history, setHistory] = useState<Assignment[]>([]);
    const [error, setError] = useState('');
    const id = String(report.id), version = report.assignment_version;
    useEffect(() => {
        if (!opened) return;
        let cancelled = false;
        void loadAssignmentHistory(area, reviewerKey, id).then(({ history }) => {
            if (!cancelled) { setHistory(history); setError(''); }
        }).catch(() => { if (!cancelled) setError('The assignment history could not be loaded.'); });
        return () => { cancelled = true; };
    }, [area, id, opened, reviewerKey, version]);
    return <details className="rounded-xl border border-slate-300 p-3" onToggle={event => setOpened(event.currentTarget.open)}>
        <summary className="cursor-pointer font-bold">Assign work</summary>
        <AssignmentForm key={version ?? 0} {...props} />
        {error && <p className="mt-3 text-sm text-red-800" role="status">{error}</p>}
        {history.length > 0 && <ol className="mt-3 space-y-2 border-t border-slate-200 pt-2 text-sm text-slate-600" aria-label="Assignment history">
            {history.map(event => <li key={event.version}>
                <strong>{event.team || 'Unassigned'}</strong> · {new Date(event.assigned_at).toLocaleString('en-MY',
                    { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })}
                <p>{event.source === 'responsibility' ? 'Matched the mapped responsibility' : event.source === 'review' ? 'Assigned during review' : 'Assignment updated'}
                    {event.due_on && ` · Due ${event.due_on}`}{event.work_order_ref && ` · ${event.work_order_ref}`}</p>
            </li>)}
        </ol>}
    </details>;
}

function AssignmentForm({ report, area, reviewerKey, onSaved }: Props) {
    const [team, setTeam] = useState(report.responsible_team ?? '');
    const [due, setDue] = useState(report.due_on ?? '');
    const [ref, setRef] = useState(report.work_order_ref ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    return <form className="mt-3 space-y-3 text-sm" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const result = await updateReportAssignment(area, reviewerKey, String(report.id), {
                team: team.trim() || null, due_on: due || null, work_order_ref: ref.trim() || null,
                version: report.assignment_version ?? 0,
            });
            onSaved(result.report);
        } catch (err) { setError(err instanceof Error ? err.message : 'The assignment could not be saved.'); }
        finally { setBusy(false); }
    }}>
        <label className="block font-semibold">Assign to team<input className={input} maxLength={120} value={team}
            placeholder="Unassigned" onChange={event => setTeam(event.target.value)} /></label>
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-2">
            <label className="min-w-0 font-semibold">Due date<input type="date" className={input} value={due} onChange={event => setDue(event.target.value)} /></label>
            <label className="min-w-0 font-semibold">Work order reference<input className={input} maxLength={120} value={ref} onChange={event => setRef(event.target.value)} /></label>
        </div>
        {error && <p role="alert" className="text-red-800">{error}</p>}
        <button disabled={busy} className="min-h-11 rounded-lg bg-slate-800 px-3 font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save assignment'}</button>
    </form>;
}
