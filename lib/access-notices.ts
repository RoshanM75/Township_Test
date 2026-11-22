import type { PathEdge } from './routing.ts';
import type { WalkingData } from './walking.ts';
import { evidenceFor } from './verification.ts';
import { pointAt } from './walking-geometry.ts';

export function activeAccessNotices(edges: PathEdge[], data: WalkingData | null, now: string) {
    if (!data) return [];
    const targets = new Map<string, typeof data.verifications>();
    for (const record of data.verifications) {
        const key = `${record.target_type}:${record.target_id}`;
        if (!targets.has(key)) targets.set(key, []);
        targets.get(key)!.push(record);
    }
    return [...targets.entries()].flatMap(([id, records]) => {
        const record = records[0];
        const facts = evidenceFor(records, record.target_type, record.target_id, now);
        const edge = record.target_type === 'path' || record.target_type === 'crossing'
            ? edges.find(edge => String(edge.id) === record.target_id) : null;
        const asset = record.target_type === 'entrance' ? data.assets.find(asset => asset.id === record.target_id) : null;
        if (!edge && !asset) return [];
        const candidates = edge ? [['path_open', 'Walkway closed']] : [['available', 'Entrance unavailable'], ['lift_available', 'Lift out of service']];
        return candidates.flatMap(([field, label]) => {
            const fact = facts[field];
            if (fact?.status !== 'verified' || fact.value !== false) return [];
            const [lng, lat] = edge ? pointAt(edge.geometry, .5) : [asset!.lng, asset!.lat];
            const source = records.find(item => item.id === fact.record_id)?.source_ref;
            return [{ id: `${id}:${field}`, label, name: edge?.name || asset?.name || 'Mapped footpath',
                point: [lat, lng] as [number, number], observed_at: fact.observed_at, review_at: fact.valid_until,
                source: source?.startsWith('https://') ? source : null }];
        });
    }).sort((a, b) => b.observed_at.localeCompare(a.observed_at));
}
