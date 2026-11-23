'use client';
import { useEffect, useState, Suspense, type FormEvent } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { loadGraph, loadWalkingData, createWalkingAsset, recordVerification, type GraphData } from '@/lib/api';
import { useClientReady } from '@/lib/use-client-ready';
import { observationFields } from '@/lib/verification-fields';
import { malaysiaInput, fromMalaysiaInput } from '@/lib/comfort';
import type { WalkingData, VerificationTarget, AssetKind, PlaceCategory, ObservationValue } from '@/lib/walking';
import { IS_PAGES_PREVIEW } from '@/lib/site';
import VerificationPreview from '@/components/walking/VerificationPreview';
import { PILOTS,pilotFromParams,type PilotId } from '@/lib/pilots';
import PilotSelector from '@/components/walking/PilotSelector';
import PilotSources from '@/components/walking/PilotSources';
import ReviewerAccess, { useReviewerKey } from '@/components/review/ReviewerAccess';
import CommunityReview from '@/components/review/CommunityReview';

const Map = dynamic(() => import('@/components/map/InteractiveMap'), { ssr: false });
const control = 'mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-900';
const button = 'min-h-11 rounded-xl bg-[#A4262C] px-4 py-3 font-bold text-white disabled:opacity-50';

function VerificationWorkspace({area}:{area:PilotId}) {
    const router=useRouter();
    const [reviewerKey, setReviewerKey] = useReviewerKey();
    const [data, setData] = useState<WalkingData | null>(null);
    const [graph, setGraph] = useState<GraphData | null>(null);
    const [version, setVersion] = useState(0);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [target, setTarget] = useState<VerificationTarget>('path');
    const [targetId, setTargetId] = useState('');
    const [status, setStatus] = useState('reported');
    const [method, setMethod] = useState('site_visit');
    const [reviewer, setReviewer] = useState('');
    const [observed, setObserved] = useState(() => malaysiaInput(new Date().toISOString()));
    const [reviewDate, setReviewDate] = useState(() => malaysiaInput(new Date(Date.now() + 90 * 86400000).toISOString()).slice(0, 10));
    const [source, setSource] = useState('');
    const [notes, setNotes] = useState('');
    const [values, setValues] = useState<Record<string, string>>({});
    const [asset, setAsset] = useState({ name: '', kind: 'destination' as AssetKind, category: 'other' as PlaceCategory, parent_id: '', lat: '', lng: '', source_ref: '' });
    useEffect(() => {
        async function refresh() {
            try { const [g, d] = await Promise.all([loadGraph(area), loadWalkingData(area)]); setGraph(g); setData(d); }
            catch (e) { setError(e instanceof Error ? e.message : 'Could not load records.'); }
        }
        void refresh();
    }, [version,area]);
    const fields = observationFields(target);
    const targets = target === 'path' || target === 'crossing'
        ? (graph?.edges ?? []).filter(e => Boolean(e.is_crossing) === (target === 'crossing')).map(e => ({ id: String(e.id), name: `${e.name || 'Footpath'} · ${e.id}` }))
        : (data?.assets ?? []).filter(a => target === 'entrance' ? a.kind === 'entrance' : ['destination', 'rest', 'shelter', 'toilet', 'water', 'transit'].includes(a.kind)).map(a => ({ id: a.id, name: a.name }));
    async function saveObservation(event: FormEvent) {
        event.preventDefault(); setBusy(true); setError(''); setMessage('');
        try {
            const attributes: Record<string, ObservationValue> = {};
            for (const field of fields) {
                const value = values[field.key]; if (!value) continue;
                attributes[field.key] = field.kind === 'boolean' ? value === 'true' : field.kind === 'number' ? Number(value) / (field.percent ? 100 : 1) : value;
            }
            const instant = fromMalaysiaInput(observed);
            if (!instant) throw new Error('Choose the observation time.');
            await recordVerification({area_id:area, target_type: target, target_id: targetId, status, method, reviewer, observed_at: instant,
                valid_until: status === 'verified' ? new Date(`${reviewDate}T23:59:59+08:00`).toISOString() : null,
                source_ref: source, notes, attributes }, reviewerKey);
            setMessage('Observation saved. Refresh the walking planner to use the latest checks.'); setValues({}); setNotes(''); setVersion(v => v + 1);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the observation.'); }
        finally { setBusy(false); }
    }
    async function saveAsset(event: FormEvent) {
        event.preventDefault(); setBusy(true); setError(''); setMessage('');
        try {
            const result = await createWalkingAsset({ ...asset,area_id:area, lat: Number(asset.lat), lng: Number(asset.lng), parent_id: asset.kind === 'entrance' ? asset.parent_id : null }, reviewerKey);
            setMessage('Mapped point saved as unverified. Add an observation to confirm its actual condition.');
            if (asset.kind !== 'destination') { setTarget(asset.kind === 'entrance' ? 'entrance' : 'facility'); setTargetId(result.id); }
            setAsset({ ...asset, name: '' }); setVersion(v => v + 1);
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the mapped point.'); }
        finally { setBusy(false); }
    }
    const history = (data?.verifications ?? []).filter(r => !targetId || (r.target_id === targetId && r.target_type === target)).slice(0, 30);
    return <main className="min-h-screen bg-slate-50 px-4 py-6 font-sans text-slate-900 md:px-8">
        <div className="mx-auto max-w-6xl space-y-6">
            <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-extrabold">Walking verification records</h1><p className="mt-2 max-w-3xl text-slate-600">Record what was actually observed on paths, crossings, access points and rest facilities. A mapped or reported feature stays unverified until a dated check confirms its condition.</p></div>
                <nav className="flex gap-4 font-bold underline"><Link href={`/resident?area=${area}`}>Plan a walk</Link><Link href={`/dashboard?area=${area}`}>Maintenance</Link></nav>
            </header>
            <PilotSelector area={area} onChange={next=>router.replace(`?area=${next}`)}/>
            <PilotSources area={area}/>
            <ReviewerAccess reviewerKey={reviewerKey} onKey={setReviewerKey} />
            <CommunityReview area={area} reviewerKey={reviewerKey} />
            {error && <p role="alert" className="rounded-xl border border-red-400 bg-red-50 p-4 text-red-900">{error}</p>}
            {message && <p role="status" className="rounded-xl border border-green-400 bg-green-50 p-4 text-green-900">{message}</p>}
            {!data && <p role="status">Loading walking records…</p>}
            <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-2xl border border-slate-300 bg-white p-5">
                    <h2 className="text-xl font-bold">Add a place or facility</h2><p className="mt-2 text-sm text-slate-600">Click the map to choose a position, or enter coordinates. Connecting to a nearby path is a geometric suggestion, not a verified physical link.</p>
                    <div className="my-4 h-72 overflow-hidden rounded-xl border border-slate-300"><Map startCoords={PILOTS[area].centre} onLocationSelect={(lat, lng) => setAsset(a => ({ ...a, lat: lat.toFixed(7), lng: lng.toFixed(7) }))} selectedLocation={asset.lat && asset.lng ? [Number(asset.lat), Number(asset.lng)] : undefined} assets={data?.assets.slice(0,120) ?? []} /></div>
                    <form onSubmit={saveAsset} className="space-y-3">
                        <label className="block text-sm font-semibold">Name<input required maxLength={120} className={control} value={asset.name} onChange={e => setAsset({ ...asset, name: e.target.value })} /></label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-sm font-semibold">Type<select className={control} value={asset.kind} onChange={e => setAsset({ ...asset, kind: e.target.value as AssetKind })}>
                                {(['destination','entrance','rest','shelter','toilet','water','transit'] as AssetKind[]).map(k => <option key={k} value={k}>{k === 'rest' ? 'Rest facility / seating' : k === 'entrance' ? 'Entrance / access point' : k.replaceAll('_',' ')}</option>)}</select></label>
                            <label className="text-sm font-semibold">Category<select className={control} value={asset.category} onChange={e => setAsset({ ...asset, category: e.target.value as PlaceCategory })}>
                                {['healthcare','food','park','community','shopping','transport','other'].map(k => <option key={k}>{k}</option>)}</select></label>
                        </div>
                        {asset.kind === 'entrance' && <label className="block text-sm font-semibold">Destination this entrance serves<select required className={control} value={asset.parent_id} onChange={e => setAsset({ ...asset, parent_id: e.target.value })}><option value="">Choose a destination</option>{data?.assets.filter(a => ['destination','transit'].includes(a.kind)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
                        <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Latitude<input required type="number" step="any" min={-90} max={90} className={control} value={asset.lat} onChange={e => setAsset({ ...asset, lat: e.target.value })} /></label>
                            <label className="text-sm font-semibold">Longitude<input required type="number" step="any" min={-180} max={180} className={control} value={asset.lng} onChange={e => setAsset({ ...asset, lng: e.target.value })} /></label></div>
                        <label className="block text-sm font-semibold">Source reference<input maxLength={500} className={control} value={asset.source_ref} onChange={e => setAsset({ ...asset, source_ref: e.target.value })} /></label>
                        <button disabled={busy || !reviewerKey} className={button}>Save unverified mapped point</button>
                    </form>
                </section>
                <section className="rounded-2xl border border-slate-300 bg-white p-5">
                    <h2 className="text-xl font-bold">Record an observation</h2>
                    <form onSubmit={saveObservation} className="mt-4 space-y-3">
                        <label className="block text-sm font-semibold">What was checked?<select className={control} value={target} onChange={e => { setTarget(e.target.value as VerificationTarget); setTargetId(''); setValues({}); }}>
                            {['path','crossing','entrance','facility'].map(t => <option key={t}>{t}</option>)}</select></label>
                        <label className="block text-sm font-semibold">Target<select required className={control} value={targetId} onChange={e => { setTargetId(e.target.value); setValues({}); }}><option value="">Choose a mapped target</option>{targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                        <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Status<select className={control} value={status} onChange={e => setStatus(e.target.value)}><option value="reported">Reported — not confirmed</option><option value="verified">Verified observation</option><option value="unverified">Unverified information</option></select></label>
                            <label className="text-sm font-semibold">Method<select className={control} value={method} onChange={e => setMethod(e.target.value)}><option value="site_visit">Site visit</option><option value="photo_review">Photo review</option><option value="operator_record">Operator record</option><option value="osm_import">OSM information</option></select></label></div>
                        <label className="block text-sm font-semibold">Auditor or team label<input required maxLength={80} className={control} value={reviewer} onChange={e => setReviewer(e.target.value)} /></label>
                        <label className="block text-sm font-semibold">Observed at (Malaysia)<input required type="datetime-local" className={control} value={observed} onChange={e => setObserved(e.target.value)} /></label>
                        {status === 'verified' && <label className="block text-sm font-semibold">Review due<input required type="date" className={control} value={reviewDate} onChange={e => setReviewDate(e.target.value)} /><span className="mt-1 block text-xs font-normal text-slate-600">A review deadline, not a guarantee that conditions remain unchanged.</span></label>}
                        <fieldset className="grid grid-cols-1 gap-3 rounded-xl border border-slate-300 p-3 sm:grid-cols-2"><legend className="px-2 text-sm font-bold">Observed conditions — leave unknown fields blank</legend>
                            {fields.map(field => <label key={field.key} className="text-sm">{field.label}{field.kind === 'boolean' || field.kind === 'choice'
                                ? <select className={control} value={values[field.key] ?? ''} onChange={e => setValues({ ...values, [field.key]: e.target.value })}><option value="">Unknown / not recorded</option>{field.kind === 'boolean' ? <><option value="true">Yes</option><option value="false">No</option></> : field.options?.map(v => <option key={v}>{v}</option>)}</select>
                                : <input className={control} type={field.kind === 'number' ? 'number' : 'text'} min={field.min} max={field.max} step={field.kind === 'number' && field.key !== 'surface_rating' ? 'any' : 1} maxLength={100} value={values[field.key] ?? ''} onChange={e => setValues({ ...values, [field.key]: e.target.value })} />}</label>)}
                        </fieldset>
                        <label className="block text-sm font-semibold">Evidence reference<input className={control} maxLength={500} value={source} onChange={e => setSource(e.target.value)} /></label>
                        <label className="block text-sm font-semibold">Notes<textarea className={control} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
                        <button disabled={busy || !data} className={button}>Save observation</button>
                    </form>
                </section>
            </div>
            <section className="rounded-2xl border border-slate-300 bg-white p-5"><h2 className="text-xl font-bold">Observation history</h2><p className="mt-2 text-sm text-slate-600">New observations append to the history. The newest observation for each condition takes precedence, and expired checks stay visible.</p>
                {!history.length && <p className="mt-4">No observations recorded for this selection.</p>}
                <ul className="mt-4 space-y-3">{history.map(r => <li key={r.id} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-bold">{r.target_type} {r.target_id} · {r.status === 'verified' && r.valid_until && Date.parse(r.valid_until) <= Date.parse(data!.as_of) ? 'Review overdue' : r.status}</p>
                    <p>{new Date(r.observed_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })} · {r.reviewer} · {r.method.replaceAll('_',' ')}</p>
                    <p className="mt-1">{Object.entries(r.attributes).map(([k,v]) => `${k.replaceAll('_',' ')}: ${v}`).join(' · ')}</p>{r.notes && <p>{r.notes}</p>}{r.source_ref && <p>Reference: {r.source_ref}</p>}{r.valid_until && <p>Review due: {new Date(r.valid_until).toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}</p>}
                </li>)}</ul>
            </section>
        </div>
    </main>;
}
export default function VerificationPage() {
    const ready = useClientReady();
    return ready ? (IS_PAGES_PREVIEW ? <VerificationPreview /> : <Suspense fallback={<p role="status">Loading area…</p>}><WorkspaceWithParams/></Suspense>) : <main className="p-6" role="status">Loading verification workspace…</main>;
}
function WorkspaceWithParams(){const params=useSearchParams();return <VerificationWorkspace key={params.toString()} area={pilotFromParams(params)}/>;}
