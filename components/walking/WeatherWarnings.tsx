import { CloudLightning } from 'lucide-react';
import { MET_WARNING_SOURCE, type WeatherWarnings } from '@/lib/weather-warnings';

const warningTime = new Intl.DateTimeFormat('en-MY', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
});

export default function WeatherWarningList({ feed, now }: { feed: WeatherWarnings | null; now: string }) {
    const active = feed?.warnings.filter(warning => Date.parse(warning.valid_to) > Date.parse(now)) ?? [];
    const nearby = active.filter(warning => warning.mentions_area);
    const other = active.filter(warning => !warning.mentions_area);
    return <section aria-label="Official weather warnings" className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900">
        <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-bold"><CloudLightning size={17} aria-hidden /> Official weather warnings</h3>
            <a href={MET_WARNING_SOURCE} target="_blank" rel="noreferrer" className="py-2 text-xs font-bold underline">MET Malaysia</a>
        </div>
        {(!feed || feed.status === 'unavailable' || !active.length) && <p className="text-xs text-slate-600" role="status">
            {!feed ? 'Checking MET Malaysia warnings…' : feed.status === 'unavailable' ? 'Warning feed unavailable.' : 'No active warnings returned by the feed.'}
        </p>}
        {nearby.map(warning => <article key={warning.id} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
            <h4 className="font-bold">{warning.title}</h4>
            <p>{warning.description}</p>
            {warning.instruction && <p>{warning.instruction}</p>}
            <p className="mt-1 text-xs">Until <time dateTime={warning.valid_to}>{warningTime.format(new Date(warning.valid_to))}</time> (Malaysia)</p>
        </article>)}
        {!!other.length && <details className="mt-1">
            <summary className="min-h-10 cursor-pointer py-2 text-xs font-bold">More active MET Malaysia bulletins ({other.length})</summary>
            <ul className="space-y-2">{other.map(warning => <li key={warning.id}>
                <strong>{warning.title}</strong><p>{warning.description}</p>
                <p className="text-xs">Until <time dateTime={warning.valid_to}>{warningTime.format(new Date(warning.valid_to))}</time> (Malaysia)</p>
            </li>)}</ul>
        </details>}
    </section>;
}
