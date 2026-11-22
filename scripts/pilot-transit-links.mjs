import { metres, projectPoint } from '../lib/walking-geometry.ts';

function normal(value) {
    return String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function connectTransitStops(stops, assets, edges) {
    const accessPoints = new Set(assets.filter(a => a.kind === 'entrance' && a.edge_id !== null).map(a => a.parent_id));
    const mappedStations = assets.filter(a => a.kind === 'transit' && accessPoints.has(a.id));
    const ground = edges.filter(e => !e.has_steps && !['corridor', 'steps'].includes(e.kind)
        && ['', '0'].includes(e.layer ?? '') && ['', '0'].includes(e.level ?? '')
        && (!e.bridge || e.bridge === 'no') && (!e.tunnel || e.tunnel === 'no')).map(e => {
        const lng = e.geometry.map(p => p[0]), lat = e.geometry.map(p => p[1]);
        return { edge: e, bounds: [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)] };
    });
    return stops.map(stop => {
        const { walking_asset_id: oldLink, approach: oldApproach, ...place } = stop;
        // Recompute links when a walking snapshot or its entrance associations change.
        void oldLink; void oldApproach;
        const code = normal(stop.code || stop.id.split(':').at(-1));
        const point = [stop.lng, stop.lat];
        const exact = mappedStations.filter(a => String(a.properties.station_ref ?? '').split(';').some(ref => code && normal(ref) === code)
            && metres([a.lng, a.lat], point) < 300);
        if (exact.length === 1) return { ...place, walking_asset_id: exact[0].id };
        if (['rapid-rail-kl'].includes(stop.agency) || stop.location_type !== '0') return place;
        let closest;
        const padding = .00012;
        for (const { edge, bounds } of ground) {
            if (point[0] < bounds[0] - padding || point[0] > bounds[2] + padding ||
                point[1] < bounds[1] - padding || point[1] > bounds[3] + padding) continue;
            const projection = projectPoint(edge.geometry, point);
            if (projection.distance <= 8 && (!closest || projection.distance < closest.distance)) {
                closest = { ...projection, edge: edge.id };
            }
        }
        return closest ? { ...place, approach: { lat: closest.point[1], lng: closest.point[0],
            edge_id: closest.edge, fraction: closest.fraction, distance_m: closest.distance } } : place;
    });
}
