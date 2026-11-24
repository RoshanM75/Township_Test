import { Sun, Moon, Umbrella, Armchair, ClipboardCheck } from 'lucide-react';
import type { JourneyRoute, VerificationRecord } from '@/lib/walking';
import type { PathEdge } from '@/lib/routing';
import { environmentSegments, environmentCoverage } from '@/lib/environment';

export default function ComfortBreakdown({ route, edges, records, night }: { route: JourneyRoute; edges: PathEdge[]; records: VerificationRecord[]; night: boolean }) {
    const ids = new Set(route.edge_ids);
    const roof = environmentCoverage(environmentSegments(edges.filter(e => ids.has(e.id)), records, route.arrival_at, 'cover'));
    const sun = route.sun_exposure;
    const cards = [
        { Icon: night ? Moon : Sun, label: night ? 'Poorly lit distance' : 'Sun-exposed distance', value: `${Math.round(night ? route.dark_m : sun?.sun_m ?? route.uncovered_m)} m`,
            note: !night && sun ? `${Math.round(sun.unknown_m)} m with unknown shade` : 'Estimate for this departure' },
        { Icon: Umbrella, label: 'Cover information', value: roof.known ? `${roof.known} of ${roof.total}` : 'Not mapped', note: roof.known ? `Segments with information · ${roof.checked} currently checked` : 'Unknown cover is treated conservatively' },
        { Icon: Armchair, label: 'Planned rest', value: `${route.rest_min} min`, note: `${route.verified_rest_stops} currently checked ${route.verified_rest_stops === 1 ? 'facility' : 'facilities'}` },
        { Icon: ClipboardCheck, label: 'Critical path checks', value: `${Math.round(route.evidence_coverage * 100)}%`, note: 'Share of distinct path segments with all critical checks' },
    ];
    return <section aria-label="Route comfort breakdown" className="rounded-2xl border border-slate-200 bg-[#f8faf8] p-3 text-slate-900">
        <details><summary className="cursor-pointer text-sm font-extrabold">A closer look at this walk</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">{cards.map(({ Icon, label, value, note }) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <Icon size={19} className="mb-2 text-emerald-800" aria-hidden /><p className="text-xs font-semibold text-slate-600">{label}</p><p className="mt-1 text-lg font-extrabold">{value}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{note}</p>
        </div>)}</div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">Estimates, mapped features and field checks have different meanings. These dimensions complement the route-confidence bar.</p>
        </details>
    </section>;
}
