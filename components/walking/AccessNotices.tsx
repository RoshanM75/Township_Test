import { TriangleAlert } from 'lucide-react';
import type { activeAccessNotices } from '@/lib/access-notices';

const date = new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
});

export default function AccessNotices({ notices, onFocus }: {
    notices: ReturnType<typeof activeAccessNotices>; onFocus: (point: [number, number]) => void;
}) {
    if (!notices.length) return null;
    return <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-slate-900" aria-label="Confirmed access disruptions">
        <h2 className="flex items-center gap-2 font-bold"><TriangleAlert size={18} aria-hidden /> Confirmed access disruptions</h2>
        <ul className="mt-2 space-y-2">
            {notices.slice(0, 5).map(notice => <li key={notice.id}>
                <button type="button" className="min-h-11 text-left font-bold underline" onClick={() => onFocus(notice.point)}>
                    {notice.label} · {notice.name}
                </button>
                <p className="text-xs">
                    Checked <time dateTime={notice.observed_at}>{date.format(new Date(notice.observed_at))}</time>
                    {notice.review_at && <> · Review by <time dateTime={notice.review_at}>{date.format(new Date(notice.review_at))}</time></>}
                </p>
                {notice.source && <a className="text-xs underline" href={notice.source} target="_blank" rel="noreferrer">Source record</a>}
            </li>)}
        </ul>
    </section>;
}
