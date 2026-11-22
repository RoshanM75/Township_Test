import type { Mode, Profile, RouteResult } from './routing.ts';
import type { PilotId } from './pilots.ts';

export type VerificationTarget = 'path' | 'crossing' | 'entrance' | 'facility';
export type VerificationState = 'verified' | 'reported' | 'unverified' | 'stale';
export type AssetKind = 'destination' | 'entrance' | 'rest' | 'shelter' | 'toilet' | 'water' | 'transit';
export type PlaceCategory = 'healthcare' | 'food' | 'park' | 'community' | 'shopping' | 'transport' | 'other';
export type ObservationValue = boolean | number | string;

export interface VerificationRecord {
    id: string;
    target_type: VerificationTarget;
    target_id: string;
    status: 'verified' | 'reported' | 'unverified';
    observed_at: string;
    valid_until: string | null;
    reviewer: string;
    method: 'site_visit' | 'photo_review' | 'operator_record' | 'osm_import';
    source_ref: string;
    notes: string;
    attributes: Record<string, ObservationValue>;
    created_at: string;
}

export interface FieldEvidence {
    value: ObservationValue;
    status: VerificationState;
    observed_at: string;
    valid_until: string | null;
    reviewer: string;
    method: VerificationRecord['method'];
    record_id: string;
}

export interface WalkingAsset {
    id: string;
    external_id: string | null;
    parent_id: string | null;
    kind: AssetKind;
    category: PlaceCategory;
    name: string;
    lat: number;
    lng: number;
    source: 'osm' | 'community' | 'survey' | 'gtfs';
    source_ref: string;
    properties: Record<string, ObservationValue>;
    edge_id: number | null;
    edge_fraction: number | null;
    connection_distance_m: number | null;
    anchor_lat: number | null;
    anchor_lng: number | null;
}

export interface WalkingData {
    area_id?: PilotId;
    dataset_id?: string;
    assets: WalkingAsset[];
    verifications: VerificationRecord[];
    as_of: string;
}

export function placeSearchText(asset:WalkingAsset){
    return [asset.name,asset.category,...['osm_name','name_ms','name_en','station_ref'].map(key=>asset.properties[key])].filter(value=>typeof value==='string').join(' ').toLowerCase();
}

export interface WalkingNeeds {
    step_free: boolean;
    max_slope_pct: number;
    avoid_uncontrolled_crossings: boolean;
    avoid_uneven_surfaces: boolean;
    min_clear_width_m: number | null;
    require_tactile_crossings: boolean;
    require_audible_crossings: boolean;
    verified_only: boolean;
    require_rests: boolean;
    rest_interval_min: number;
    rest_duration_min: number;
    rest_backrest: boolean;
    rest_armrests: boolean;
    rest_shelter: boolean;
    budget_min: number;
    speed_mps: number | null;
}

export const DEFAULT_NEEDS: WalkingNeeds = {
    step_free: false, max_slope_pct: 8, avoid_uncontrolled_crossings: false,
    avoid_uneven_surfaces: false, rest_backrest: false, rest_armrests: false, rest_shelter: false,
    min_clear_width_m: null, require_tactile_crossings: false, require_audible_crossings: false,
    verified_only: false, require_rests: false, rest_interval_min: 5,
    rest_duration_min: 2, budget_min: 30, speed_mps: null,
};

export interface JourneyStep {
    kind: 'path' | 'rest' | 'connection' | 'turn';
    name: string;
    edge_id?: number;
    asset_id?: string;
    coordinates: [number, number][];
    distance_m: number;
    start_min: number;
    end_min: number;
}

export interface JourneyRoute extends RouteResult {
    steps?: JourneyStep[];
    return_walk?: boolean;
    entrance: WalkingAsset;
    destination: WalkingAsset;
    rest_stops: WalkingAsset[];
    verified_rest_stops: number;
    rest_min: number;
    total_min: number;
    longest_without_rest_min: number;
    uncovered_m: number;
    unsheltered_m: number;
    unverified_crossings: number;
    unchecked_segments: number;
    evidence_coverage: number;
    suitability: 'red' | 'yellow' | 'green';
    explanations: string[];
    evidence: Array<{ edge_id: number; name: string; missing: string[] }>;
    departure_at: string;
    arrival_at: string;
}

export interface JourneyPlan {
    routes: Partial<Record<Mode, JourneyRoute>>;
    recommended: Mode | null;
    reasons: string[];
}

export interface PlanningInput {
    origin: [number, number];
    destination: WalkingAsset;
    entrance_id?: string;
    profile: Profile;
    needs: WalkingNeeds;
    departure_at: string;
}
