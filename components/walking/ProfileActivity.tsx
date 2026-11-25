'use client';

import { useState, type ReactNode } from 'react';
import { Clock3, Footprints, Leaf, LockKeyhole, MapPin, Route, ChevronRight, type LucideIcon } from 'lucide-react';
import type { CompletedWalk } from '@/lib/walk-library';
import {
    CAR_CO2E_KG_PER_KM, CAR_EMISSIONS_REFERENCE, METRES_PER_ESTIMATED_STEP,
    profileActivity, frequentlyVisitedPlaces, type ActivityPeriod, type FrequentPlace,
} from '@/lib/profile-activity';
import { PILOTS, isPilotAvailable } from '@/lib/pilots';
import { residentText, type ResidentLabel, type ResidentLanguage } from '@/lib/resident-language';

const PERIODS: { id: ActivityPeriod; label: ResidentLabel }[] = [
    { id: 'day', label: 'Today' }, { id: 'week', label: 'This week' }, { id: 'month', label: 'This month' },
];

function ActivityTile({ Icon, title, value, unit, tone, note }: {
    Icon: LucideIcon; title: string; value: string; unit?: string; tone: string; note: string;
}) {
    return <div className="tg-activity-tile" data-tone={tone}>
        <h3><Icon size={20} aria-hidden /><span>{title}</span></h3>
        <p className="tg-activity-number"><strong>{value}</strong>{unit && <span>{unit}</span>}</p>
        <p className="tg-small">{note}</p>
    </div>;
}

interface Props {
    history: readonly CompletedWalk[];
    now: number;
    language: ResidentLanguage;
    showActivity: boolean;
    showFrequentPlaces: boolean;
    onSaved: () => void;
    onPrivacy: () => void;
    onPlan: (place: FrequentPlace) => void;
}

export default function ProfileActivity({ history, now, language, showActivity, showFrequentPlaces, onSaved, onPrivacy, onPlan }: Props) {
    const [period, setPeriod] = useState<ActivityPeriod>('day');
    const t = (label: ResidentLabel) => residentText(language, label);
    const locale = language === 'ms' ? 'ms-MY' : 'en-MY';
    const summary = profileActivity(history, period, now);
    const { start_ms, end_ms } = summary;
    const date = (instant: number, options: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, { ...options, timeZone: 'Asia/Kuala_Lumpur' }).format(instant);
    const periodDate = period === 'week'
        ? `${date(start_ms, { day: 'numeric', month: 'short' })} – ${date(end_ms - 1, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : date(start_ms, period === 'month' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' });
    const format = (number: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(number);
    const steps = summary.estimated_steps === null ? '—' : format(summary.estimated_steps);
    const distance = summary.distance_m === null ? { value: '—' } : summary.distance_m < 1000
        ? { value: format(summary.distance_m), unit: 'm' } : { value: format(summary.distance_m / 1000, 2), unit: 'km' };
    const carbon = summary.potential_car_co2e_kg === null ? { value: '—' }
        : summary.potential_car_co2e_kg < 1
            ? { value: summary.potential_car_co2e_kg < .001 ? '<1' : format(summary.potential_car_co2e_kg * 1000), unit: 'g' }
            : { value: format(summary.potential_car_co2e_kg, 2), unit: 'kg' };
    const minutes = Math.floor(summary.active_ms / 60000);
    const time = summary.completed_walks === 0 ? '—' : minutes < 1 && summary.active_ms > 0 ? '<1' : format(minutes);
    const places = showFrequentPlaces ? frequentlyVisitedPlaces(history, now).slice(0, 5) : [];
    const privacyButton = <button type="button" className="tg-text-action" onClick={onPrivacy}>{t('Privacy settings')}<ChevronRight size={16} aria-hidden /></button>;
    const hidden = (label: ResidentLabel): ReactNode => <div className="tg-activity-empty">
        <LockKeyhole size={20} aria-hidden /><p>{t(label)}</p>{privacyButton}
    </div>;

    return <section id="profile-activity" tabIndex={-1} className="tg-profile-activity" aria-labelledby="profile-activity-title">
        <div className="tg-activity-heading">
            <div><h2 className="tg-h2" id="profile-activity-title">{t('My activity')}</h2>
                <p className="tg-small">{t('From your completed TownshipGo walks')}</p></div>
            <button type="button" className="tg-text-action" onClick={onSaved}>{t('View history')}<ChevronRight size={16} aria-hidden /></button>
        </div>
        {showActivity ? <>
            <div className="tg-activity-periods" role="group" aria-label={t('Activity period')}>
                {PERIODS.map(({ id, label }) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)}>{t(label)}</button>)}
            </div>
            <p className="tg-small tg-activity-date">{periodDate} · MYT</p>
            <div aria-live="polite" className="tg-activity-result">
                <div className="tg-activity-grid">
                    <ActivityTile Icon={Footprints} title={t('Estimated steps')} value={steps} tone="steps"
                        note={t(summary.estimated_steps === null ? 'No step estimate recorded' : 'Based on GPS distance')} />
                    <ActivityTile Icon={Clock3} title={t('Active time')} value={time} unit={summary.completed_walks > 0 ? 'min' : undefined} tone="time"
                        note={t('Pauses excluded')} />
                    <ActivityTile Icon={Route} title={t('Distance recorded')} {...distance} tone="distance" note={t('Recorded GPS distance only')} />
                    <ActivityTile Icon={Leaf} title={t('Potential CO₂e avoided')} {...carbon} tone="carbon" note={t('If the same distance were driven')} />
                </div>
                <div className="tg-activity-coverage">
                    <span><strong>{format(summary.completed_walks)}</strong> {t('completed walks')}</span>
                    <span><strong>{format(summary.distance_walks)}</strong> {t('with GPS distance')}</span>
                </div>
                {summary.completed_walks === 0 ? <p className="tg-small">{t('No completed walks in this period. Your activity summaries update when you save a finished walk.')}</p>
                    : summary.distance_walks < summary.completed_walks ? <p className="tg-small">{t('GPS is optional. Timer-only walks add time, not steps or carbon estimates.')}</p> : null}
                {summary.has_nonstepping_distance && <p className="tg-small">{t('Wheelchair and other non-stepping journeys add distance and time, not steps.')}</p>}
            </div>
            <details className="tg-details tg-activity-method">
                <summary>{t('How these estimates work')}</summary>
                <div className="tg-stack">
                    <p>{t('Step estimates use recorded distance and an assumed step length of')} {METRES_PER_ESTIMATED_STEP} m. {t('This is not a phone pedometer or an individual stride measurement.')}</p>
                    <p>{t('Carbon estimate uses')} {CAR_CO2E_KG_PER_KM.toFixed(2)} kg CO₂e/km. {t('It compares an equal-distance passenger-car journey, not a measured emissions reduction. Actual car distances and emissions vary.')}</p>
                    <a href={CAR_EMISSIONS_REFERENCE} target="_blank" rel="noopener noreferrer" className="tg-text-action">{t('Source: MITI i-ESG Starter Kit, section 3.2.6.3')}</a>
                    <p>{t('Walks count on their completion date in Malaysia time. The week starts on Monday. Only retained completed walks are counted; no background tracking or planned distances are included.')}</p>
                </div>
            </details>
        </> : hidden('Activity summaries are hidden.')}

        <div className="tg-activity-places">
            <div className="tg-activity-heading">
                <div><h3 className="tg-h2">{t('Frequently visited places')}</h3>
                    <p className="tg-small">{t('Confirmed arrivals · All saved history')}</p></div>
                <LockKeyhole size={19} aria-hidden />
            </div>
            {showFrequentPlaces ? places.length > 0 ? <ul className="tg-activity-place-list">
                {places.map(place => <li key={JSON.stringify([place.area, place.place_id])}>
                    <button type="button" onClick={() => onPlan(place)} disabled={!isPilotAvailable(place.area)}
                        aria-label={`${t('Plan a walk to')} ${place.name} · ${PILOTS[place.area].short_name} · ${format(place.visits)} ${t(place.visits === 1 ? 'visit' : 'visits')}`}>
                        <span className="tg-activity-place-icon"><MapPin size={20} aria-hidden /></span>
                        <span className="tg-activity-place-detail"><strong>{place.name}</strong>
                            <small>{PILOTS[place.area].short_name}</small></span>
                        <span className="tg-activity-visit-count">{format(place.visits)} <small>{t(place.visits === 1 ? 'visit' : 'visits')}</small></span>
                        <ChevronRight size={18} aria-hidden />
                    </button>
                </li>)}
            </ul> : <div className="tg-activity-empty"><MapPin size={22} aria-hidden /><div>
                <strong>{t('No confirmed visits yet')}</strong>
                <p className="tg-small">{t('Confirm that you reached your destination when saving a finished walk to add it here. Older walks without arrival confirmation are not counted.')}</p>
            </div></div> : hidden('Frequently visited places are hidden.')}
            <p className="tg-small tg-profile-private"><LockKeyhole size={14} aria-hidden />{t('Activity and confirmed visits stay on this device.')}</p>
        </div>
    </section>;
}
