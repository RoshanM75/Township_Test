'use client';
import { useEffect, useState,Suspense } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import Link from 'next/link';
import '../../app/workspace.css';
import { loadWalkingData,loadPilotContext } from '@/lib/api';
import type { WalkingData } from '@/lib/walking';
import { placeSearchText } from '@/lib/walking';
import PreviewNotice from './PreviewNotice';
import { useClientReady } from '@/lib/use-client-ready';
import { pilotFromParams,isPilotAvailable,type PilotContext,type PilotId,PILOTS } from '@/lib/pilots';
import PilotSelector from './PilotSelector';
import PilotSources from './PilotSources';
import PilotUnavailable from './PilotUnavailable';

function PreviewContent({area}:{area:PilotId}) {
    const router=useRouter();
    const [data, setData] = useState<WalkingData | null>(null);
    const [context,setContext]=useState<PilotContext|null>(null);
    const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[limit,setLimit]=useState(24);
    const [error, setError] = useState('');
    useEffect(() => { Promise.all([loadWalkingData(area),loadPilotContext(area)]).then(([d,c])=>{setData(d);setContext(c);}).catch(() => setError('The mapped places could not be loaded. Please reload this page.')); }, [area]);
    const shown=data?.assets.filter(a=>(kind==='all'||a.kind===kind)&&(!query||placeSearchText(a).includes(query.toLowerCase())))??[];
    return <main className="tg-workspace min-h-screen px-4 py-6 font-sans">
        <div className="mx-auto max-w-3xl space-y-6">
            <div className="tg-work-title"><div><p className="tg-work-kicker">TownshipGo · Path information</p><h1>Mapped places and verification coverage</h1><p>Explore the evidence behind the walking map.</p></div></div>
            <PilotSelector area={area} onChange={next=>router.replace(`?area=${next}`)}/>
            <PreviewNotice area={area}/>
            <nav className="tg-work-header-links"><Link href={`/resident?area=${area}`}>Plan a walk</Link><Link href="/">TownshipGo home</Link></nav>
            <p>{PILOTS[area].description} Mapped records and GIS-estimated approaches are separate from field checks. Required rest intervals need currently checked facilities.</p>
            {error && <p role="alert">{error}</p>}
            {!data && !error && <p role="status">Loading mapped places…</p>}
            <PilotSources area={area} context={context??undefined}/>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Find a mapped place<input type="search" className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3" value={query} onChange={e=>{setQuery(e.target.value);setLimit(24);}}/></label><label className="text-sm font-bold">Place type<select className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3" value={kind} onChange={e=>{setKind(e.target.value);setLimit(24);}}>{['all','destination','transit','entrance','rest','toilet','water','shelter'].map(k=><option key={k} value={k}>{k==='all'?'All mapped records':k==='rest'?'Rest facilities':k}</option>)}</select></label></div>
            {data&&<p className="text-sm">{shown.length} matching records · {data.verifications.length} field observation records</p>}
            <ul className="space-y-3">{shown.slice(0,limit).map(a => <li key={a.id} className="rounded-xl border border-slate-300 bg-white p-4">
                <strong>{a.name}</strong><p className="mt-1 text-sm">{a.kind==='entrance'?(a.properties.connection_model==='approximate_approach'?'GIS-estimated approach':'Mapped access point'):a.kind==='rest'?'Rest facility':a.kind} · Unverified</p>
                {a.kind!=='destination'&&a.kind!=='transit'&&a.edge_id===null&&<p className="mt-1 text-sm">No mapped pedestrian connection. This point cannot currently be used in a walking route.</p>}
                <a href={a.source_ref} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-semibold text-[#7F1D22] underline">View OpenStreetMap source</a>
            </li>)}</ul>
            {shown.length>limit&&<button className="min-h-11 rounded-lg border-2 border-slate-400 px-4 font-bold" onClick={()=>setLimit(n=>n+24)}>Show more mapped records</button>}
            <p className="text-sm text-slate-600">The full TownshipGo server version provides shared facility mapping, dated observations and maintenance reports. This preview does not submit or publish observations.</p>
        </div>
    </main>;
}

function PreviewWithParams(){const params=useSearchParams(),area=pilotFromParams(params);return isPilotAvailable(area)?<PreviewContent key={params.toString()} area={area}/>:<PilotUnavailable area={area}/>;}
export default function VerificationPreview(){const ready=useClientReady();return ready?<Suspense fallback={<p role="status">Loading area…</p>}><PreviewWithParams/></Suspense>:<p role="status">Loading mapped places…</p>;}
