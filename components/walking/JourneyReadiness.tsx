'use client';

import { ShieldCheck, ClipboardCheck, Clock, MapPin, AlertTriangle } from 'lucide-react';
import type { JourneyRoute } from '@/lib/walking';
import type { journeyReadiness } from '@/lib/journey-readiness';
import type { ConditionState, RouteBarrier } from '@/lib/route-conditions';
import { malaysiaTimeLabel, residentText, type ResidentLanguage } from '@/lib/resident-language';

export const stateNames: Record<ConditionState, string> = {
    checked: 'Field-checked', reported: 'Reported', overdue: 'Review overdue',
    mapped: 'Mapped', estimated: 'Estimated', unknown: 'Unknown',
};

export function JourneyBarriers({ barriers, onCheck, onFocus }: {
    barriers: RouteBarrier[]; onCheck: (barrier: RouteBarrier) => void; onFocus: (point: [number, number]) => void;
}) {
    if (!barriers.length) return null;
    return <div className="tg-note tg-warnbox space-y-3">
        <h3 className="font-bold">What needs attention</h3>
        <p className="tg-small">These are specific mapped barriers or information gaps, not alternative directions.</p>
        {barriers.slice(0, 6).map((barrier, index) => <article className="tg-reliability-item" key={barrier.target_type+barrier.target_id+barrier.field+index}>
            <div className="tg-reliability-line"><strong>{barrier.name}</strong><span className="tg-evidence-chip">{stateNames[barrier.state]}</span></div>
            <p className="tg-small">{barrier.reason}</p>
            <div className="tg-reliability-actions">
                <button type="button" className="tg-text-action" onClick={() => onFocus(barrier.point)}><MapPin size={16} aria-hidden /> Show on map</button>
                <button type="button" className="tg-text-action" onClick={() => onCheck(barrier)}><ClipboardCheck size={16} aria-hidden /> Request a field check</button>
            </div>
        </article>)}
    </div>;
}

export default function JourneyReadiness({ route, readiness, language = 'en', fetchedAt, snapshot, unavailable, warning, onCheck, onFocus }: {
    route: JourneyRoute; readiness: ReturnType<typeof journeyReadiness>; language?: ResidentLanguage;
    fetchedAt: string | null; snapshot: boolean; unavailable: boolean; warning: boolean;
    onCheck: (barrier: RouteBarrier) => void; onFocus: (point: [number, number]) => void;
}) {
    const t = (value: Parameters<typeof residentText>[1]) => residentText(language, value);
    const needsReview = readiness.incomplete || unavailable || warning;
    return <section className="tg-reliability-card" aria-label={t('Journey readiness')}>
        <div className="tg-reliability-line">
            <h3 className="tg-h2 flex items-center gap-2">{needsReview ? <AlertTriangle size={20} aria-hidden /> : <ShieldCheck size={20} aria-hidden />}{t('Journey readiness')}</h3>
            <span className={'tg-evidence-chip '+(needsReview ? 'tg-evidence-warn' : 'tg-evidence-checked')}>{t(needsReview ? 'Needs review' : 'Recorded checks current')}</span>
        </div>
        <p className="tg-small">{snapshot ? 'Map snapshot — not a live condition check.' : unavailable ? 'Recent condition refresh unavailable. Review before leaving.' : fetchedAt ? 'Area feed received '+malaysiaTimeLabel(fetchedAt,language,true)+' MYT.' : 'Waiting for the latest area conditions.'}</p>
        <dl className="tg-readiness-grid">
            <div><dt>Journey time</dt><dd>{Math.ceil(route.total_min)} min</dd></div>
            <div><dt>Step-free continuity</dt><dd>{readiness.stepFree === 'checked' ? 'Field-checked' : readiness.stepFree === 'barriers' ? 'Barrier recorded' : 'Needs checking'}</dd></div>
            <div><dt>Mapped roof cover</dt><dd>{readiness.mappedCoverPercent}%</dd></div>
            <div><dt>Longest without verified rest</dt><dd>{Math.ceil(route.longest_without_rest_min)} min</dd></div>
            <div><dt>Arrival connection</dt><dd>{route.errand_returns && !route.start_asset_id ? 'Return to mapped start' : readiness.entranceChecked ? 'Field-checked' : 'Needs checking'}</dd></div>
            <div><dt>Lift availability</dt><dd>{readiness.lift.value === undefined ? 'Not recorded' : (readiness.lift.value === true ? 'Recorded working' : 'Recorded unavailable')+' · '+stateNames[readiness.lift.state]}</dd></div>
        </dl>
        {readiness.hours && <p className="tg-small"><Clock size={15} className="inline mr-1" aria-hidden />Arrival hours: {readiness.hours.open === null ? 'unknown' : (readiness.hours.open ? 'open' : 'closed')+' · '+readiness.hours.source}</p>}
        <details className="tg-details">
            <summary>Evidence and review dates</summary>
            <div className="tg-stack mt-2">
                <ul className="tg-evidence-list">{(Object.entries(readiness.checks) as [ConditionState,number][]).map(([state, count]) => <li key={state}><span>{stateNames[state]}</span><strong>{count}</strong></li>)}</ul>
                <p className="tg-small">Counts are individual condition fields, not a percentage of route safety. A mapped or estimated condition is not a current field check.</p>
                <p className="tg-small">Latest observation: {readiness.lastObservation ? malaysiaTimeLabel(readiness.lastObservation,language,true) : 'None recorded'} · Next review: {readiness.nextReview ? malaysiaTimeLabel(readiness.nextReview,language,true) : 'Not recorded'}</p>
            </div>
        </details>
        {warning && <p className="tg-note tg-warnbox">A weather warning affects this area. Consider delaying the journey or waiting in an appropriate indoor location. Covered footpaths are not storm shelters.</p>}
        {!!readiness.activeReports.length && <p className="tg-small font-bold">{readiness.activeReports.length} unresolved route-related {readiness.activeReports.length === 1 ? 'report' : 'reports'}. Review current conditions.</p>}
        <JourneyBarriers barriers={readiness.barriers} onCheck={onCheck} onFocus={onFocus} />
    </section>;
}
