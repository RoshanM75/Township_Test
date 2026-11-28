import { CloudRain, Thermometer } from 'lucide-react';
import type { WalkingWeather } from '@/lib/comfort';

const hourLabel = new Intl.DateTimeFormat('en-MY', {
    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
});

function degrees(value: number | null) {
    return value === null ? '—' : `${Math.round(value)}°C`;
}

export default function WeatherStrip({ weather, now }: { weather: WalkingWeather | null; now: string }) {
    const hours = weather?.hourly.filter(hour => Date.parse(hour.time) > Date.parse(now)).slice(0, 5) ?? [];
    return (
        <section className="tg-weather" aria-label="Temperature and rain forecast">
            <div className="tg-weather-heading">
                <h2>Weather <span>· Malaysia time</span></h2>
                <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo</a>
            </div>
            {!weather || weather.source === 'unavailable' ? (
                <p className="text-sm text-slate-600" role="status">{weather ? 'Weather forecast unavailable.' : 'Loading area forecast…'}</p>
            ) : (
                <ul className="tg-weather-cards" tabIndex={0} aria-label="Upcoming weather">
                    <li className="tg-weather-card tg-weather-now">
                        <span><Thermometer size={14} aria-hidden /> Now</span>
                        <strong>{degrees(weather.air_temp_c)}</strong>
                        <small>{weather.feels_like_c === null ? 'Feels like unavailable' : `Feels like ${degrees(weather.feels_like_c)}`}</small>
                        {weather.humidity!=null&&<small>{Math.round(weather.humidity)}% humidity</small>}
                    </li>
                    {hours.map(hour => (
                        <li key={hour.time} className={`tg-weather-card${(hour.rain_probability ?? 0) >= 50 ? ' tg-weather-rain' : ''}`}>
                            <span><time dateTime={hour.time}>{hourLabel.format(new Date(hour.time))}</time></span>
                            <strong>{degrees(hour.air_temp_c)}</strong>
                            <small><CloudRain size={13} aria-hidden /> {hour.rain_probability === null ? 'Rain unavailable' : `${Math.round(hour.rain_probability)}% rain`}</small>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
