'use client';
import { useEffect, useState } from 'react';
import { Download, Bookmark, Trash2 } from 'lucide-react';
import type { WalkLibrary, WalkPack, WalkFeedback as Feedback, ConditionUpdate } from '@/lib/walk-library';
import type { Profile } from '@/lib/routing';
import { downloadPack } from '@/lib/offline-walk';
import { routeSketch } from '@/lib/walk-timeline';
import { sitePath, IS_PAGES_PREVIEW } from '@/lib/site';
import PaceCalibration from './PaceCalibration';
import WalkFeedback from './WalkFeedback';
import { PILOTS, type PilotId } from '@/lib/pilots';
import type { MaintenanceDefect } from '@/lib/types';
import { checkedRouteReports } from '@/lib/report-status';

export default function SavedWalks({ library, profile, pace, area, reports, onChange, onReplan, onFeedback, onUsePace, onShare }: { library: WalkLibrary; profile: Profile; pace: number | null; area: PilotId; reports: MaintenanceDefect[];
    onChange: (library: WalkLibrary) => boolean; onReplan: (pack: WalkPack) => void; onFeedback: (id: string, value: Feedback) => boolean; onUsePace: (speed: number) => void; onShare: (value: ConditionUpdate) => Promise<boolean> }) {
    const [selected, setSelected] = useState<string | null>(null), [message, setMessage] = useState('');
    const [now, setNow] = useState(Date.now);
    useEffect(() => { const timer=setInterval(()=>setNow(Date.now()),60000);return ()=>clearInterval(timer); }, []);
    const pack = library.packs.find(p => p.id === selected);
    function remove(kind: 'packs' | 'history' | 'updates', id: string) {
        if (window.confirm('Remove this item from this device? Any report already shared remains in the server record.')) onChange({ ...library, [kind]: library[kind].filter(item => item.id !== id) });
    }
    if (pack) {
        const changes = (pack.area_id ?? 'elmina') === area ? checkedRouteReports(pack.route, reports) : [];
        const sketch=routeSketch(pack.route.coordinates);return <div className="tg-stack">
        <button className="tg-btn" onClick={() => setSelected(null)}>Back to Saved</button><h1 className="tg-h2">{pack.title}</h1>
        <p className="tg-note tg-warnbox">{PILOTS[pack.area_id??'elmina'].short_name} · saved snapshot · {new Date(pack.saved_at).toLocaleDateString('en-MY')}. Recheck conditions before setting out. A saved route rating does not establish current conditions.</p>
        <p className="tg-small">Network snapshot: {pack.network_snapshot_at ? new Date(pack.network_snapshot_at).toLocaleDateString('en-MY') : 'date not provided'}. Condition records loaded: {new Date(pack.data_at).toLocaleDateString('en-MY')}; individual observations retain their own dates.</p>
        {changes.length > 0 && <p className="tg-note tg-warnbox" role="status">{changes.length} checked report{changes.length === 1 ? '' : 's'} on this walk.
            Review current conditions before leaving.</p>}
        <svg viewBox="0 0 600 340" role="img" aria-label="Saved route sketch, north is up" className="w-full rounded-xl bg-[#e9eee6]"><polyline points={sketch.points} fill="none" stroke="#a4262c" strokeWidth={5} /><circle cx={sketch.start[0]} cy={sketch.start[1]} r={7} fill="#166534" /></svg>
        <p className="tg-small">{Math.ceil(pack.route.total_min)} min estimated · {Math.round(pack.route.length_m)} m · {pack.route.rest_min} min planned rest. Route sketch: © OpenStreetMap contributors, ODbL.</p>
        <button className="tg-btn tg-btn-primary" onClick={() => onReplan(pack)}>Check this walk with current data</button>
        <button className="tg-btn" onClick={() => downloadPack(pack)}><Download size={20} aria-hidden />Download offline walk pack</button>
        <p className="tg-small">The downloaded HTML file opens without internet and includes the route sketch, instructions, nearby facilities and dated condition records. Street-map tiles are not downloaded.</p>
        <a className="tg-btn" href={sitePath('/offline-walks.html')}>Open offline walk collection</a>
        <button className="tg-btn" onClick={() => remove('packs',pack.id)}><Trash2 size={18} aria-hidden />Remove saved pack</button>
    </div>; }
    return <div className="tg-stack">
        <h1 className="tg-h2">Saved for your next walk</h1><p className="tg-small">Walk packs, history and feedback stay in this browser on this device. Clearing site data removes them; download packs you want to keep.</p>
        {library.packs.length ? <ul className="space-y-3">{library.packs.map(p => <li key={p.id} className="rounded-xl border-2 border-slate-200 p-3"><h2 className="font-bold">{p.title}</h2><p className="text-sm">{Math.ceil(p.route.total_min)} min estimated · saved {new Date(p.saved_at).toLocaleDateString('en-MY')}</p><button className="tg-btn mt-2" onClick={() => setSelected(p.id)}><Bookmark size={18} aria-hidden />Open saved pack</button></li>)}</ul>
            : <p className="tg-note">No saved walks yet. Choose a route in Plan, then select “Save walk for offline”.</p>}
        <PaceCalibration history={library.history} profile={profile} current={pace} onUse={onUsePace} />
        <details className="rounded-xl border-2 border-slate-300 p-3"><summary className="min-h-8 cursor-pointer font-bold">Walk history · {library.history.length}</summary>
            {!library.history.length && <p className="mt-3 text-sm">Finish a walk to see your active time and optional comfort feedback here.</p>}
            <ul className="mt-3 space-y-3">{library.history.map(w => <li className="rounded-xl border border-slate-300 p-3" key={w.id}><h2 className="font-bold">{w.title}</h2><p className="mt-1 text-sm">{new Date(w.finished_at).toLocaleDateString('en-MY')} · {Math.floor(w.active_ms / 60000)} min {Math.floor(w.active_ms / 1000)%60} sec active{w.track.distance_m ? ` · ${Math.round(w.track.distance_m)} m GPS` : ' · timer only'}</p>
                <details className="mt-3"><summary className="min-h-11 cursor-pointer text-sm font-bold">{w.feedback ? 'View or edit comfort feedback' : 'Add comfort feedback'}</summary><WalkFeedback initial={w.feedback} onSave={value => onFeedback(w.id,value)} /></details>
                <button className="mt-2 min-h-11 text-sm font-bold underline" onClick={() => remove('history',w.id)}>Remove history item</button>
            </li>)}</ul>
        </details>
        <details className="rounded-xl border-2 border-slate-300 p-3"><summary className="min-h-8 cursor-pointer font-bold">Your condition reports · {library.updates.length}</summary>
            <ul className="mt-3 space-y-3">{library.updates.map(u => <li key={u.id} className="rounded-xl border border-slate-300 p-3"><h2 className="text-sm font-bold">{u.name} · {u.kind.replaceAll('_',' ')}</h2><p className="text-xs">Reported {new Date(u.observed_at).toLocaleString('en-MY')} · {u.shared_at ? 'Shared, awaiting review' : 'Only on this device'}{Date.parse(u.valid_until)<=now?' · review overdue':''}. Not field-verified.</p>{u.notes&&<p className="mt-2 text-sm">{u.notes}</p>}
                {!IS_PAGES_PREVIEW && !u.shared_at && <button className="tg-btn mt-2" onClick={() => void onShare(u).then(ok=>setMessage(ok?'Report shared, awaiting review.':'Sharing failed. Your device copy is kept.'))}>Share this report</button>}
                <button className="min-h-11 text-sm font-bold underline" onClick={() => remove('updates',u.id)}>Remove device copy</button>
            </li>)}</ul>{!library.updates.length&&<p className="mt-3 text-sm">No personal condition reports yet.</p>}
        </details><p className="text-sm" role="status">{message}</p>
    </div>;
}
