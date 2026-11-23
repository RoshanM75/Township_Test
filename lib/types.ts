/** Report fields shared by resident hazard pins and dashboard defects. */
export interface ReportMarker {
    id?: number | string;
    lat?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
    category?: string;
    kind?: string;
    description?: string | null;
}

export interface MaintenanceDefect extends ReportMarker {
    id: number | string;
    hazard_report_id?: string;
    status?: 'pending_capex_review' | 'fixed';
    category: string;
    severity?: 'blocker' | 'comfort';
    estimated_cost_rm?: number | null;
    edge_id?: number | null;
    location_name?: string | null;
    created_at?: string;
    asset_id?: string | null;
    checked_at?: string | null;
    fixed_at?: string | null;
    dismissed_at?: string | null;
    responsible_team?: string | null;
    review_note?: string | null;
}

export interface RouteProperties {
    id: string;
    name: string;
    route_type: 'direct' | 'coolest' | 'night_safe';
    shade_factor: number; // 0.0 to 1.0
    is_lit: boolean;
    surface_temp_base_c: number;
    senior_footfall_daily: number;
    length_meters: number;
    defects: string[];
}

export interface CapExIntervention {
    id: string;
    segment_id: string;
    location_name: string;
    intervention_type: 'tree_planting' | 'solar_light' | 'composite_bench';
    estimated_cost_rm: number;
    senior_footfall_daily: number;
    heat_risk_score: number;
    priority_score: number;
    status: 'proposed' | 'funded' | 'completed';
}
