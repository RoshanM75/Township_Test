import { CloudRain, Moon, Sun, Thermometer, ArrowUpRight } from 'lucide-react';
import type { WeatherHour } from '@/lib/comfort';
import type { Mode } from '@/lib/routing';

export default function WalkingConditions({ night, forecast, onCompare, onInspectCover }: { night: boolean; forecast: WeatherHour | null; onCompare: (mode: Mode) => void; onInspectCover: () => void }) {
    const rainy = (forecast?.rain_probability ?? 0) >= 50 || (forecast?.precipitation_mm ?? 0) > 0;
    const hot = (forecast?.feels_like_c ?? 0) >= 32;
    const Icon = night ? Moon : rainy ? CloudRain : hot ? Thermometer : Sun;
    const title = night ? 'A little more light for your walk' : rainy ? 'Rain is in the forecast' : hot ? 'A warmer hour to walk' : 'Plan around your surroundings';
    const message = night ? 'Compare mapped lighting and look for current checks. A mapped lamp does not confirm it is working.'
        : rainy ? 'Check known roof cover and entrance hours. Covered paths and tree shade offer different protection.'
            : hot ? 'Compare estimated sun exposure, use your comfortable pace and plan verified rests when needed.'
                : 'Compare shade, lighting and checked conditions alongside distance. Unmapped conditions stay unknown.';
    return <section aria-label="Walking conditions" className="rounded-2xl border border-emerald-200 bg-[#edf5f1] p-4 text-slate-900">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-white p-2 text-emerald-800"><Icon size={22} aria-hidden /></span>
            <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-widest text-emerald-800">Your walking environment</p><h2 className="mt-1 text-base font-bold leading-snug">{title}</h2></div>
        </div>
        <p className="mt-3 text-sm leading-relaxed">{message}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            {forecast?.feels_like_c != null && <span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5">Forecast feels like {Math.round(forecast.feels_like_c)}°C</span>}
            {forecast?.rain_probability != null && <span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5">{Math.round(forecast.rain_probability)}% rain probability</span>}
            {forecast?.direct_radiation!=null&&<span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5">Direct sun {Math.round(forecast.direct_radiation)} W/m²</span>}
            {forecast?.cloud_cover!=null&&<span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5">Cloud {Math.round(forecast.cloud_cover)}%</span>}
            {forecast?.humidity!=null&&<span className="rounded-full border border-emerald-200 bg-white px-3 py-1.5">Humidity {Math.round(forecast.humidity)}%</span>}
            {!forecast && <span className="text-slate-600">Hourly forecast unavailable · path estimates still apply</span>}
        </div>
        {forecast&&<p className="mt-2 text-xs">Weather: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="font-bold underline">Open-Meteo</a> · area forecast, not a street-level sensor reading. Route suggestions consider predicted sun intensity and rain risk.</p>}
        <button type="button" onClick={() => rainy && !night ? onInspectCover() : onCompare(night ? 'safest' : 'coolest')} className="mt-2 inline-flex min-h-11 items-center gap-2 font-bold text-emerald-900 underline">
            {night ? 'Compare lighting' : rainy ? 'Inspect cover records' : 'Compare sun exposure'}<ArrowUpRight size={18} aria-hidden />
        </button>
    </section>;
}
