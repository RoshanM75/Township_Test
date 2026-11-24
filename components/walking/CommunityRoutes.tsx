'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { loadCommunityRoutes, submitCommunityRoute } from '@/lib/api';
import { communityStatusLabel, matchCommunityPath, MAX_COMMUNITY_POINTS, publicRoutePoints,
    type CommunityDraft, type CommunityPath, type CommunityRoute, type RoutePoint } from '@/lib/community-routes';
import type { GraphData } from '@/lib/api';
import type { CompletedWalk } from '@/lib/walk-library';
import { addTrackFix, emptyTrack } from '@/lib/walk-tracking';
import { PILOTS, pointInPilot, type PilotId } from '@/lib/pilots';
import { IS_PAGES_PREVIEW } from '@/lib/site';
import type { StartPoint } from '@/lib/start-points';
import { residentText, type ResidentLanguage } from '@/lib/resident-language';

const Map = dynamic(() => import('@/components/map/InteractiveMap'), { ssr: false });
const draftKey = (area: PilotId) => `townshipgo:community-draft:${area}`;
const receiptKey = (area: PilotId) => `townshipgo:community-receipt:${area}`;

function readStored(key: string) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function readDraft(area: PilotId, dataset: string): CommunityDraft | null {
    try {
        const draft = JSON.parse(readStored(draftKey(area)) ?? 'null') as CommunityDraft | null;
        if (draft?.dataset_id === dataset && typeof draft.title === 'string' && typeof draft.notes === 'string' &&
            typeof draft.submission_id === 'string' && Array.isArray(draft.points) &&
            draft.points.length <= MAX_COMMUNITY_POINTS && draft.points.every(point => Array.isArray(point) &&
                point.length === 2 && point.every(Number.isFinite) && pointInPilot(point, area))) return draft;
    } catch { /* The editor can start a new draft. */ }
    return null;
}

export function CommunityPathMap({ area, points }: { area: PilotId; points: RoutePoint[] }) {
    return <div className="h-56 overflow-hidden rounded-xl border border-slate-300">
        <Map startCoords={points[0] ?? PILOTS[area].centre} endCoords={points.at(-1)}
            routes={points.length >= 2 ? [{ id: 'community', name: 'Community route', route_type: 'direct', coordinates: points }] : []}
            showLayerControls={false} reduceMotion />
    </div>;
}

interface Props {
    area: PilotId;
    dataset: string;
    graph: Pick<GraphData, 'nodes' | 'edges'>;
    walks: CompletedWalk[];
    startPoints: StartPoint[];
    routes: CommunityRoute[];
    now: string;
    onPlan: (route: CommunityRoute) => void;
    onShared: () => void;
    initialWalk?: CompletedWalk;
    initialRouteId?: string;
    onShare?: (route: CommunityRoute) => Promise<boolean>;
    language?: ResidentLanguage;
}

export default function CommunityRoutes({ area, dataset, graph, walks, startPoints, routes, now, onPlan, onShared, initialWalk, initialRouteId, onShare, language = 'en' }: Props) {
    const [editing, setEditing] = useState(!!initialWalk);
    const [fromWalk, setFromWalk] = useState(initialWalk);
    const [selected, setSelected] = useState<string | null>(initialRouteId ?? null);
    const [shareMessage, setShareMessage] = useState('');
    const [receipt, setReceipt] = useState(() => readStored(receiptKey(area)));
    const [mine, setMine] = useState<CommunityRoute | null>(null);
    const [receiptError, setReceiptError] = useState('');
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        if (!receipt || IS_PAGES_PREVIEW) return;
        let cancelled = false;
        void loadCommunityRoutes(area, receipt).then(({ routes }) => {
            if (!cancelled) { setMine(routes[0] ?? null); setReceiptError(''); }
        }).catch(() => { if (!cancelled) setReceiptError('Could not refresh your submission.'); });
        return () => { cancelled = true; };
    }, [receipt, area, refresh]);
    const nearby = routes.filter(route => route.dataset_id === dataset && route.path);
    const inspected = nearby.find(route => route.id === selected);
    if (editing) return <CommunityRouteEditor area={area} dataset={dataset} graph={graph} walks={walks} startPoints={startPoints} initialWalk={fromWalk} language={language}
        onExit={() => { setEditing(false); setFromWalk(undefined); }} onSubmitted={(route, submission) => {
            setMine(route); setReceipt(submission); setEditing(false); setFromWalk(undefined); onShared();
        }} />;
    return <div className="tg-stack">
        <button type="button" className="tg-btn tg-btn-primary" onClick={() => setEditing(true)}>
            {readDraft(area, dataset) ? 'Continue route draft' : 'Create a local route'}
        </button>
        {receipt && <section className="tg-note">
            <p className="font-bold">Your latest submission</p>
            {mine && <p>{mine.title} · {communityStatusLabel(mine, now)}</p>}
            {mine && <time className="tg-small" dateTime={mine.created_at}>{communityDate(mine.created_at)}</time>}
            {mine?.review_note && <p className="tg-small">{mine.review_note}</p>}
            {receiptError && <p role="alert">{receiptError}</p>}
            <button type="button" className="tg-text-action" onClick={() => setRefresh(value => value + 1)}>Refresh status</button>
        </section>}
        {IS_PAGES_PREVIEW ? <p className="tg-small">You can draw or record a route and save a draft on this device. Shared routes and reviews are available on the server app.</p>
            : <section className="tg-stack">
                <h3 className="tg-h2">Routes shared in this area</h3>
                {nearby.length === 0 && <p className="tg-small">{initialRouteId ? 'This shared shortcut is unavailable in the current map.' : 'Published routes will appear here after review.'}</p>}
                <ul className="tg-stack" aria-label="Published community routes">
                    {nearby.map(route => <li key={route.id}>
                        <button type="button" className="tg-card w-full" aria-pressed={inspected?.id === route.id}
                            onClick={() => { setShareMessage(''); setSelected(previous => previous === route.id ? null : route.id); }}>
                            <span className="min-w-0 break-words"><strong>{route.title}</strong>
                                <span className="tg-small block">{route.path?.length_m} m · {communityStatusLabel(route, now)}</span></span>
                        </button>
                    </li>)}
                </ul>
                {inspected?.path && <div className="tg-stack">
                    <CommunityPathMap area={area} points={inspected.path.coordinates} />
                    {inspected.notes && <p className="text-sm break-words">{inspected.notes}</p>}
                    <p className="tg-small">{inspected.review_note} {inspected.reviewer && `· ${inspected.reviewer}`}</p>
                    {inspected.opening_hours && <p className="tg-small">Checked public access hours · {inspected.opening_hours}</p>}
                    {inspected.checked_at && <p className="tg-small">Field checked {communityDate(inspected.checked_at)}. Review due {communityDate(inspected.valid_until)}.</p>}
                    {inspected.status === 'verified' && inspected.valid_until && Date.parse(inspected.valid_until) > Date.parse(now)
                        ? <button type="button" className="tg-btn tg-btn-primary" onClick={() => onPlan(inspected)}>Plan from this route’s start</button>
                        : <p className="tg-small">Navigation becomes available after a current field check.</p>}
                    {onShare && <button type="button" className="tg-btn" onClick={async () => {
                        const copied = await onShare(inspected);
                        setShareMessage(residentText(language, copied ? 'Copied shortcut link' : 'Copy link failed'));
                    }}>{residentText(language, 'Share shortcut')}</button>}
                    {shareMessage && <p className="tg-small" role="status">{shareMessage}</p>}
                </div>}
            </section>}
    </div>;
}

export function communityDate(value: string | null) {
    return value ? new Date(value).toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium' }) : '';
}

function CommunityRouteEditor({ area, dataset, graph, walks, startPoints, initialWalk, language = 'en', onExit, onSubmitted }: Pick<Props, 'area' | 'dataset' | 'graph' | 'walks' | 'startPoints' | 'initialWalk' | 'language'> & {
    onExit: () => void;
    onSubmitted: (route: CommunityRoute, submission: string) => void;
}) {
    const [draft] = useState(() => initialWalk ? null : readDraft(area, dataset));
    const [trace] = useState<RoutePoint[]>(() => {
        if (!initialWalk || (initialWalk.area_id ?? 'elmina') !== area) return [];
        const fixes = initialWalk.track.fixes.flatMap(({ lat, lng }): RoutePoint[] => pointInPilot([lat, lng], area) ? [[lat, lng]] : []);
        return fixes.length >= 4 ? fixes : [];
    });
    const [title, setTitle] = useState(draft?.title ?? '');
    const [notes, setNotes] = useState(draft?.notes ?? '');
    const [points, setPoints] = useState<RoutePoint[]>(draft?.points ?? trace);
    const [trimStart, setTrimStart] = useState(trace.length ? 1 : 0);
    const [trimEnd, setTrimEnd] = useState(trace.length ? 1 : 0);
    const [recording, setRecording] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(initialWalk ? (trace.length
        ? 'Review the public part of your recording and trim any private stops.'
        : 'Draw the public shortcut you walked on the map.') : '');
    const [preview, setPreview] = useState<CommunityPath | null | undefined>(undefined);
    const lastDraft = useRef(draft);
    const track = useRef(emptyTrack());
    const watch = useRef<number | null>(null);
    const publicPoints = useMemo(() => publicRoutePoints(points, trimStart, trimEnd), [points, trimStart, trimEnd]);
    const completed = walks.filter(walk => (walk.area_id ?? 'elmina') === area && walk.track.fixes.length >= 4);
    useEffect(() => () => { if (watch.current !== null) navigator.geolocation.clearWatch(watch.current); }, []);

    function loadPoints(next: RoutePoint[], trim: number) {
        setPoints(next);
        setTrimStart(trim);
        setTrimEnd(trim);
        setConfirmed(false);
        setPreview(undefined);
    }

    function addPoint(point: RoutePoint) {
        if (!pointInPilot(point, area)) { setMessage('Choose a waypoint inside the current walking area.'); return; }
        if (publicPoints.length >= MAX_COMMUNITY_POINTS) { setMessage('The draft has reached 48 waypoints. Remove a point to continue.'); return; }
        loadPoints([...publicPoints, point], 0);
        setMessage('');
    }

    function stopRecording() {
        if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
        setRecording(false);
        const fixes = track.current.fixes;
        if (fixes.length < 4) { setMessage('Recording needs at least four usable location points. You can also draw a route.'); return; }
        loadPoints(fixes.map(fix => [fix.lat, fix.lng]), 1);
        setMessage('Trim private sections before sharing your walk.');
    }

    function startRecording() {
        if (!navigator.geolocation) { setMessage('Location recording is unavailable on this device.'); return; }
        track.current = emptyTrack();
        setRecording(true);
        setMessage('Recording on this device…');
        watch.current = navigator.geolocation.watchPosition(position => {
            const { latitude: lat, longitude: lng, accuracy } = position.coords;
            if (!pointInPilot([lat, lng], area)) return;
            track.current = addTrackFix(track.current, { lat, lng, accuracy, at: position.timestamp });
            setMessage(`Recording on this device · ${track.current.fixes.length} usable points`);
        }, () => {
            if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
            watch.current = null;
            setRecording(false);
            setMessage('Location recording is unavailable. Check location access or add waypoints.');
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 });
    }

    function currentDraft(): CommunityDraft {
        const payload = { dataset_id: dataset, title: title.trim(), notes: notes.trim(), points: publicPoints };
        const previous = lastDraft.current;
        if (previous && previous.title === payload.title && previous.notes === payload.notes &&
            JSON.stringify(previous.points) === JSON.stringify(payload.points)) return previous;
        return { ...payload, submission_id: crypto.randomUUID() };
    }

    function saveDraft() {
        const next = currentDraft();
        try {
            localStorage.setItem(draftKey(area), JSON.stringify(next));
            lastDraft.current = next;
            setMessage('Draft saved on this device.');
        } catch { setMessage('This browser could not save the draft.'); }
    }

    async function submit() {
        if (!confirmed || busy || recording || publicPoints.length < 2 || !title.trim()) return;
        setBusy(true);
        const next = currentDraft();
        lastDraft.current = next;
        try {
            // Retain the same submission identifier if a connection drops after the server saves it.
            try { localStorage.setItem(draftKey(area), JSON.stringify(next)); } catch { /* Device storage is optional. */ }
            const { route } = await submitCommunityRoute(area, next);
            try {
                localStorage.setItem(receiptKey(area), next.submission_id);
                localStorage.removeItem(draftKey(area));
            } catch { /* The receipt is still visible until the panel closes. */ }
            onSubmitted(route, next.submission_id);
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not share your route.'); }
        finally { setBusy(false); }
    }

    const line = preview?.coordinates ?? publicPoints;
    return <div className="tg-stack">
        <button type="button" className="tg-text-action self-start" onClick={onExit}>Back to community routes</button>
        <label className="tg-label">{residentText(language, 'Route name')}<input className="tg-input" maxLength={100} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="tg-label">{residentText(language, 'Local notes')}<textarea className="tg-input" maxLength={800} rows={2} value={notes}
            placeholder="For example, the covered shortcut between the station and market"
            onChange={event => setNotes(event.target.value)} /></label>
        <fieldset disabled={recording || busy} className="tg-stack">
            <legend className="tg-label">Build the route in walking order</legend>
            <p className="tg-small">Add close-together waypoints along the public paths you use.</p>
            <div className="h-56 overflow-hidden rounded-xl border border-slate-300">
                <Map startCoords={line[0] ?? PILOTS[area].centre} endCoords={line.at(-1)} showLayerControls={false} reduceMotion
                    routes={line.length >= 2 ? [{ id: 'draft', name: 'Route draft', route_type: 'direct', coordinates: line }] : []}
                    selectedLocation={line.at(-1)} onLocationSelect={recording || busy ? undefined : (lat, lng) => addPoint([lat, lng])} />
            </div>
            {startPoints.length > 0 && <label className="tg-label">Add a mapped waypoint
                <select value="" className="tg-input" onChange={event => {
                    const point = startPoints.find(place => place.id === event.target.value);
                    if (point) addPoint(point.coordinates);
                }}>
                    <option value="">Choose a mapped place</option>
                    {startPoints.map(point => <option key={point.id} value={point.id}>{point.label}</option>)}
                </select>
            </label>}
            {completed.length > 0 && <label className="tg-label">Use a recorded walk
                <select value="" className="tg-input" onChange={event => {
                    const walk = completed.find(item => item.id === event.target.value);
                    if (walk) loadPoints(walk.track.fixes.map(fix => [fix.lat, fix.lng]), 1);
                }}>
                    <option value="">Choose a walk saved on this device</option>
                    {completed.map(walk => <option key={walk.id} value={walk.id}>{walk.title} · {communityDate(walk.finished_at)}</option>)}
                </select>
            </label>}
        </fieldset>
        <button type="button" className="tg-btn" disabled={busy} onClick={recording ? stopRecording : startRecording}>
            {recording ? 'Stop GPS recording' : 'Record GPS route'}
        </button>
        {points.length > 0 && <fieldset className="tg-stack" disabled={recording || busy}>
            <legend className="tg-label">Keep only public waypoints</legend>
            <p className="tg-small">{publicPoints.length} waypoints will be shared. Trim any private stops from either end.</p>
            <div className="grid grid-cols-2 gap-2">
                <label className="tg-label">Trim from start<input type="number" className="tg-input" min={0} max={Math.max(0, points.length - trimEnd - 2)}
                    value={trimStart} onChange={event => {
                        setTrimStart(Math.max(0, Math.min(points.length - trimEnd - 2, Number(event.target.value) || 0)));
                        setConfirmed(false); setPreview(undefined);
                    }} /></label>
                <label className="tg-label">Trim from end<input type="number" className="tg-input" min={0} max={Math.max(0, points.length - trimStart - 2)}
                    value={trimEnd} onChange={event => {
                        setTrimEnd(Math.max(0, Math.min(points.length - trimStart - 2, Number(event.target.value) || 0)));
                        setConfirmed(false); setPreview(undefined);
                    }} /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <button type="button" className="tg-btn" disabled={!publicPoints.length} onClick={() => loadPoints(publicPoints.slice(0, -1), 0)}>Undo last point</button>
                <button type="button" className="tg-btn" disabled={publicPoints.length < 2}
                    onClick={() => setPreview(matchCommunityPath(graph.nodes, graph.edges, publicPoints))}>Check path match</button>
            </div>
            {preview !== undefined && <p role="status" className="tg-note">{preview ? `${preview.length_m} m matched to mapped paths. A reviewer still checks public access.`
                : 'Some waypoints could not be matched to a continuous path. Add closer waypoints or submit for a mapping review.'}</p>}
        </fieldset>}
        {message && <p role="status" className="tg-note">{message}</p>}
        {!IS_PAGES_PREVIEW && <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5 shrink-0" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            My waypoints and notes contain only places the public can use.
        </label>}
        <button type="button" className="tg-btn" disabled={busy || recording} onClick={saveDraft}>{residentText(language, 'Save draft on this device')}</button>
        {!IS_PAGES_PREVIEW && <button type="button" className="tg-btn tg-btn-primary" disabled={!confirmed || !title.trim() || publicPoints.length < 2 || busy || recording}
            onClick={() => void submit()}>{residentText(language, busy ? 'Saving…' : 'Submit for review')}</button>}
    </div>;
}
