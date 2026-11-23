import { evidenceFor, openingAt } from './verification.ts';
import type { VerificationRecord, WalkingAsset } from './walking.ts';

export function placeHours(asset: WalkingAsset, at: string, records: VerificationRecord[]) {
    const evidence = evidenceFor(records, asset.kind === 'entrance' ? 'entrance' : 'facility', asset.id, at).opening_hours;
    const checked = evidence?.status === 'verified';
    const directory = typeof asset.properties.official_hours === 'string';
    const value = checked ? evidence.value : directory ? asset.properties.official_hours : asset.properties.opening_hours;
    const hours = typeof value === 'string' ? value : null;
    return { hours, open: openingAt(hours, at), source: checked ? 'Field check' : directory ? 'Published hours' : 'Mapped hours' };
}
