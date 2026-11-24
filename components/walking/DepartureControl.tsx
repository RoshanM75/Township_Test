'use client';
import { malaysiaInput, fromMalaysiaInput, type WeatherHour } from '@/lib/comfort';
import { residentText, type ResidentLanguage } from '@/lib/resident-language';
export default function DepartureControl({ departure, onChange, onNow, forecast, language = 'en' }: { departure: string; onChange: (iso: string) => void; onNow: () => void; forecast: WeatherHour | null; language?: ResidentLanguage }) {
    return <div className="rounded-xl border-2 border-slate-300 bg-white p-3 text-slate-900">
        <label htmlFor="walk-departure" className="block font-bold">{residentText(language, 'Departure time (Malaysia)')}</label>
        <div className="mt-2 flex flex-wrap gap-2"><input id="walk-departure" type="datetime-local" value={malaysiaInput(departure)} onChange={e => { const iso = fromMalaysiaInput(e.target.value); if (iso) onChange(iso); }} className="min-h-11 min-w-0 flex-1 rounded border border-slate-400 bg-white px-2 text-sm" />
            <button type="button" onClick={onNow} className="min-h-11 rounded border-2 border-slate-400 px-3 font-bold">{residentText(language, 'Leave now')}</button></div>
        <p className="mt-2 text-sm">{forecast ? `${forecast.feels_like_c == null ? 'Temperature unavailable' : `Forecast feels like ${Math.round(forecast.feels_like_c)}°C`}${forecast.rain_probability == null ? '' : ` · ${Math.round(forecast.rain_probability)}% rain probability`}` : 'No forecast available for this time. Path-based shade, shelter and lighting estimates still apply.'}</p>
    </div>;
}
