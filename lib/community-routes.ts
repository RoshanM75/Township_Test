import { buildGraph, shortestPath, type PathEdge, type PathNode } from './routing.ts';
import { metres, projectPoint } from './walking-geometry.ts';
import { splitPathAnchors, type PathAnchor } from './path-anchors.ts';
import type { PilotId } from './pilots.ts';

export type RoutePoint = [lat: number, lng: number];
export const MAX_COMMUNITY_POINTS = 48;
export type CommunityStatus = 'submitted' | 'published' | 'verified' | 'declined';
export const GUIDE_KINDS = ['general','shortcut','shelter','step_free','entrance'] as const;
export type GuideKind = typeof GUIDE_KINDS[number];
export const GUIDE_LABELS: Record<GuideKind,string> = { general:'Local walking guide',shortcut:'Local connection',shelter:'Sheltered walking suggestion',step_free:'Step-free suggestion',entrance:'Entrance guide' };
export interface CommunityReviewEvent { action:'publish'|'verify'|'decline'; reviewer:string; note:string; checked_at:string; opening_hours:string|null; valid_until:string|null }
export interface CommunityDraft {
    guide_kind?: GuideKind;
    submission_id: string;
    dataset_id: string;
    title: string;
    notes: string;
    points: RoutePoint[];
}
export interface CommunityPath {
    coordinates: RoutePoint[];
    edge_ids: number[];
    length_m: number;
    end: Omit<PathAnchor, 'key'>;
}
export interface CommunityRoute {
    id: string;
    area_id: PilotId;
    dataset_id: string;
    title: string;
    notes: string;
    status: CommunityStatus;
    path: CommunityPath | null;
    created_at: string;
    published_at: string | null;
    checked_at: string | null;
    valid_until: string | null;
    opening_hours: string | null;
    reviewer: string | null;
    review_note: string | null;
    guide_kind?: GuideKind;
    reviews?: CommunityReviewEvent[];
}
export const communityStatusLabel = (route: CommunityRoute, at = new Date().toISOString()) =>
    route.status === 'verified' && route.valid_until && route.valid_until <= at ? 'Field check expired'
        : { submitted: 'Awaiting review', published: 'Community suggestion', verified: 'Field checked', declined: 'Declined' }[route.status];

export function publicRoutePoints(points: RoutePoint[], trimStart: number, trimEnd: number): RoutePoint[] {
    const selected = points.slice(trimStart, points.length - trimEnd);
    const count = Math.min(MAX_COMMUNITY_POINTS, selected.length);
    return Array.from({ length: count }, (_, i) => {
        const [lat, lng] = selected[Math.round(i * (selected.length - 1) / Math.max(1, count - 1))];
        return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
    });
}

/** A reviewed path can be used for navigation only when the proposal is one continuous, directed path. */
export function matchCommunityPath(nodes: PathNode[], edges: PathEdge[], points: RoutePoint[]): CommunityPath | null {
    if (points.length < 2 || points.length > MAX_COMMUNITY_POINTS) return null;
    const publicEdges = edges.filter(edge => edge.pedestrian_access !== false && edge.kind !== 'street' && edge.geometry.length >= 2);
    const anchors: PathAnchor[] = [];
    for (const [index, [lat, lng]] of points.entries()) {
        let best: PathAnchor | null = null;
        let distance = 24;
        for (const edge of publicEdges) {
            const candidate = projectPoint(edge.geometry, [lng, lat]);
            if (candidate.distance < distance) {
                distance = candidate.distance;
                best = { key: String(index), edge_id: edge.id, fraction: candidate.fraction };
            }
        }
        if (!best) return null;
        anchors.push(best);
    }
    const split = splitPathAnchors(nodes, publicEdges, anchors);
    const graph = buildGraph(split.nodes, split.edges);
    const seen = new Set<number>([split.anchors.get('0')!]);
    const coordinates: RoutePoint[] = [];
    const used: number[] = [];
    let length = 0;
    for (let i = 1; i < anchors.length; i++) {
        const from = split.anchors.get(String(i - 1))!;
        const to = split.anchors.get(String(i))!;
        const [p, q] = [points[i - 1], points[i]];
        const straight = metres([p[1], p[0]], [q[1], q[0]]);
        if (straight > 350) return null;
        const part = shortestPath(graph, from, to, { mode: 'direct', profile: 'senior', slot: 'morning', hazards: new Map() }, true);
        if (!part || part.edges.reduce((total, edge) => total + edge.length_m, 0) > Math.max(60, 2 * straight + 25)) return null;
        for (const [j, edge] of part.edges.entries()) {
            const next = part.nodes[j + 1];
            if (seen.has(next)) return null;
            seen.add(next);
            const line = edge.from_node === part.nodes[j] ? edge.geometry : edge.geometry.slice().reverse();
            coordinates.push(...(coordinates.length ? line.slice(1) : line).map(([lng, lat]): RoutePoint => [lat, lng]));
            if (used.at(-1) !== edge.source_edge_id) used.push(edge.source_edge_id!);
            length += edge.length_m;
        }
    }
    if (length < 10 || length > 5000) return null;
    const edge_id = used.at(-1)!;
    const [lat, lng] = coordinates.at(-1)!;
    const { fraction } = projectPoint(publicEdges.find(edge => edge.id === edge_id)!.geometry, [lng, lat]);
    return { coordinates, edge_ids: used, length_m: Math.round(length), end: { edge_id, fraction } };
}
