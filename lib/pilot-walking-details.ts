import type { PilotContext } from './pilots.ts';
import type { PathEdge } from './routing.ts';
import type { ObservationValue, WalkingData } from './walking.ts';
import { transitApproachAssets } from './transit.ts';

export type PathDetails = Pick<PathEdge, 'clear_width_m' | 'has_tactile' | 'audible_signal' |
    'shade_morning' | 'shade_midday' | 'shade_afternoon' | 'shade_source'>;

export interface PilotWalkingDetails {
    paths: Record<string, PathDetails>;
    facilities: Record<string, Record<string, ObservationValue>>;
    shade?: { model_date: string; buildings: number; crowns: number };
}

export function withMappedDetails(edges: PathEdge[], walking: WalkingData, context: PilotContext) {
    const details = context.walking_details;
    if (!details || walking.dataset_id !== context.dataset_id) return { edges, walking };
    return {
        edges: edges.map(edge => Object.hasOwn(details.paths, edge.id) ? { ...edge, ...details.paths[edge.id] } : edge),
        walking: {
            ...walking,
            assets: [...walking.assets.map(asset => Object.hasOwn(details.facilities, asset.id)
                ? { ...asset, properties: { ...details.facilities[asset.id], ...asset.properties } } : asset),
            ...transitApproachAssets(context)],
        },
    };
}
