'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pause, Play, LocateFixed, Flag, Navigation, Route } from 'lucide-react';
import { addTrackFix } from '@/lib/walk-tracking';
import { destinationForVisit } from '@/lib/profile-activity';
import { DRAFT_KEY, type WalkSession, type CompletedWalk, type WalkFeedback as Feedback } from '@/lib/walk-library';
import { residentText, type ResidentLanguage, type ResidentLabel } from '@/lib/resident-language';
import { residentPlaceName, routeStepAt } from '@/lib/resident-walking';
import WalkFeedback from './WalkFeedback';

export default function WalkRecorder({ session, onComplete, onFeedback, onPosition, onNewWalk, onShareShortcut, language, voiceEnabled = false, panelControl, children }: { session: WalkSession;
    onComplete: (walk: CompletedWalk) => boolean; onFeedback: (id: string, feedback: Feedback) => boolean;
    onPosition: (point: [number, number]) => void; onNewWalk: () => void;
    onShareShortcut?: (walk: CompletedWalk) => void; language: ResidentLanguage; voiceEnabled?: boolean; panelControl: ReactNode; children?: ReactNode }) {
    const t = (label: ResidentLabel) => residentText(language, label);
    const [paused, setPaused] = useState(!!session.restored), [gps, setGps] = useState(false);
    const [base, setBase] = useState(session.elapsed_ms), [started, setStarted] = useState(Date.now), [clock, setClock] = useState(Date.now);
    const [track, setTrack] = useState(session.track), trackRef = useRef(session.track);
    const [message, setMessage] = useState(session.restored ? 'Your unfinished walk was restored and paused. Resume when you are ready.' : 'Timer started. GPS recording is optional and stays on this device.');
    const [confirm, setConfirm] = useState(false), [completed, setCompleted] = useState<CompletedWalk | null>(null), [saved, setSaved] = useState(false);
    const [reachedDestination, setReachedDestination] = useState(false);
    const visitDestination = destinationForVisit(session.pack);
    const lastSave = useRef(0);
    const progress = useRef(0);
    const [guidance, setGuidance] = useState<{ index: number; onRoute: boolean }>();
    const elapsed = base + (paused ? 0 : Math.max(0, clock - started));
    function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* Completed history is already saved. */ } }
    function pause(reason = 'Paused. Resume when you are ready.') {
        setBase(base + (paused ? 0 : Math.max(0, Date.now() - started))); setPaused(true);
        trackRef.current = { ...trackRef.current, last: null }; setTrack(trackRef.current); setMessage(reason);
    }
    function resume() { setStarted(Date.now()); setClock(Date.now()); setPaused(false); setMessage('Walk resumed.'); }
    useEffect(() => {
        if (paused) return;
        const timer = setInterval(() => setClock(Date.now()), 1000);
        const visibility = () => { if (document.hidden) { setBase(v => v + Math.max(0, Date.now() - started)); setPaused(true); trackRef.current = { ...trackRef.current, last: null }; setTrack(trackRef.current); setMessage('Paused while this page was hidden. Resume when ready; background tracking is not assumed.'); } };
        document.addEventListener('visibilitychange', visibility);
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
    }, [paused, started]);
    useEffect(() => {
        const timer=setTimeout(()=>{
            if (completed || (!paused && Date.now() - lastSave.current < 15000)) return;
            lastSave.current = Date.now();
            try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...session, elapsed_ms: elapsed, track, restored: true })); }
            catch { setMessage('The browser could not checkpoint this walk. Keep the page open and download a route pack if needed.'); }
        },0);
        return ()=>clearTimeout(timer);
    }, [elapsed, track, paused, completed, session]);
    useEffect(() => {
        if (completed) return;
        const before = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', before); return () => window.removeEventListener('beforeunload', before);
    }, [completed]);
    useEffect(() => {
        if (!gps || paused || completed) return;
        if (!navigator.geolocation) return;
        const watcher = navigator.geolocation.watchPosition(position => {
            const fix = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, at: position.timestamp };
            const next = addTrackFix(trackRef.current, fix); trackRef.current = next; setTrack(next);
            if (next.last?.at === fix.at) {
                onPosition([fix.lat, fix.lng]);
                const index = routeStepAt(session.pack.route, [fix.lat, fix.lng], progress.current);
                if (index !== null) progress.current = index;
                setGuidance({ index: progress.current, onRoute: index !== null });
            }
            setMessage(fix.accuracy <= 25 ? 'Recording usable GPS positions on this device.' : 'Location accuracy is low. This fix is excluded from your distance and pace.');
        }, () => { setGps(false); setMessage('Location recording is unavailable or permission was declined. Your timer still works.'); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
        return () => navigator.geolocation.clearWatch(watcher);
    }, [gps, paused, completed, onPosition, session.pack.route]);
    const lastSpoken = useRef<string | null>(null);
    useEffect(() => {
        if (!voiceEnabled || !gps || paused || completed || !guidance || !('speechSynthesis' in window)) {
            lastSpoken.current = null;
            return;
        }
        const key = guidance.onRoute ? `step:${guidance.index}` : 'off-route';
        if (lastSpoken.current === key) return;
        lastSpoken.current = key;
        const step = session.pack.route.steps?.[guidance.index];
        const crossing = session.pack.edges.some(edge => edge.id === step?.edge_id && edge.is_crossing);
        const named = step && !/^Footpath \d+$/i.test(step.name) ? step.name : null;
        const message = !guidance.onRoute ? residentText(language, 'Check your position on the map')
            : crossing ? [residentText(language, 'Crossings'), named].filter(Boolean).join('. ')
            : named ?? residentText(language, 'Follow the mapped route');
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = language === 'ms' ? 'ms-MY' : 'en-MY';
        utterance.rate = .9;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }, [voiceEnabled, gps, paused, completed, guidance, language, session.pack]);
    function finish() {
        const active = base + (paused ? 0 : Math.max(0, Date.now() - started));
        const result: CompletedWalk = { id: session.id, title: session.pack.title, started_at: session.started_at, finished_at: new Date().toISOString(),
            profile: session.pack.profile,area_id:session.pack.area_id??'elmina', active_ms: active, track: trackRef.current, planned_m: session.pack.route.length_m, planned_min: session.pack.route.total_min, feedback: null,
            ...(reachedDestination && visitDestination ? { confirmed_visit: visitDestination } : {}) };
        pause(); setGps(false); setConfirm(false); setCompleted(result);
        const ok = onComplete(result); setSaved(ok); if (ok) clearDraft();
    }
    if (completed) return <div className="tg-panel-body tg-stack" data-completed="true">
        <h1 className="tg-h2">{t('Walk finished')}</h1><p className="tg-note">{Math.floor(completed.active_ms / 60000)} min {Math.floor(completed.active_ms / 1000) % 60} {t('sec')} · {t('Active time')}{completed.track.distance_m ? ` · ${Math.round(completed.track.distance_m)} m GPS` : ''}</p>
        <p className="tg-small">Pauses are excluded. Planned distance was {Math.round(completed.planned_m)} m; a planned route is not proof that you walked that distance.</p>
        {!saved ? <><p className="tg-note tg-warnbox" role="status">This walk has not been saved. You can free space in Saved and retry.</p><button className="tg-btn" onClick={() => { const ok=onComplete(completed);setSaved(ok);if(ok)clearDraft(); }}>Retry saving this walk</button><button className="tg-btn" onClick={() => { if(window.confirm('Leave this finished walk without saving its history or feedback?')) { clearDraft();onNewWalk(); } }}>Finish without saving</button></> : <>
            <p className="tg-small" role="status">Saved in your device walk history.</p>
            {completed.confirmed_visit && <p className="tg-note">{t('Visit saved on this device.')}</p>}
            {onShareShortcut && <button type="button" className="tg-btn tg-btn-primary" onClick={() => onShareShortcut(completed)}><Route size={20} aria-hidden />{t('Share a local shortcut')}</button>}
            <WalkFeedback initial={null} onSave={feedback => onFeedback(completed.id, feedback)} />
            <button className="tg-btn" onClick={onNewWalk}>{t('Plan another walk')}</button>
        </>}
    </div>;
    const stepIndex = guidance?.index ?? 0;
    const current = session.pack.route.steps?.[stepIndex];
    const crossing = session.pack.edges.some(edge => edge.id === current?.edge_id && edge.is_crossing);
    const namedStep = current && !/^Footpath \d+$/i.test(current.name) ? current.name : null;
    const cue = paused ? t('Walk paused') : gps && guidance?.onRoute === false ? t('Check your position on the map')
        : crossing ? [t('Crossings'), namedStep].filter(Boolean).join(' · ') : namedStep ?? t('Follow the mapped route');
    return <>
        <div className="tg-walk-summary">
            <div className="tg-walk-cue">
                <Navigation size={23} aria-hidden />
                <div><p>{paused ? session.pack.title : `${t(stepIndex > 0 ? 'Next on your route' : 'First step')} · ${residentPlaceName(session.pack.route.destination)}`}</p><h1>{cue}</h1></div>
            </div>
            <button className="tg-btn tg-btn-primary" onClick={() => paused ? resume() : pause()}>{paused ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}{t(paused ? 'Resume walk' : 'Pause walk')}</button>
            {panelControl}
        </div>
        <div id="walk-recording-controls" className="tg-panel-body tg-stack">
            <p className="tg-note tg-walk-time"><strong aria-label={t('Active time')}>{Math.floor(elapsed / 60000)}:{String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}</strong> {t('Active time')}
                {track.distance_m > 0 && <span> · {Math.round(track.distance_m)} m {t('GPS distance')}</span>}</p>
            <p className="tg-small">{t('Planned walk')} · {Math.ceil(session.pack.route.total_min)} min · {Math.round(session.pack.route.length_m)} m</p>
            <p className="tg-small" role="status">{message}</p>
            <button className="tg-btn" onClick={() => {
                if (gps) { setGps(false); trackRef.current = { ...trackRef.current, last: null }; setTrack(trackRef.current); setMessage('GPS recording stopped. Your timer continues.'); }
                else if (!navigator.geolocation) setMessage('This browser cannot record GPS. The timer is still available.');
                else setGps(true);
            }}><LocateFixed size={20} aria-hidden />{t(gps ? 'Stop GPS recording' : 'Record GPS on this device')}</button>
            {confirm ? <div className="tg-note tg-stack">
                <p>{t('Save finished walk')}</p>
                {visitDestination && <label className="tg-visit-confirm">
                    <input type="checkbox" checked={reachedDestination} onChange={event => setReachedDestination(event.target.checked)} />
                    <span><strong>{t('I reached this place')}: {visitDestination.name}</strong>
                        <small>{t('Optional — adds a confirmed visit to your private profile.')}</small></span>
                </label>}
                <div className="grid gap-2">
                    <button className="tg-btn" onClick={() => { setConfirm(false); setReachedDestination(false); }}>{t('Keep walking')}</button>
                    <button className="tg-btn tg-btn-primary" onClick={finish}>{t('Save finished walk')}</button>
                </div>
            </div> : <button className="tg-btn" onClick={() => setConfirm(true)}><Flag size={20} aria-hidden />{t('Finish walk')}</button>}
            {children}
        </div>
    </>;
}
