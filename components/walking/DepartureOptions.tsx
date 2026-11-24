'use client';

import { useState } from 'react';
import { forecastAt, type WalkingWeather } from '@/lib/comfort';
import type { DepartureOption, PlanningSnapshot, SearchCommand } from '@/lib/planning-dispatch';
import { malaysiaTimeLabel, residentText, type ResidentLanguage } from '@/lib/resident-language';
import { usePlannerResult } from '@/lib/use-planner';
import type { JourneyRoute } from '@/lib/walking';

export default function DepartureOptions({ snapshot, plan, route, weather, language, onChoose }: {
    snapshot: PlanningSnapshot; plan: SearchCommand; route: JourneyRoute; weather: WalkingWeather | null;
    language: ResidentLanguage; onChoose: (departure: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const t = (label: Parameters<typeof residentText>[1]) => residentText(language, label);
    const start = Date.parse(route.departure_at);
    const times = [15, 30, 60].map(wait => {
        const departure = new Date(start + wait * 60000).toISOString();
        return { departure, feels_like: forecastAt(weather, departure)?.feels_like_c };
    });
    const request = plan.type === 'journey' ? { ...plan, input: { ...plan.input, entrance_id: route.entrance.id } } : plan;
    const options = usePlannerResult<DepartureOption[]>(snapshot, { type: 'departures', plan: request, times, mode: route.mode }, open);
    const baseline = route.sun_exposure;
    const better = options.result?.find(item => baseline && baseline.sun_s - item.sunSeconds - item.unknownSeconds >= 60);
    return <details className="tg-details" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>{t('Compare departure times')}</summary>
        <div className="tg-stack mt-2" aria-live="polite">
            {options.pending && <p className="tg-small">{t('Checking later departures…')}</p>}
            {options.error && <p className="tg-small">{options.error}</p>}
            {options.result && <>
                <p className="tg-small">{better ? `${t('Less direct sun at')} ${malaysiaTimeLabel(better.departure, language)} MYT`
                    : t('No clearly shadier departure in the next hour.')}</p>
                {options.result.map(item => <button key={item.departure} type="button" className="tg-btn tg-time-option" onClick={() => onChoose(item.departure)}>
                    <strong>{malaysiaTimeLabel(item.departure, language)}</strong>
                    <span>{Math.ceil(item.minutes)} min · {Math.round(item.sunSeconds / 60)} min {t('in direct sun')}
                        {item.unknownSeconds > 0 && ` · ${Math.ceil(item.unknownSeconds / 60)} min ${t('shade unknown')}`}</span>
                </button>)}
            </>}
        </div>
    </details>;
}
