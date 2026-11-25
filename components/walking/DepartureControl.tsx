'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { malaysiaInput, fromMalaysiaInput, type WeatherHour } from '@/lib/comfort';
import { malaysiaTimeLabel, residentText, type ResidentLanguage } from '@/lib/resident-language';

export default function DepartureControl({ departure, now, onChange, onNow, forecast, revealTime = false, language = 'en' }: {
    departure: string; now: boolean; onChange: (iso: string) => void; onNow: () => void;
    forecast: WeatherHour | null; revealTime?: boolean; language?: ResidentLanguage;
}) {
    const t = (label: Parameters<typeof residentText>[1]) => residentText(language, label);
    const [draft, setDraft] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const timePanel = useRef<HTMLDetailsElement>(null);
    useEffect(() => { if (revealTime && timePanel.current) timePanel.current.open = true; }, [revealTime]);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const time = draft ?? departure;
    const local = malaysiaInput(time);
    const minute = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
    const temperature = forecast?.feels_like_c;
    const rain = forecast?.rain_probability;

    function cancelDraft() {
        if (timer.current) clearTimeout(timer.current);
        setDraft(null);
    }

    function slide(value: number) {
        const clock = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
        const next = fromMalaysiaInput(`${local.slice(0, 10)}T${clock}`);
        if (!next) return;
        if (timer.current) clearTimeout(timer.current);
        setDraft(next);
        timer.current = setTimeout(() => { setDraft(null); onChange(next); }, 180);
    }

    return <div className="tg-departure tg-note">
        <div className="tg-departure-row"><Clock size={19} aria-hidden />
            <span><strong>{now && !draft ? t('Leaving now') : malaysiaTimeLabel(time, language, true)}</strong><small>{t('Malaysia time')}</small></span>
            <button type="button" className="tg-text-action" aria-pressed={now} onClick={() => { cancelDraft(); onNow(); }}>{t('Now')}</button>
        </div>
        <details className="tg-details" ref={timePanel}>
            <summary>{t('Leave at…')}</summary>
            <div className="tg-stack mt-2">
                <label className="tg-label">{t('Departure time (Malaysia)')}
                    <input type="datetime-local" value={local} onChange={event => {
                        const next = fromMalaysiaInput(event.target.value);
                        if (next) { cancelDraft(); onChange(next); }
                    }} className="tg-input" />
                </label>
                <label className="tg-label tg-time-slider">{t('Time of day')}
                    <input type="range" min={0} max={1439} step={1} value={minute} aria-valuetext={malaysiaTimeLabel(time, language)}
                        onChange={event => slide(Number(event.target.value))} />
                </label>
            </div>
        </details>
        <p className="tg-small">{temperature == null && rain == null ? t('Forecast unavailable at this time')
            : ['Open-Meteo', temperature == null ? '' : `${t('Feels like')} ${Math.round(temperature)}°C`,
                rain == null ? '' : `${Math.round(rain)}% ${t('chance of rain')}`].filter(Boolean).join(' · ')}</p>
    </div>;
}
