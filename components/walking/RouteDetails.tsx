import type { JourneyRoute } from '@/lib/walking';
import Link from 'next/link';
import { IS_PAGES_PREVIEW } from '@/lib/site';
export default function RouteDetails({ route }: { route: JourneyRoute }) {
    return <details className="rounded-xl border-2 border-slate-300 bg-white p-3 text-sm text-slate-900">
        <summary className="cursor-pointer font-bold">Why this route and what needs checking</summary>
        <div className="mt-3 space-y-3">
            <p><strong>Arrival point:</strong> {route.entrance.name}. {route.entrance.source === 'osm' ? 'Mapped in OpenStreetMap.' :
                route.entrance.source === 'gtfs' ? 'The plan ends at the mapped footpath near the stop.' : 'Recorded locally.'}</p>
            {typeof route.entrance.properties.station_plan === 'string' && route.entrance.properties.station_plan.startsWith('https://') && <a className="inline-flex min-h-11 items-center font-bold underline"
                href={route.entrance.properties.station_plan} target="_blank" rel="noreferrer">MRT Corp’s station and lift plan</a>}
            <p>{Math.ceil(route.walk_min)} min walking/crossing waits + {route.rest_min} min planned rest. Arrival: {new Date(route.arrival_at).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })} (Malaysia).</p>
            <p>Current critical checks cover {Math.round(route.evidence_coverage * 100)}% of the distinct path segments. Estimated uncovered distance: {Math.round(route.uncovered_m)} m. Conservative estimate outside mapped roof cover: {Math.round(route.unsheltered_m)} m.</p>
            {route.explanations.length > 0 && <ul className="list-disc space-y-1 pl-5">{route.explanations.map(text => <li key={text}>{text}</li>)}</ul>}
            {route.rest_stops.length > 0 && <div><strong>Planned rests</strong><ol className="list-decimal pl-5">{route.rest_stops.map((a, i) => <li key={`${a.id}:${i}`}>{a.name}</li>)}</ol></div>}
            {route.evidence.filter(e => e.missing.length).length > 0 && <div><strong>Missing or expired checks</strong><ul className="list-disc pl-5">{route.evidence.filter(e => e.missing.length).map(e => <li key={e.edge_id}>{e.name}: {e.missing.join(', ')}</li>)}</ul></div>}
            <Link href="/verification" className="inline-block min-h-11 pt-3 font-bold text-[#7F1D22] underline">{IS_PAGES_PREVIEW ? 'View verification coverage' : 'View or add verification records'}</Link>
        </div>
    </details>;
}
