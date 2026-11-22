import type { JourneyRoute, VerificationRecord } from './walking.ts';
import type { PathEdge } from './routing.ts';
import { evidenceFor } from './verification.ts';

export interface TimelineItem { id: string; title: string; detail: string; start_min: number; end_min: number; distance_m: number; point: [number, number]; kind: 'path' | 'crossing' | 'rest' | 'connection' | 'turn' | 'arrival' }
export function walkTimeline(route: JourneyRoute, edges: PathEdge[], records: VerificationRecord[]): TimelineItem[] {
    const lookup = new Map(edges.map(e => [e.id, e]));
    const result: TimelineItem[] = [];
    for (const [index, step] of (route.steps ?? []).entries()) {
        const edge = step.edge_id === undefined ? undefined : lookup.get(step.edge_id);
        const evidence = edge ? evidenceFor(records, edge.is_crossing ? 'crossing' : 'path', edge.id, route.arrival_at) : {};
        const covered = evidence.covered ? evidence.covered.status === 'verified' ? evidence.covered.value : null : edge?.covered;
        const slope = evidence.slope_pct ? evidence.slope_pct.value : edge?.slope_pct;
        const describe = (key: 'has_kerb_ramp' | 'has_tactile' | 'audible_signal' | 'ped_green_s' | 'clear_width_m', name: string, unit = '') => {
            const fact = evidence[key];
            if (fact?.status === 'stale') return `${name} check overdue`;
            const value = fact?.value ?? edge?.[key];
            if (value === null || value === undefined) return '';
            const rendered = typeof value === 'boolean' ? (value ? 'yes' : 'no') : `${value}${unit}`;
            return `${name} ${rendered} (${fact?.status === 'verified' ? 'checked' : fact?.status === 'reported' ? 'reported' : 'mapped'})`;
        };
        const kind = step.kind === 'turn' ? 'turn' : step.kind === 'rest' ? 'rest' : step.kind === 'connection' ? 'connection' : edge?.is_crossing ? 'crossing' : 'path';
        const title = kind === 'crossing' ? `Crossing · ${step.name}` : kind === 'rest' ? `Rest · ${step.name}` : step.name.startsWith('Footpath ') ? 'Follow the mapped footpath' : step.name;
        const detail = kind === 'turn' ? 'Follow the return path. Your planned rest intervals still apply.' : kind === 'rest' ? 'Planned rest, including the connection to the facility' : kind === 'connection' ? 'Check the connection on site'
            : [covered === true ? 'Roof cover recorded' : covered === false ? 'No roof cover recorded' : 'Roof cover unknown',
                typeof slope === 'number' ? `Slope ${slope}%` : 'Slope unknown',
                describe('clear_width_m', 'Clear width', ' m'),
                ...(kind === 'crossing' ? [
                    evidence.crossing_type?.status === 'verified' ? 'Crossing type currently checked' : 'Crossing needs confirmation',
                    describe('has_kerb_ramp', 'Kerb ramps'), describe('has_tactile', 'Tactile paving'),
                    describe('audible_signal', 'Audible signal'), describe('ped_green_s', 'Green phase', ' s'),
                ] : [])].filter(Boolean).join(' · ');
        const previous = result.at(-1);
        if (previous && kind === 'path' && previous.kind === kind && previous.title === title && previous.detail === detail) {
            previous.end_min = step.end_min; previous.distance_m += step.distance_m;
        } else result.push({ id: `step-${index}`, title, detail, kind, start_min: step.start_min, end_min: step.end_min, distance_m: step.distance_m, point: step.coordinates[0] });
    }
    result.push({ id: 'arrival', title: route.return_walk ? 'Back at your start' : `Arrive · ${route.entrance.name}`, kind: 'arrival', start_min: route.total_min,
        end_min: route.total_min, distance_m: 0, point: route.coordinates.at(-1)!, detail: 'Times are estimates. Conditions may change during the walk.' });
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
