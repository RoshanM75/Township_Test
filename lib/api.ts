import type { PathNode, PathEdge, HazardReport, HazardKind } from './routing';
import type { MaintenanceDefect } from './types';
import type { Assignment, OperatorActivity, OperatorTarget, CoverageRow, Responsibility } from './operator';
import type { WalkingData } from './walking';
import type { CommunityDraft, CommunityRoute, RoutePoint } from './community-routes';
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
    asset_id?: string;
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
export const createWalkingAsset = (asset: unknown, key: string) => request<{ id: string }>('/api/assets', {
    method: 'POST', headers: reviewerHeaders(key), body: JSON.stringify(asset),
});
export const recordVerification = (record: unknown, key: string) => request<{ id: string }>('/api/verifications', {
    method: 'POST', headers: reviewerHeaders(key), body: JSON.stringify(record),
});
export const loadHazards = (area?:PilotId) => request<{ hazards: HazardReport[] }>('/api/hazards',undefined,area);
export const loadReports = (status: 'all' | 'open' = 'open', area?: PilotId, key?: string) =>
    request<{ reports: MaintenanceDefect[] }>(`/api/reports?status=${status}${key ? '&operator=1' : ''}`,
        key ? { headers: reviewerHeaders(key) } : undefined, area);
export const submitReport = (report: ReportInput) => request<{ hazard: HazardReport; report: MaintenanceDefect }>('/api/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report),
});
const reviewerHeaders = (key: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` });
export const markReportFixed = (id: string, area: PilotId, key: string) => request<{ report: MaintenanceDefect }>(
    `/api/reports/${encodeURIComponent(id)}/fix`, { method: 'POST', headers: reviewerHeaders(key) }, area);
export const checkReport = (id: string, area: PilotId, key: string, input: { team: string; note: string; dismiss?: boolean }) =>
    request<{ report: MaintenanceDefect }>(`/api/reports/${encodeURIComponent(id)}/check`,
        { method: 'POST', headers: reviewerHeaders(key), body: JSON.stringify(input) }, area);

export const loadCommunityRoutes = (area: PilotId, receipt?: string, chosenId?: string) => request<{ routes: CommunityRoute[] }>(
    `/api/community-routes?${new URLSearchParams({ ...(receipt ? { receipt } : {}), ...(chosenId ? { id: chosenId } : {}) })}`, undefined, area);
export const submitCommunityRoute = (area: PilotId, draft: CommunityDraft) => request<{ route: CommunityRoute }>('/api/community-routes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, public_ends: true }),
}, area);
export const loadCommunityQueue = (area: PilotId, key: string) =>
    request<{ routes: Array<CommunityRoute & { points: RoutePoint[] }> }>('/api/community-routes?review=1',
        { headers: reviewerHeaders(key) }, area);
export const reviewCommunityRoute = (area: PilotId, id: string, key: string, body: unknown) =>
    request<{ route: CommunityRoute }>(`/api/community-routes/${encodeURIComponent(id)}/review`,
        { method: 'POST', headers: reviewerHeaders(key), body: JSON.stringify(body) }, area);

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


export const loadOperatorActivity = (area: PilotId, key: string, days: number) =>
    request<OperatorActivity>(`/api/operator/activity?days=${days}`, { headers: reviewerHeaders(key) }, area);

export const loadOperatorTargets = (area: PilotId, key: string, query: URLSearchParams) => request<{
    as_of: string; dataset_id: string; coverage: CoverageRow[]; targets: OperatorTarget[]; total: number; offset: number; next_offset: number | null;
}>(`/api/operator/targets?${query}`, { headers: reviewerHeaders(key) }, area);

export const updateResponsibility = (area: PilotId, key: string, input: Pick<OperatorTarget, 'target_type' | 'target_id'> &
    { team: string | null; reference?: string }) => request<{ responsibility: Responsibility | null }>('/api/operator/targets', {
        method: 'PUT', headers: reviewerHeaders(key), body: JSON.stringify(input),
    }, area);

export const loadAssignmentHistory = (area: PilotId, key: string, id: string) => request<{ history: Assignment[] }>(
    `/api/reports/${encodeURIComponent(id)}/assignment`, { headers: reviewerHeaders(key) }, area);

export const updateReportAssignment = (area: PilotId, key: string, id: string,
    input: Pick<Assignment, 'team' | 'due_on' | 'work_order_ref' | 'version'>) => request<{ report: MaintenanceDefect }>(
    `/api/reports/${encodeURIComponent(id)}/assignment`, {
        method: 'PATCH', headers: reviewerHeaders(key), body: JSON.stringify(input),
    }, area);

export async function downloadOperatorData(area: PilotId, key: string, dataset: 'cases' | 'checks', format: 'csv' | 'geojson' | 'json', days = 30) {
    const response = await fetch(dataPath(`/api/operator/export?dataset=${dataset}&format=${format}&days=${days}`, area),
        { headers: reviewerHeaders(key), cache: 'no-store' });
    if (!response.ok) throw new Error((await response.json()).error || 'The data could not be exported.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `townshipgo-${area}-${dataset}.${format}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
