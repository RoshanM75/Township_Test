import type { JourneyRoute, VerificationRecord } from './walking.ts';
import type { PathEdge } from './routing.ts';
import { evidenceFor } from './verification.ts';

export interface TimelineItem { id: string; title: string; detail: string; start_min: number; end_min: number; distance_m: number; edge_id?: number; point: [number, number]; kind: 'path' | 'crossing' | 'rest' | 'connection' | 'turn' | 'arrival' }
export type WalkLanguage = 'en' | 'ms';

export function walkTimeline(route: JourneyRoute, edges: PathEdge[], records: VerificationRecord[], language: WalkLanguage = 'en'): TimelineItem[] {
    const say = (en: string, ms: string) => language === 'ms' ? ms : en;
    const lookup = new Map(edges.map(e => [e.id, e]));
    const result: TimelineItem[] = [];
    for (const [index, step] of (route.steps ?? []).entries()) {
        const edge = step.edge_id === undefined ? undefined : lookup.get(step.edge_id);
        const evidence = edge ? evidenceFor(records, edge.is_crossing ? 'crossing' : 'path', edge.id, route.arrival_at) : {};
        const covered = evidence.covered ? evidence.covered.status === 'verified' ? evidence.covered.value : null : edge?.covered;
        const slope = evidence.slope_pct ? evidence.slope_pct.value : edge?.slope_pct;
        const describe = (key: 'has_kerb_ramp' | 'has_tactile' | 'audible_signal' | 'ped_green_s' | 'clear_width_m', name: string, unit = '') => {
            const fact = evidence[key];
            if (fact?.status === 'stale') return say(`${name} check overdue`, `${name} perlu disemak semula`);
            const value = fact?.value ?? edge?.[key];
            if (value === null || value === undefined) return '';
            const rendered = typeof value === 'boolean' ? (value ? say('yes', 'ya') : say('no', 'tidak')) : `${value}${unit}`;
            return `${name} ${rendered} (${fact?.status === 'verified' ? say('checked', 'disemak') : fact?.status === 'reported' ? say('reported', 'dilaporkan') : say('mapped', 'dipetakan')})`;
        };
        const kind = step.kind === 'turn' ? 'turn' : step.kind === 'rest' ? 'rest' : step.kind === 'connection' ? 'connection' : edge?.is_crossing ? 'crossing' : 'path';
        const title = kind === 'crossing' ? `${say('Crossing', 'Lintasan')} · ${step.name}`
            : kind === 'rest' ? `${say('Rest', 'Rehat')} · ${step.name}`
            : kind === 'turn' ? say(step.name, 'Mula perjalanan pulang')
            : step.name.startsWith('Footpath ') ? say('Follow the mapped footpath', 'Ikut laluan pejalan kaki pada peta') : step.name;
        const detail = kind === 'turn' ? say('Follow the return path. Your planned rest intervals still apply.',
            'Ikut laluan pulang dan teruskan rehat mengikut jadual.')
            : kind === 'rest' ? say('Planned rest, including the connection to the facility', 'Rehat terancang termasuk laluan ke tempat rehat')
            : kind === 'connection' ? say('Check the connection on site', 'Semak sambungan laluan di lokasi')
            : [covered === true ? say('Roof cover recorded', 'Bumbung direkodkan')
                : covered === false ? say('No roof cover recorded', 'Tiada bumbung direkodkan') : say('Roof cover unknown', 'Maklumat bumbung belum diketahui'),
                typeof slope === 'number' ? `${say('Slope', 'Kecerunan')} ${slope}%` : say('Slope unknown', 'Kecerunan belum diketahui'),
                describe('clear_width_m', say('Clear width', 'Lebar laluan bebas halangan'), ' m'),
                ...(kind === 'crossing' ? [
                    evidence.crossing_type?.status === 'verified' ? say('Crossing type currently checked', 'Jenis lintasan telah disemak')
                        : say('Crossing needs confirmation', 'Lintasan perlu disahkan'),
                    describe('has_kerb_ramp', say('Kerb ramps', 'Ramp bebendul')),
                    describe('has_tactile', say('Tactile paving', 'Jubin taktil')),
                    describe('audible_signal', say('Audible signal', 'Isyarat bunyi')),
                    describe('ped_green_s', say('Green phase', 'Tempoh lampu hijau'), ' s'),
                ] : [])].filter(Boolean).join(' · ');
        const previous = result.at(-1);
        if (previous && kind === 'path' && previous.kind === kind && previous.title === title && previous.detail === detail) {
            previous.end_min = step.end_min; previous.distance_m += step.distance_m;
        } else result.push({ id: `step-${index}`, title, detail, kind, start_min: step.start_min, end_min: step.end_min, distance_m: step.distance_m, ...(step.edge_id === undefined ? {} : { edge_id: step.edge_id }), point: step.coordinates[0] });
    }
    result.push({ id: 'arrival', title: route.return_walk ? say('Back at your start', 'Kembali ke titik mula') : `${say('Arrive', 'Tiba')} · ${route.entrance.name}`, kind: 'arrival', start_min: route.total_min,
        end_min: route.total_min, distance_m: 0, point: route.coordinates.at(-1)!, detail: say('Times are estimates. Conditions may change during the walk.', 'Masa adalah anggaran. Keadaan boleh berubah semasa berjalan.') });
    return result;
}

export function routeSketch(coordinates: [number, number][]) {
    const safe = coordinates.filter(p => p.length === 2 && p.every(Number.isFinite));
    if (!safe.length) return { points: '', start: [20, 20], end: [20, 20] };
    const cos = Math.cos(safe[0][0] * Math.PI / 180);
    const xs = safe.map(p => p[1] * cos), ys = safe.map(p => -p[0]);
    const minX = Math.min(...xs), minY = Math.min(...ys), scale = Math.min(560 / (Math.max(...xs) - minX || 1), 300 / (Math.max(...ys) - minY || 1));
    const points = safe.map((_, i) => [20 + (xs[i] - minX) * scale, 20 + (ys[i] - minY) * scale]);
    return { points: points.map(p => p.map(n => n.toFixed(2)).join(',')).join(' '), start: points[0], end: points.at(-1)! };
}
