import type { VerificationTarget } from './walking';
export interface ObservationField { key: string; label: string; kind: 'boolean' | 'number' | 'text' | 'choice'; min?: number; max?: number; percent?: boolean; options?: string[]; crossingOnly?: boolean }
const PATH_FIELDS: ObservationField[] = [
    { key: 'path_open', label: 'Path is open and passable', kind: 'boolean' },
    { key: 'has_steps', label: 'Steps are present', kind: 'boolean' },
    { key: 'surface_rating', label: 'Surface: 1 smooth, 2 uneven, 3 broken', kind: 'number', min: 1, max: 3 },
    { key: 'slope_pct', label: 'Measured slope (%)', kind: 'number', min: 0, max: 100 },
    { key: 'clear_width_m', label: 'Narrowest clear path width (metres)', kind: 'number', min: .1, max: 30 },
    { key: 'crossing_type', label: 'Crossing type', kind: 'choice', options: ['signalised', 'zebra', 'uncontrolled'], crossingOnly: true },
    { key: 'has_kerb_ramp', label: 'Kerb ramps are present', kind: 'boolean', crossingOnly: true },
    { key: 'has_tactile', label: 'Tactile paving is present', kind: 'boolean' },
    { key: 'tactile_continuous', label: 'Tactile guidance is continuous and usable for this entire segment', kind: 'boolean' },
    { key: 'level_connection_checked', label: 'Physical connection between mapped levels has been checked', kind: 'boolean' },
    { key: 'deck_height_m', label: 'Measured deck height above local ground (m; elevated path only)', kind: 'number', min: 0, max: 80 },
    { key: 'opening_hours', label: 'Passage access hours: 24/7, or Mo-Fr 09:00-17:00', kind: 'text' },
    { key: 'step_count', label: 'Number of steps on this segment', kind: 'number', min: 0, max: 500 },
    { key: 'kerb_height_m', label: 'Highest kerb at crossing (metres)', kind: 'number', min: 0, max: 1, crossingOnly: true },
    { key: 'audible_signal', label: 'Audible pedestrian signal is working', kind: 'boolean', crossingOnly: true },
    { key: 'crossing_width_m', label: 'Crossing width (metres)', kind: 'number', min: .1, max: 100, crossingOnly: true },
    { key: 'ped_green_s', label: 'Pedestrian green phase (seconds)', kind: 'number', min: 0, max: 300, crossingOnly: true },
    { key: 'has_refuge', label: 'Crossing refuge is present', kind: 'boolean', crossingOnly: true },
    { key: 'covered', label: 'Entire segment has roof cover', kind: 'boolean' },
    { key: 'shade_morning', label: 'Morning shade (%)', kind: 'number', min: 0, max: 100, percent: true },
    { key: 'shade_midday', label: 'Midday shade (%)', kind: 'number', min: 0, max: 100, percent: true },
    { key: 'shade_afternoon', label: 'Afternoon shade (%)', kind: 'number', min: 0, max: 100, percent: true },
    { key: 'lit_ratio', label: 'Lit portion (%)', kind: 'number', min: 0, max: 100, percent: true },
];
const ASSET_FIELDS: ObservationField[] = [
    { key: 'tactile_continuous', label: 'Continuous tactile guidance to and through this access point is checked', kind: 'boolean' },
    { key: 'available', label: 'Access point or facility is available', kind: 'boolean' },
    { key: 'path_connection', label: 'Physical connection to the mapped footpath checked', kind: 'boolean' },
    { key: 'step_free', label: 'Connection and access point are step-free', kind: 'boolean' },
    { key: 'clear_width_m', label: 'Clear width at the access point (metres)', kind: 'number', min: .1, max: 30 },
    { key: 'has_seat', label: 'Usable seating is present', kind: 'boolean' },
    { key: 'wheelchair_space', label: 'Level space for a wheelchair to rest', kind: 'boolean' },
    { key: 'sheltered', label: 'Shelter is present', kind: 'boolean' },
    { key: 'backrest', label: 'Seat has a backrest', kind: 'boolean' },
    { key: 'armrests', label: 'Seat has armrests', kind: 'boolean' },
    { key: 'accessible_toilet', label: 'Toilet access checked', kind: 'boolean' },
    { key: 'water_available', label: 'Drinking water available', kind: 'boolean' },
    { key: 'public_access', label: 'Access terms', kind: 'choice', options: ['public','customers','destination','permission','private'] },
    { key: 'fee', label: 'A fee or purchase is required', kind: 'boolean' },
    { key: 'opening_hours', label: 'Hours: 24/7, or Mo-Fr 09:00-17:00', kind: 'text' },
    { key: 'connection_length_m', label: 'Measured connection length (metres)', kind: 'number', min: 0, max: 100 },
];
export function observationFields(target: VerificationTarget) {
    if (target === 'path' || target === 'crossing') return PATH_FIELDS.filter(f => !f.crossingOnly || target === 'crossing');
    return target === 'entrance' ? [...ASSET_FIELDS, {
        key: 'lift_available', label: 'Lift required for step-free access is working', kind: 'boolean',
    } satisfies ObservationField] : ASSET_FIELDS;
}
