export interface WeatherHour {
    time: string; feels_like_c: number | null; air_temp_c: number | null;
    rain_probability: number | null; precipitation_mm: number | null;
    direct_radiation?:number|null; diffuse_radiation?:number|null; cloud_cover?:number|null;
    humidity?:number|null; wind_kmh?:number|null; weather_code?:number|null;
}
export interface WalkingWeather {
    source: 'open-meteo' | 'unavailable'; as_of: string; timestamp: string;
    air_temp_c: number | null; feels_like_c: number | null; humidity: number | null;
    uv_index: number | null; solar_irradiance: number | null; hourly: WeatherHour[];
    direct_radiation?:number|null; cloud_cover?:number|null; wind_kmh?:number|null;
}
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function weatherUrl(origin: [number, number]) {
    const query = new URLSearchParams({ latitude: String(origin[0]), longitude: String(origin[1]),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,shortwave_radiation,direct_radiation,cloud_cover,wind_speed_10m',
        hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,direct_radiation,diffuse_radiation,cloud_cover,wind_speed_10m,weather_code',
        forecast_days: '3', timezone: 'Asia/Kuala_Lumpur' });
    return `https://api.open-meteo.com/v1/forecast?${query}`;
}
export function unavailableWeather(now: string): WalkingWeather {
    return { source: 'unavailable', as_of: now, timestamp: now, air_temp_c: null, feels_like_c: null,
        humidity: null, uv_index: null, solar_irradiance: null, hourly: [] };
}
export function parseWeather(data: unknown, now: string): WalkingWeather {
    if (!data || typeof data !== 'object') throw new Error('Weather response missing');
    const value = data as { current?: Record<string, unknown>; hourly?: Record<string, unknown[]> };
    if (!value.current || !value.hourly || !Array.isArray(value.hourly.time)) throw new Error('Weather fields missing');
    const h = value.hourly;
    const hourly: WeatherHour[] = h.time.slice(0, 72).flatMap((time, i) => {
        if (typeof time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(time)) return [];
        return [{ time: new Date(`${time}:00+08:00`).toISOString(), feels_like_c: finite(h.apparent_temperature?.[i]),
            air_temp_c: finite(h.temperature_2m?.[i]), rain_probability: finite(h.precipitation_probability?.[i]), precipitation_mm: finite(h.precipitation?.[i]),
            direct_radiation:finite(h.direct_radiation?.[i]),diffuse_radiation:finite(h.diffuse_radiation?.[i]),cloud_cover:finite(h.cloud_cover?.[i]),
            humidity:finite(h.relative_humidity_2m?.[i]),wind_kmh:finite(h.wind_speed_10m?.[i]),weather_code:finite(h.weather_code?.[i]) }];
    });
    return { source: 'open-meteo', as_of: now, timestamp: String(value.current.time ?? now),
        air_temp_c: finite(value.current.temperature_2m), feels_like_c: finite(value.current.apparent_temperature),
        humidity: finite(value.current.relative_humidity_2m), uv_index: null,
        solar_irradiance: finite(value.current.shortwave_radiation), direct_radiation:finite(value.current.direct_radiation),
        cloud_cover:finite(value.current.cloud_cover),wind_kmh:finite(value.current.wind_speed_10m), hourly };
}
export function forecastAt(weather: WalkingWeather | null, departure: string): WeatherHour | null {
    if (!weather || weather.source !== 'open-meteo') return null;
    const time = Date.parse(departure);
    return weather.hourly.find(h => Date.parse(h.time) <= time && time < Date.parse(h.time) + 3600000) ?? null;
}
/** Area forecast only, used for relative route ranking, not a street-level
 * heat index or a medical assessment. Missing data preserves the old weights. */
export function forecastWeights(weather:WalkingWeather|null|undefined,at:number,feelsLike?:number|null){
    const hour=Number.isFinite(at)?forecastAt(weather??null,new Date(at).toISOString()):null;
    const feels=hour?.feels_like_c??feelsLike;
    const hot=feels!=null&&feels>=32?1.5:1;
    const beam=hour?.direct_radiation;
    const solar=beam!=null?Math.max(.15,Math.min(1.4,beam/550)):hour?.cloud_cover!=null?Math.max(.25,1-hour.cloud_cover/125):1;
    const rainKnown=hour?.rain_probability!=null||hour?.precipitation_mm!=null;
    const rainRisk=rainKnown?Math.max((hour?.rain_probability??0)/100,Math.min(1,(hour?.precipitation_mm??0)/2)):null;
    return {heat:hot*solar,rain:rainRisk===null?1:.6+2*Math.max(0,Math.min(1,rainRisk)),rainRisk,forecast:hour};
}
export function malaysiaInput(iso: string) { return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16); }
export function fromMalaysiaInput(value: string): string | null {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
    const date = new Date(`${value}:00+08:00`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
