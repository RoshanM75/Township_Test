import assert from 'node:assert/strict';
import { networkCoverage } from '../lib/data/osm.ts';
import { pointInPilot } from '../lib/pilots.ts';
import { metres } from '../lib/walking-geometry.ts';
import { connectTransitStops } from './pilot-transit-links.mjs';

const area = 'pasar-seni';
const unique = (first, second) => [...new Map([...first, ...second].map(item => [item.id, item])).values()];

export function attachKLExpansion(bundle, expansion) {
    assert.equal(expansion.base_dataset_id, bundle.context.dataset_id, 'The KL expansion requires its original graph. Rebuild the expansion for this source.');
    const { graph, assets, paths, facilities, landmarks, sources, neighbourhoods } = expansion;
    const nodes = [...bundle.graph.nodes, ...graph.nodes];
    const edges = [...bundle.graph.edges, ...graph.edges];
    const walkingAssets = [...bundle.walking.assets, ...assets];
    const { coverage } = networkCoverage(nodes, edges, walkingAssets);
    const isFeed = source => source.id.startsWith('gtfs-');
    const feedsChanged = sources.filter(isFeed).some(source => bundle.context.sources.some(current =>
        current.id === source.id && current.sha256 && current.sha256 !== source.sha256));
    const transit = feedsChanged ? {
        ...bundle.context.transit,
        stops: connectTransitStops(bundle.context.transit.stops, walkingAssets, edges),
    } : expansion.transit;
    const edgeIndex = new Map(edges.map(edge => [edge.id, edge]));
    const stationIds = new Set(walkingAssets.filter(asset => asset.kind === 'transit').map(asset => asset.id));
    for (const stop of transit.stops) {
        assert.ok(pointInPilot([stop.lat, stop.lng], area), 'Transit stop outside central KL.');
        if (stop.walking_asset_id) assert.ok(stationIds.has(stop.walking_asset_id), 'Unknown station.');
        if (stop.approach) {
            const { lat, lng, edge_id, fraction, distance_m } = stop.approach;
            assert.ok(edgeIndex.has(edge_id) && pointInPilot([lat, lng], area) &&
                fraction >= 0 && fraction <= 1 && distance_m >= 0 && distance_m <= 8, 'Invalid transit approach.');
        }
    }
    for (const neighbourhood of neighbourhoods) {
        assert.ok(pointInPilot(neighbourhood.coordinates, area), 'Neighbourhood outside central KL.');
        if (neighbourhood.start) assert.ok(edgeIndex.has(neighbourhood.start.edge_id) &&
            pointInPilot(neighbourhood.start.coordinates, area), 'Neighbourhood start requires a mapped footpath.');
    }
    const details = bundle.context.walking_details;
    return {
        ...bundle,
        appended_graph: graph,
        graph: { ...bundle.graph, nodes, edges },
        supplemental_assets: [...bundle.supplemental_assets ?? [], ...assets],
        walking: { ...bundle.walking, assets: walkingAssets },
        context: {
            ...bundle.context, coverage, neighbourhoods, transit,
            sources: unique(bundle.context.sources, feedsChanged ? sources.filter(source => !isFeed(source)) : sources),
            landmarks: unique(landmarks, bundle.context.landmarks),
            walking_details: {
                ...details,
                paths: { ...details?.paths, ...paths },
                facilities: { ...details?.facilities, ...facilities },
            },
        },
    };
}

export function klNeighbourhoods(anchors, graph, origin) {
    const { component } = networkCoverage(graph.nodes, graph.edges, []);
    const originNode = graph.nodes.find(node => node.lat === origin[0] && node.lng === origin[1]);
    const core = originNode && component.get(originNode.id);
    const ordinaryEdges = graph.edges.filter(edge => !edge.has_steps && !edge.is_crossing
        && (!edge.layer || edge.layer === '0') && (!edge.level || edge.level === '0')
        && (!edge.bridge || edge.bridge === 'no') && (!edge.tunnel || edge.tunnel === 'no'));
    return anchors.map(anchor => {
        const [lat, lng] = anchor.coordinates;
        const local = graph.edges.filter(edge => edge.geometry.some(point => metres(point, [lng, lat]) <= 500));
        const pathsByComponent = new Map();
        for (const edge of local) {
            const key = component.get(edge.from_node);
            pathsByComponent.set(key, (pathsByComponent.get(key) ?? 0) + 1);
        }
        // A preset starts on a mapped ground-level path with several nearby connected segments.
        const candidates = ordinaryEdges.flatMap(edge => {
            const key = component.get(edge.from_node);
            if ((pathsByComponent.get(key) ?? 0) < 5) return [];
            return [edge.geometry[0], edge.geometry.at(-1)].flatMap(([x, y]) => {
                const distance = metres([x, y], [lng, lat]);
                return distance <= 100 && pointInPilot([y, x], area)
                    ? [{ coordinates: [y, x], distance, edge_id: edge.id, connected: key === core }] : [];
            });
        });
        const best = candidates.sort((a, b) => a.distance - b.distance || a.edge_id - b.edge_id)[0];
        return { ...anchor, local_paths: local.length, connected_to_core: best?.connected ?? false,
            ...(best ? { start: { coordinates: best.coordinates, edge_id: best.edge_id } } : {}) };
    });
}
