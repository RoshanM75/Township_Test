import type { HazardKind } from '../routing.ts';
import { isPilot,type PilotId } from '../pilots.ts';

export class RequestError extends Error {
    readonly status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

export interface NewReport {
    area_id?: PilotId;
    lat: number;
    lng: number;
    kind: HazardKind;
    edge_id?: number;
    asset_id?: string;
    description: string;
    reported_by_proxy: boolean;
}

const HAZARD_KINDS = ['blocked', 'no_ramp', 'light_out', 'no_shade', 'broken_surface', 'lift_out', 'details_outdated'];

export function validateReport(body: unknown): NewReport {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RequestError('A report object is required.');
    const input = body as Record<string, unknown>;
    const { lat, lng, kind, edge_id, description, reported_by_proxy,area_id, asset_id } = input;
    if(area_id!==undefined&&!isPilot(area_id))throw new RequestError('Choose a supported walking area.');
    if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
        typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) {
        throw new RequestError('A valid latitude and longitude are required.');
    }
    if (typeof kind !== 'string' || !HAZARD_KINDS.includes(kind)) throw new RequestError('Choose a supported pedestrian problem.');
    if (asset_id !== undefined && (typeof asset_id !== 'string' || !/^[1-9]\d{0,17}$/.test(asset_id))) {
        throw new RequestError('Choose a mapped place or facility.');
    }
    if ((kind === 'lift_out' || kind === 'details_outdated') && !asset_id) {
        throw new RequestError('Choose the affected place, entrance or facility.');
    }
    if (edge_id !== undefined && (typeof edge_id !== 'number' || !Number.isSafeInteger(edge_id) || edge_id <= 0)) {
        throw new RequestError('The footpath identifier must be a positive integer.');
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
        throw new RequestError('Report details must be text of at most 2000 characters.');
    }
    if (reported_by_proxy !== undefined && typeof reported_by_proxy !== 'boolean') {
        throw new RequestError('The proxy reporting flag must be a boolean.');
    }
    return { lat, lng, kind: kind as HazardKind, edge_id: edge_id as number | undefined,
        description: (description as string | undefined)?.trim() ?? '', reported_by_proxy: reported_by_proxy === true, ...(typeof asset_id === 'string' ? { asset_id } : {}), ...(isPilot(area_id)?{area_id}:{}) };
}

export function validateReportId(id: string): string {
    if (!/^[1-9]\d{0,17}$/.test(id)) throw new RequestError('The report identifier is invalid.');
    return id;
}

export function validateReportCheck(value: unknown) {
    const input = value as { team?: unknown; note?: unknown; dismiss?: unknown } | null;
    if (typeof input?.team !== 'string' || !input.team.trim() || input.team.trim().length > 120) {
        throw new RequestError('Enter the responsible team.');
    }
    if (typeof input.note !== 'string' || !input.note.trim() || input.note.trim().length > 600) {
        throw new RequestError('Describe what the team checked in 600 characters or fewer.');
    }
    if (input.dismiss !== undefined && typeof input.dismiss !== 'boolean') throw new RequestError('Choose a supported review outcome.');
    return { team: input.team.trim(), note: input.note.trim(), dismiss: input.dismiss === true };
}
