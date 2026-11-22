import type { PathNode, PathEdge, HazardReport, HazardKind } from './routing';
import type { MaintenanceDefect } from './types';
import type { WalkingData } from './walking';
import { IS_PAGES_PREVIEW, dataPath } from './site.ts';
import { weatherUrl, parseWeather, unavailableWeather, type WalkingWeather } from './comfort.ts';
import { DEFAULT_ORIGIN } from './precinct.ts';
import { PILOTS,type PilotId,type PilotContext } from './pilots.ts';
import { parseWeatherWarnings, unavailableWarnings, warningUrl, type WeatherWarnings } from './weather-warnings.ts';

export interface GraphData {
    nodes: PathNode[];
    edges: PathEdge[];
    source: { name: string; pedestrian_only: boolean; attribution: string; snapshot_at?: string|null;area_id?:PilotId;dataset_id?:string;
        origin?:PilotContext['origin'];featured_ids?:string[] };
}

export interface ReportInput {
    area_id?:PilotId;
    lat: number;
    lng: number;
    kind: HazardKind;
    edge_id?: number;
    description?: string;
    reported_by_proxy?: boolean;
}

async function request<T>(url: string, options?: RequestInit,area?:PilotId): Promise<T> {
    if (IS_PAGES_PREVIEW && options?.method && options.method !== 'GET') {
        throw new Error('Shared updates are unavailable in the public preview. Nothing was submitted.');
    }
    const response = await fetch(dataPath(url,area), { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request failed. Please try again.');
    return data as T;
}

export const loadGraph = (area?:PilotId) => request<GraphData>('/api/graph',undefined,area);
export const loadPilotContext = (area:PilotId) => request<PilotContext>('/api/pilot-context',undefined,area);
export const loadWalkingData = async (area?:PilotId) => {
    const data = await request<WalkingData>('/api/walking-data',undefined,area);
    // The source is fixed, but the planning clock follows the visit.
    return IS_PAGES_PREVIEW ? { ...data, as_of: new Date().toISOString() } : data;
};
export const createWalkingAsset = (asset: unknown) => request<{ id: string }>('/api/assets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(asset),
});
export const recordVerification = (record: unknown) => request<{ id: string }>('/api/verifications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
});
export const loadHazards = (area?:PilotId) => request<{ hazards: HazardReport[] }>('/api/hazards',undefined,area);
export const loadReports = (status: 'all' | 'open' = 'open',area?:PilotId) => request<{ reports: MaintenanceDefect[] }>(`/api/reports?status=${status}`,undefined,area);
export const submitReport = (report: ReportInput) => request<{ hazard: HazardReport; report: MaintenanceDefect }>('/api/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
});
export const markReportFixed = (id: string,area?:PilotId) => request<{ report: { id: string; status: string } }>(`/api/reports/${encodeURIComponent(id)}/fix`, { method: 'POST' },area);

export async function loadWeather(area?:PilotId): Promise<WalkingWeather> {
    const now = new Date().toISOString();
    try {
        const response = await fetch(IS_PAGES_PREVIEW ? weatherUrl(area?PILOTS[area].centre:DEFAULT_ORIGIN) : dataPath('/api/weather',area), { signal: AbortSignal.timeout(6000) });
        if (!response.ok) throw new Error('Weather unavailable');
        const value = await response.json();
        return IS_PAGES_PREVIEW ? parseWeather(value, now) : value as WalkingWeather;
    } catch { return unavailableWeather(now); }
}

export async function loadWeatherWarnings(area: PilotId): Promise<WeatherWarnings> {
    try {
        const response = await fetch(IS_PAGES_PREVIEW ? warningUrl() : dataPath('/api/weather-warnings', area),
            { signal: AbortSignal.timeout(6500) });
        if (!response.ok) return unavailableWarnings();
        const value = await response.json();
        return IS_PAGES_PREVIEW ? parseWeatherWarnings(value, area) : value as WeatherWarnings;
    } catch {
        return unavailableWarnings();
    }
}
