import { DESTINATIONS } from './precinct.ts';
import { pointInPilot, type PilotContext } from './pilots.ts';
import { nearestEdge, type Graph } from './routing.ts';
import { pointAt } from './walking-geometry.ts';
import type { WalkingAsset } from './walking.ts';

export interface StartPoint {
    id: string;
    label: string;
    coordinates: [number, number];
}

export function presetStartPoints(context: PilotContext, assets: WalkingAsset[], graph: Graph): StartPoint[] {
    const start: StartPoint = { id: 'area-start', label: context.origin.label, coordinates: context.origin.coordinates };
    const nearbyStarts = (context.neighbourhoods ?? []).flatMap(neighbourhood =>
        neighbourhood.start && graph.edges.has(neighbourhood.start.edge_id) ? [{
            id: neighbourhood.id, label: `${neighbourhood.name} walking start`, coordinates: neighbourhood.start.coordinates,
        }] : []);
    const nearest = nearestEdge(graph, ...start.coordinates);
    const originEdge = nearest && graph.edges.get(nearest.edge_id);
    if (!originEdge) return [start];

    // Keep presets on a pedestrian network connected to the area's start.
    const visited = new Set([originEdge.from_node, originEdge.to_node]);
    const queue = [...visited];
    for (let i = 0; i < queue.length; i++) {
        for (const { to } of graph.adj.get(queue[i]) ?? []) {
            if (visited.has(to)) continue;
            visited.add(to);
            queue.push(to);
        }
    }

    const places = context.area_id === 'elmina'
        ? DESTINATIONS.map(bridge => assets.find(asset => asset.external_id === bridge.id))
        : context.featured_ids.map(id => assets.find(asset => asset.id === id));
    const options = [start];
    for (const place of places) {
        if (!place) continue;
        const approaches = assets.flatMap(entrance => {
            if (entrance.kind !== 'entrance' || entrance.parent_id !== place.id
                || entrance.edge_id === null || entrance.edge_fraction === null) return [];
            const edge = graph.edges.get(entrance.edge_id);
            if (!edge || !visited.has(edge.from_node) || !visited.has(edge.to_node)) return [];
            const [lng, lat] = pointAt(edge.geometry, entrance.edge_fraction);
            const coordinates: [number, number] = [lat, lng];
            if (!pointInPilot(coordinates, context.area_id)) return [];
            return [{ entrance, edge, coordinates }];
        });
        const first = approaches.sort((a, b) => Number(a.edge.has_steps) - Number(b.edge.has_steps)
            || (a.entrance.connection_distance_m ?? Infinity) - (b.entrance.connection_distance_m ?? Infinity))[0];
        if (first && !options.some(point => point.coordinates[0] === first.coordinates[0] && point.coordinates[1] === first.coordinates[1])) {
            options.push({ id: place.id, label: place.name, coordinates: first.coordinates });
        }
        if (options.length === 7) break;
    }
    return [...options, ...nearbyStarts.filter(point => !options.some(option =>
        option.coordinates[0] === point.coordinates[0] && option.coordinates[1] === point.coordinates[1]))];
}
