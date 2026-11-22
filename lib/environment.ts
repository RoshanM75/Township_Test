import type { PathEdge } from './routing.ts';
import { slotForHour } from './routing.ts';
import { evidenceFor, malaysiaHour } from './verification.ts';
import type { VerificationRecord } from './walking.ts';

export type EnvironmentLayer = 'paths' | 'shade' | 'cover' | 'lighting' | 'observations';
export type EnvironmentSource = 'checked' | 'reported' | 'mapped' | 'modelled' | 'expired' | 'unknown';
export interface EnvironmentSegment {
    id: number; name: string; geometry: [number, number][];
    value: number | boolean | null; source: EnvironmentSource; detail: string;
}

function conditionLabel(field: string, value: unknown) {
    const surfaces: Record<number, string> = { 1: 'Good', 2: 'Uneven', 3: 'Broken' };
    const names: Record<string, string> = { path_open: 'Path open', has_steps: 'Steps present', covered: 'Roof cover',
        slope_pct: 'Slope', surface_rating: 'Surface', has_kerb_ramp: 'Kerb ramps', has_refuge: 'Crossing refuge',
        clear_width_m: 'Clear width', has_tactile: 'Tactile paving', audible_signal: 'Audible signal',
        crossing_type: 'Crossing type', crossing_width_m: 'Crossing width', ped_green_s: 'Pedestrian green time',
        shade_morning: 'Morning shade', shade_midday: 'Midday shade', shade_afternoon: 'Afternoon shade', lit_ratio: 'Lit portion' };
    const text = typeof value === 'boolean' ? (value ? 'Yes' : 'No')
        : field === 'surface_rating' ? (surfaces[Number(value)] ?? 'Unknown')
            : (field.startsWith('shade_') || field === 'lit_ratio') && typeof value === 'number' ? `${Math.round(value * 100)}%`
                : `${value}${field === 'slope_pct' ? '%' : ['crossing_width_m', 'clear_width_m'].includes(field) ? ' m' : field === 'ped_green_s' ? ' s' : ''}`;
    return `${names[field] || field.replaceAll('_', ' ')}: ${text}`;
}

/** Display information only. Layer colours never change route feasibility or
 * turn missing information into a positive accessibility/safety assessment. */
export function environmentSegments(edges: PathEdge[], records: VerificationRecord[], instant: string, layer: EnvironmentLayer): EnvironmentSegment[] {
    const grouped = new Map<string, VerificationRecord[]>();
    for (const record of records) {
        const key = `${record.target_type}:${record.target_id}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(record);
    }
    const slot = slotForHour(malaysiaHour(instant));
    return edges.filter(edge => edge.pedestrian_access !== false && edge.kind !== 'street').map<EnvironmentSegment>(edge => {
        const base = { id: edge.id, name: edge.name || `Footpath ${edge.id}`, geometry: edge.geometry };
        if (layer === 'paths') return { ...base, value: true, source: 'mapped', detail: 'Mapped pedestrian path; physical conditions need checking.' };
        const target = edge.is_crossing ? 'crossing' : 'path';
        const evidence = evidenceFor(grouped.get(`${target}:${edge.id}`) ?? [], target, edge.id, instant);
        if (layer === 'observations') {
            const checked = Object.entries(evidence).filter(([, e]) => e.status === 'verified').map(([field, e]) => conditionLabel(field, e.value));
            return { ...base, value: checked.length ? true : null, source: checked.length ? 'checked' : 'unknown',
                detail: checked.length ? `Current checks: ${checked.join(', ')}. Other conditions may remain unknown.` : 'No current field checks. This does not establish a path condition.' };
        }
        if (layer === 'shade' && slot === 'night') return { ...base, value: null, source: 'unknown', detail: 'Choose a daylight departure to inspect shade information.' };
        const field = layer === 'cover' ? 'covered' : layer === 'lighting' ? 'lit_ratio' : `shade_${slot}`;
        const fact = evidence[field];
        const raw = fact ? fact.value : (edge as unknown as Record<string, unknown>)[field];
        const valid = layer === 'cover' ? typeof raw === 'boolean' : typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1;
        const source: EnvironmentSource = fact?.status === 'stale' ? 'expired' : fact?.status === 'verified' ? 'checked'
            : fact?.status === 'reported' ? 'reported' : fact ? 'unknown' : valid
                ? (layer === 'shade' && edge.shade_source === 'modelled' ? 'modelled' : 'mapped') : 'unknown';
        const value = valid && source !== 'expired' && source !== 'unknown' ? raw as number | boolean : null;
        const description = value === null ? (source === 'expired' ? 'The latest check is overdue.' : 'No current information recorded.')
            : typeof value === 'boolean' ? (value ? 'Roof cover recorded.' : 'Recorded without roof cover.')
                : `${Math.round(value * 100)}% ${layer === 'shade' ? 'shade' : 'lighting'} ${source === 'modelled' ? 'estimated' : 'recorded'}.`;
        return { ...base, value, source, detail: `${description} ${source === 'modelled' ? 'Daylight estimate from mapped heights and any supplied canopy geometry.' : source === 'mapped' ? 'Map information; not a current field check.' : source === 'reported' ? 'Community report; not yet checked.' : source === 'checked' ? 'Dated check for this condition only.' : 'Unknown does not mean absent.'}` };
    });
}

export function environmentCoverage(segments: EnvironmentSegment[]) {
    return { total: segments.length, known: segments.filter(s => s.value !== null).length,
        checked: segments.filter(s => s.source === 'checked' && s.value !== null).length,
        modelled: segments.filter(s => s.source === 'modelled' && s.value !== null).length,
        expired: segments.filter(s => s.source === 'expired').length };
}
