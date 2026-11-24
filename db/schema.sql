CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS path_nodes (
    id BIGINT PRIMARY KEY,
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    geom geometry(Point, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    ) STORED
);

CREATE TABLE IF NOT EXISTS path_edges (
    id BIGINT PRIMARY KEY,
    from_node BIGINT NOT NULL REFERENCES path_nodes(id),
    to_node BIGINT NOT NULL REFERENCES path_nodes(id),
    osm_way_id BIGINT,
    name TEXT,
    source_highway TEXT NOT NULL,
    pedestrian_access BOOLEAN NOT NULL CHECK (pedestrian_access),
    geometry JSONB NOT NULL,
    geom geometry(LineString, 4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":' || geometry::text || '}'), 4326)
    ) STORED,
    length_m DOUBLE PRECISION NOT NULL CHECK (length_m > 0),
    kind TEXT NOT NULL CHECK (kind IN ('footway', 'path', 'pedestrian', 'steps', 'crossing', 'service')),
    surface TEXT,
    has_steps BOOLEAN NOT NULL DEFAULT FALSE,
    slope_pct DOUBLE PRECISION,
    surface_rating INT CHECK (surface_rating IN (1, 2, 3)),
    is_crossing BOOLEAN NOT NULL DEFAULT FALSE,
    crossing_type TEXT CHECK (crossing_type IN ('signalised', 'zebra', 'uncontrolled')),
    crossing_width_m DOUBLE PRECISION,
    ped_green_s DOUBLE PRECISION,
    cycle_s DOUBLE PRECISION,
    has_kerb_ramp BOOLEAN,
    has_refuge BOOLEAN,
    has_tactile BOOLEAN,
    shade_morning DOUBLE PRECISION CHECK (shade_morning BETWEEN 0 AND 1),
    shade_midday DOUBLE PRECISION CHECK (shade_midday BETWEEN 0 AND 1),
    shade_afternoon DOUBLE PRECISION CHECK (shade_afternoon BETWEEN 0 AND 1),
    shade_source TEXT CHECK (shade_source IN ('audited', 'reported', 'modelled', 'assumed')),
    lit_ratio DOUBLE PRECISION CHECK (lit_ratio BETWEEN 0 AND 1),
    lighting_source TEXT CHECK (lighting_source IN ('audited', 'reported', 'modelled', 'assumed'))
);

CREATE TABLE IF NOT EXISTS hazard_reports (
    id BIGSERIAL PRIMARY KEY,
    edge_id BIGINT NOT NULL REFERENCES path_edges(id),
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    kind TEXT NOT NULL CHECK (kind IN ('blocked', 'no_ramp', 'light_out', 'no_shade', 'broken_surface')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'verified', 'fixed')),
    reporter_role TEXT NOT NULL DEFAULT 'resident',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS defect_reports (
    id BIGSERIAL PRIMARY KEY,
    hazard_report_id BIGINT NOT NULL UNIQUE REFERENCES hazard_reports(id),
    edge_id BIGINT NOT NULL REFERENCES path_edges(id),
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('blocker', 'comfort')),
    location_name TEXT NOT NULL,
    estimated_cost_rm DOUBLE PRECISION NOT NULL CHECK (estimated_cost_rm >= 0),
    reported_by_proxy BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending_capex_review' CHECK (status IN ('pending_capex_review', 'fixed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_path_nodes_geom ON path_nodes USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_path_edges_geography ON path_edges USING GIST((geom::geography));
CREATE INDEX IF NOT EXISTS idx_hazard_reports_open ON hazard_reports(edge_id) WHERE status <> 'fixed';
CREATE INDEX IF NOT EXISTS idx_defect_reports_open ON defect_reports(created_at) WHERE status <> 'fixed';

-- Additive upgrade: existing graphs, reports and audits are retained.
ALTER TABLE path_edges ADD COLUMN IF NOT EXISTS covered BOOLEAN;

CREATE TABLE IF NOT EXISTS walking_assets (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT UNIQUE,
    parent_id BIGINT REFERENCES walking_assets(id),
    kind TEXT NOT NULL CHECK (kind IN ('destination', 'entrance', 'rest', 'shelter', 'toilet', 'water', 'transit')),
    category TEXT NOT NULL CHECK (category IN ('healthcare', 'food', 'park', 'community', 'shopping', 'transport', 'other')),
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    geom geometry(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
    source TEXT NOT NULL CHECK (source IN ('osm', 'community', 'survey')),
    source_ref TEXT NOT NULL DEFAULT '',
    properties JSONB NOT NULL DEFAULT '{}',
    edge_id BIGINT REFERENCES path_edges(id),
    edge_fraction DOUBLE PRECISION CHECK (edge_fraction BETWEEN 0 AND 1),
    connection_distance_m DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((edge_id IS NULL) = (edge_fraction IS NULL))
);

CREATE TABLE IF NOT EXISTS verification_records (
    id BIGSERIAL PRIMARY KEY,
    target_type TEXT NOT NULL CHECK (target_type IN ('path', 'crossing', 'entrance', 'facility')),
    target_id BIGINT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('verified', 'reported', 'unverified')),
    observed_at TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ,
    reviewer TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('site_visit', 'photo_review', 'operator_record', 'osm_import')),
    source_ref TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    attributes JSONB NOT NULL CHECK (jsonb_typeof(attributes) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_until IS NULL OR valid_until > observed_at)
);
CREATE INDEX IF NOT EXISTS idx_walking_assets_parent ON walking_assets(parent_id);
CREATE INDEX IF NOT EXISTS idx_verification_target ON verification_records(target_type, target_id, observed_at DESC, id DESC);

-- Existing records belong to the original Elmina example. Area scoping is additive.
ALTER TABLE path_nodes ADD COLUMN IF NOT EXISTS area_id TEXT NOT NULL DEFAULT 'elmina';
ALTER TABLE path_edges ADD COLUMN IF NOT EXISTS area_id TEXT NOT NULL DEFAULT 'elmina';
ALTER TABLE path_edges ADD COLUMN IF NOT EXISTS foot_direction TEXT NOT NULL DEFAULT 'both' CHECK (foot_direction IN ('both','forward','backward'));
ALTER TABLE walking_assets ADD COLUMN IF NOT EXISTS area_id TEXT NOT NULL DEFAULT 'elmina';
ALTER TABLE verification_records ADD COLUMN IF NOT EXISTS area_id TEXT NOT NULL DEFAULT 'elmina';
ALTER TABLE hazard_reports ADD COLUMN IF NOT EXISTS area_id TEXT NOT NULL DEFAULT 'elmina';
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS area_id TEXT NOT NULL DEFAULT 'elmina';
-- Replace the previous two-area checks on an existing installation.
DO $$
DECLARE
    table_name text;
    constraint_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['path_nodes','path_edges','walking_assets','verification_records','hazard_reports','defect_reports']
    LOOP
        constraint_name := table_name || '_area_id_check';
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = table_name::regclass AND conname = constraint_name
              AND strpos(pg_get_constraintdef(oid), 'um-campus') > 0
        ) THEN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I, ADD CONSTRAINT %I CHECK (area_id IN (''elmina'',''pasar-seni'',''um-campus''))',
                table_name, constraint_name, constraint_name);
        END IF;
    END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS idx_path_edges_area ON path_edges(area_id,id);
CREATE INDEX IF NOT EXISTS idx_path_nodes_area ON path_nodes(area_id,id);
CREATE INDEX IF NOT EXISTS idx_walking_assets_area ON walking_assets(area_id,id);
CREATE INDEX IF NOT EXISTS idx_verification_area ON verification_records(area_id,target_type,target_id);
CREATE INDEX IF NOT EXISTS idx_hazard_area ON hazard_reports(area_id,status);
CREATE INDEX IF NOT EXISTS idx_defect_area ON defect_reports(area_id,status);

-- Reports can attach to a named asset without closing the adjacent footpath.
ALTER TABLE hazard_reports ADD COLUMN IF NOT EXISTS asset_id BIGINT REFERENCES walking_assets(id);
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS asset_id BIGINT REFERENCES walking_assets(id);
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS fixed_at TIMESTAMPTZ;
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS responsible_team TEXT;
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS shade_change TEXT CHECK (shade_change IN ('missing_tree', 'removed_awning', 'shade_difference'));
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS map_updated_at TIMESTAMPTZ;
ALTER TABLE hazard_reports ALTER COLUMN edge_id DROP NOT NULL;
ALTER TABLE defect_reports ALTER COLUMN edge_id DROP NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='hazard_reports_has_target' AND conrelid='hazard_reports'::regclass) THEN
        ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_has_target CHECK (edge_id IS NOT NULL OR asset_id IS NOT NULL);
        ALTER TABLE defect_reports ADD CONSTRAINT defect_reports_has_target CHECK (edge_id IS NOT NULL OR asset_id IS NOT NULL);
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hazard_reports_kind_check'
        AND conrelid = 'hazard_reports'::regclass AND strpos(pg_get_constraintdef(oid),'shade_correction') > 0) THEN
        ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_kind_check;
        ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_kind_check
            CHECK (kind IN ('blocked', 'no_ramp', 'light_out', 'no_shade', 'broken_surface', 'lift_out', 'details_outdated', 'shade_correction'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS community_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL,
    area_id TEXT NOT NULL CHECK (area_id IN ('elmina','pasar-seni','um-campus')),
    dataset_id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL,
    points JSONB NOT NULL CHECK (jsonb_typeof(points) = 'array'),
    matched_path JSONB,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','published','verified','declined')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    checked_at TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    reviewer TEXT,
    review_note TEXT,
    UNIQUE (area_id, submission_id)
);
CREATE INDEX IF NOT EXISTS idx_community_routes_area_status ON community_routes(area_id,status,created_at DESC);

ALTER TABLE community_routes ADD COLUMN IF NOT EXISTS opening_hours TEXT;
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- Ownership is recorded against exact pilot targets. Existing cases keep their assigned team.
CREATE TABLE IF NOT EXISTS maintenance_responsibilities (
    area_id TEXT NOT NULL CHECK (area_id IN ('elmina','pasar-seni','um-campus')),
    target_type TEXT NOT NULL CHECK (target_type IN ('edge','asset')),
    target_id BIGINT NOT NULL,
    team TEXT NOT NULL CHECK (char_length(team) BETWEEN 1 AND 120),
    reference TEXT NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 300),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (area_id,target_type,target_id)
);

ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS due_on DATE;
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS work_order_ref TEXT;
ALTER TABLE defect_reports ADD COLUMN IF NOT EXISTS assignment_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS maintenance_assignments (
    report_id BIGINT NOT NULL REFERENCES defect_reports(id),
    version INTEGER NOT NULL CHECK (version > 0),
    team TEXT,
    due_on DATE,
    work_order_ref TEXT,
    source TEXT NOT NULL CHECK (source IN ('responsibility','review','manual')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id,version)
);
