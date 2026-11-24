import type { ResidentLabel } from './resident-language.ts';

export const SHADE_CHANGES = ['missing_tree', 'removed_awning', 'shade_difference'] as const;
export type ShadeChange = typeof SHADE_CHANGES[number];
export const SHADE_RESULTS = ['sun', 'shade', 'roof_removed'] as const;
export type ShadeResult = typeof SHADE_RESULTS[number];

export const shadeChangeLabel: Record<ShadeChange, ResidentLabel> = {
    missing_tree: 'Missing or removed tree', removed_awning: 'Removed awning', shade_difference: 'Shade differs from the map',
};
