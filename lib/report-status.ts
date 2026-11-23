import type { HazardReport } from './routing.ts';
import type { MaintenanceDefect } from './types.ts';
import type { JourneyRoute } from './walking.ts';

export const reportStatus = (report: MaintenanceDefect) =>
    report.dismissed_at ? 'Dismissed' : report.status === 'fixed' ? 'Fixed' : report.checked_at ? 'Checked' : 'Reported';

export function unavailableAssetIds(hazards: HazardReport[], stepFree: boolean) {
    return new Set(hazards.filter(hazard => hazard.asset_id && hazard.status === 'verified' &&
        (hazard.kind === 'blocked' || (stepFree && (hazard.kind === 'lift_out' || hazard.kind === 'no_ramp'))))
        .map(hazard => hazard.asset_id!));
}


export function checkedRouteReports(route: JourneyRoute, reports: MaintenanceDefect[]) {
    const targets = new Set([route.destination.id, route.entrance.id, ...route.rest_stops.map(rest => rest.id)]);
    return reports.filter(report => report.checked_at && report.status !== 'fixed' &&
        (report.asset_id ? targets.has(report.asset_id) && report.kind !== 'details_outdated' :
            report.edge_id != null && route.edge_ids.includes(report.edge_id)));
}
