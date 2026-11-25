import { isWalkingProfile, type Mode } from './routing.ts';

export function readWalkParameters(
    params: Pick<URLSearchParams, 'get'>,
    destinationIds: readonly string[],
    defaultOrigin: [number, number],
) {
    const lat = Number.parseFloat(params.get('startLat') ?? '');
    const lng = Number.parseFloat(params.get('startLng') ?? '');
    const hasOrigin = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const destination = params.get('destId');
    const hasDestination = destination !== null && destinationIds.includes(destination);
    const profile = params.get('profile');
    const mode = params.get('mode');

    return {
        origin: hasOrigin ? [lat, lng] as [number, number] : defaultOrigin,
        destination: hasDestination ? destination : destinationIds[0],
        profile: isWalkingProfile(profile) ? profile : 'senior',
        mode: (['direct', 'coolest', 'sheltered', 'safest'].includes(mode ?? '') ? mode : null) as Mode | null,
        fromLink: hasOrigin || hasDestination,
    };
}

export function readSharedDeparture(value: string | null): string | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const instant = Date.parse(value);
    return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}
