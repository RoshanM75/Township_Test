import { metres, pointAt, sliceLine } from './walking-geometry.ts';
import type { PathEdge, PathNode } from './routing.ts';
import { separateExplicitLevels } from './pedestrian-world.ts';

export interface PathAnchor {
    key: string;
    edge_id: number;
    fraction: number;
}

/** Split edges at points on the network while retaining segment evidence and direction. */
export function splitPathAnchors(nodes: PathNode[], edges: PathEdge[], anchors: PathAnchor[]) {
    ({nodes,edges}=separateExplicitLevels(nodes,edges));
    const byEdge = new Map<number, PathAnchor[]>();
    for (const anchor of anchors) {
        const list = byEdge.get(anchor.edge_id) ?? [];
        list.push({ ...anchor, fraction: Math.round(Math.max(0, Math.min(1, anchor.fraction)) * 1e9) / 1e9 });
        byEdge.set(anchor.edge_id, list);
    }
    const splitNodes = [...nodes], splitEdges: PathEdge[] = [], anchorNodes = new Map<string, number>();
    let nextNode = nodes.reduce((n,v)=>Math.min(n,v.id-1),-1), nextEdge = -1;
    for (const edge of edges) {
        const points = byEdge.get(edge.id) ?? [];
        const fractions = [...new Set([0, 1, ...points.map(point => point.fraction)])].sort((a, b) => a - b);
        const ids = new Map<number, number>([[0, edge.from_node], [1, edge.to_node]]);
        for (const fraction of fractions) {
            if (fraction === 0 || fraction === 1) continue;
            const [lng, lat] = pointAt(edge.geometry, fraction);
            const id = nextNode--;
            splitNodes.push({ id, lat, lng });
            ids.set(fraction, id);
        }
        for (const point of points) anchorNodes.set(point.key, ids.get(point.fraction)!);
        const full = lineLength(edge.geometry) || edge.length_m;
        for (let i = 1; i < fractions.length; i++) {
            const geometry = sliceLine(edge.geometry, fractions[i - 1], fractions[i]);
            const fraction = lineLength(geometry) / full;
            if (fraction < 1e-10 || !Number.isFinite(fraction)) continue;
            splitEdges.push({ ...edge, id: nextEdge--, source_edge_id: edge.id, source_length_m: edge.length_m,
                cost_fraction: fraction, from_node: ids.get(fractions[i - 1])!, to_node: ids.get(fractions[i])!,
                geometry, length_m: edge.length_m * fraction });
        }
    }
    return { nodes: splitNodes, edges: splitEdges, anchors: anchorNodes };
}

function lineLength(line: PathEdge['geometry']) {
    return line.slice(1).reduce((length, point, i) => length + metres(line[i], point), 0);
}
