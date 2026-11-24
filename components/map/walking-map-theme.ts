import type { WalkingAsset } from '@/lib/walking';

export const WALK_ROUTE = '#8b283f';
export const WALK_ROUTE_HC = '#690f26';
export const ROOF_COVER = '#176759';
export const MAP_CAUTION = '#985013';
export const ROUTE_OUTLINE = '#fffdf8';
export const ROUTE_ALTERNATIVE = '#64616a';

export function mapFacilitySymbol(asset: WalkingAsset) {
    if (asset.kind === 'destination' && asset.category === 'healthcare') return '+';
    return ({ toilet: 'WC', water: 'W', rest: 'S', shelter: '☂', transit: 'T', entrance: 'E' } as Record<string, string>)[asset.kind];
}
