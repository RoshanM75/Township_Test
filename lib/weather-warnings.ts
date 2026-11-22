import type { PilotId } from './pilots.ts';

export const MET_WARNING_SOURCE = 'https://www.met.gov.my/en/index.html';

export interface WeatherWarning {
    id: string;
    title: string;
    description: string;
    instruction: string;
    valid_from: string;
    valid_to: string;
    mentions_area: boolean;
}

export type WeatherWarnings =
    | { status: 'available'; warnings: WeatherWarning[] }
    | { status: 'unavailable'; warnings: [] };

const LOCAL_NAMES: Record<PilotId, RegExp> = {
    'pasar-seni': /\bkuala lumpur\b/i,
    'um-campus': /\b(?:kuala lumpur|petaling(?: jaya)?|universiti malaya)\b/i,
    elmina: /\b(?:selangor|petaling|shah alam)\b/i,
};

export function warningUrl(now = Date.now()) {
    const bucket = Math.floor(now / 300000) * 300000;
    const since = new Date(bucket - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const query = new URLSearchParams({ limit: '100', timestamp_start: `${since}@valid_to` });
    return `https://api.data.gov.my/weather/warning?${query}`;
}

function dateTime(value: unknown) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return null;
    // MET's offset-free bulletin times are Malaysia local time.
    const time = Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}+08:00`);
    return Number.isFinite(time) ? time : null;
}

function plainText(value: unknown, limit: number) {
    return typeof value === 'string'
        ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function unavailableWarnings(): WeatherWarnings {
    return { status: 'unavailable', warnings: [] };
}

export function parseWeatherWarnings(value: unknown, area: PilotId, now = Date.now()): WeatherWarnings {
    if (!Array.isArray(value)) return unavailableWarnings();
    let parsed = 0;
    const warnings = new Map<string, WeatherWarning>();
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const from = dateTime(item.valid_from), to = dateTime(item.valid_to);
        const title = plainText(item.heading_en || item.warning_issue?.title_en || item.heading_bm || item.warning_issue?.title_bm, 180);
        if (from === null || to === null || to <= from || !title) continue;
        parsed++;
        if (from > now || to <= now) continue;
        const description = plainText(item.text_en || item.text_bm, 2400);
        const instruction = plainText(item.instruction_en || item.instruction_bm, 400);
        const id = `${from}:${to}:${title}:${description}`;
        const mentions_area = LOCAL_NAMES[area].test([
            title, description, plainText(item.text_bm, 2400), plainText(item.text_en, 2400),
        ].join(' '));
        warnings.set(id, { id, title, description, instruction, valid_from: new Date(from).toISOString(),
            valid_to: new Date(to).toISOString(), mentions_area });
    }
    if (value.length && !parsed) return unavailableWarnings();
    return { status: 'available', warnings: [...warnings.values()].sort((a, b) =>
        Number(b.mentions_area) - Number(a.mentions_area) || b.valid_from.localeCompare(a.valid_from)) };
}
