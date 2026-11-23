# Walking data and provenance

For the **Pasar Seni–Chinatown–Masjid Jamek primary pilot**, see [source acquisition and GIS review](pasar-seni-pilot.md) and the [included source assessment](../data/pasar-seni/README.md). The real user-supplied OSM export and 2026 DOSM population context are included, with compressed original downloads and checksums. Its data pipeline is separate from the retained Elmina example described below. `npm run data:rebuild` regenerates the KL bundle without network access to the source hosts.

See the [UM campus source notes](../data/um-campus/README.md) for the separate campus and approaches import.

## Local place directories

Setup and the Pages build join published visitor facts to the original OpenStreetMap feature references. The two pilot directories contain 12 matched entries. The Pasar Seni directory also adds Perdana Botanical Gardens and six entrances connected to the archived walking graph. Operator hours and public contact information are separate from field observations. Route planning evaluates known weekly hours in Malaysia time. A venue’s published holiday exceptions remain visible on its card. [Pasar Seni directory](../data/pasar-seni/local-places.json) · [UM directory](../data/um-campus/local-places.json)

- Central Market’s operator publishes daily opening hours. Tourism Malaysia identifies Kasturi Walk. DBKL publishes public toilet locations and hours for Perdana Botanical Gardens. The health ministry identifies Klinik Kesihatan Tanglin. Tanglin stays discoverable while a mapped pedestrian connection is missing. [Central Market](https://centralmarket.com.my/) · [Tourism Malaysia](https://www.malaysia.travel/storage/files/pdf/2026-Malaysia-Surreal-Experience.pdf) · [DBKL toilets](https://www.dbkl.gov.my/fasiliti-awam/tandas-awam) · [DBKL parks](https://www.dbkl.gov.my/fasiliti-awam/taman-awam/taman-botani-perdana) · [KKM clinics](https://www.moh.gov.my/fasiliti-kesihatan/klinik-kesihatan/wp-kuala-lumpur)
- Universiti Malaya publishes library hours, student clinic information, facilities at Perdanasiswa and information on Tasek Varsiti. [UM library](https://umlib.um.edu.my/opening-hours-amp-locations) · [UM student clinic](https://hep.um.edu.my/KLINIK%20KESIHATAN%20UM/SKIM%20PERUBATAN%20KESIHATAN%20%28GL%29.pdf) · [Perdanasiswa](https://www.um.edu.my/perdanasiswa-complex) · [Tasek Varsiti](https://www.um.edu.my/tasek-varsiti)
- The DBKL market workbook and Overture Places were unavailable to download in the import environment. A functioning citywide asset inventory and live maintenance feed would also need operator data. [DBKL open data catalogue](https://www.dbkl.gov.my/data-statistik/data-terbuka) · [Overture Places](https://docs.overturemaps.org/guides/places/)

## Included Elmina source

`precinct.json` is an OpenStreetMap/Overpass JSON snapshot included in the repository. Its `timestamp_osm_base` is `2026-10-18T18:50:06Z`. Normal setup processes this local file; it does not contact an external routing API or download a new dataset.

OpenStreetMap data is available under the [Open Database Licence](https://www.openstreetmap.org/copyright). Preserve **© OpenStreetMap contributors** attribution and the applicable data-licence requirements when distributing derived data. The interactive map already includes contributor attribution.

The 3D basemap draws streets, buildings, footpaths, water, parks and place labels from committed OpenStreetMap extracts. The supplementary street, rail and landscape data is used for display. The walking graphs are built from their independent pedestrian source bundles. [Pasar Seni map context](../data/pasar-seni/source/map-context-source.json) · [UM map context](../data/um-campus/source/map-context-source.json) · [Elmina map context](../data/elmina/sources.json)

The 2D street map loads standard OpenStreetMap tiles over the bundled geometry. The default tile URL is `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. The build supports changing the OpenStreetMap tile endpoint with `NEXT_PUBLIC_OSM_TILE_URL`. [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)

The 3D map bundles Noto Sans glyphs under the SIL Open Font License for local label rendering. [Glyph source](https://github.com/maplibre/demotiles/tree/601ae60796ceceda2cbd2ed3d2ea92d17a84be4b/font/Noto%20Sans%20Regular) · [Font licence](../public/map-fonts/OFL.txt)

## Pedestrian import policy

`scripts/osm-to-graph.mjs` includes:

- Dedicated `footway`, `path`, `pedestrian`, `steps` and mapped crossings.
- `cycleway`, `service` and `track` ways only when `foot=yes`, `foot=designated` or `foot=permissive` explicitly permits public walking.
- Ways with unspecified general access only when their way type already supports walking under this import policy.

It excludes road carriageways, prohibited or restricted foot access, and private/no general access unless there is an explicit public foot exception. General streets are excluded even when they have a permissive foot tag: separately mapped pedestrian paths or crossings are needed for the current prototype.

The imported graph contains 547 nodes, 602 pedestrian edges, 35 mapped crossings and one steps segment. It retains OSM way IDs, the source highway type and a pedestrian access flag. PostGIS stores actual point/line geometry and indexes it for spatial checks.

The router also rejects `street` edges and edges explicitly marked as inaccessible to pedestrians. Wheelchair and mobility profiles still apply their walking accessibility constraints to the permitted pedestrian network.

## Coverage and confidence

`lib/precinct.ts` uses Elmina OSM path node 8447864418 between two bridge destinations named in OSM, on the same walking component. Tests verify both sample walks fit the default 30-minute budget for all three mobility profiles. The earlier sample node required a long mapped detour and exceeded that budget. Routes cannot be inferred across a missing pedestrian link, and coverage outside this snapshot requires additional mapping.

Covered and lighting tags are weak hints marked `modelled`; unspecified shade, lighting, slope and surface attributes are not silently converted into audited observations. Routing fallback assumptions help compare walks but do not verify on-the-ground conditions. Resident reports are stored separately and affect subsequent route planning.

Structured observations now live in `verification_records`, separate from the OSM import and maintenance reports. Each checked field has an observation time, review deadline, method and observer label; missing and expired checks never become green just because a route is the best available option. `walking_assets` records real places, separate entrances and rest facilities. Initial setup seeds the two mapped bridge access points as unverified and does not invent benches or audits. See the [walking planner guide](walking-planner.md).

The original mixed-use `graph.json`, generated `graph.sql`, GeoJSON and shapefiles remain reference material. The normal importer does not load their road segments. Generated pedestrian output is written to `.local/pedestrian-graph.json`.

## Updating the source later

Supply a new Overpass `out geom` JSON file and point `npm run db:seed -- --source ...` at it in a separate database. Snapshot boundaries, missing paths and access tags all affect connectivity. Review the resulting network before adopting it for the project's next stage.

Edge IDs are deterministic for one dataset but can change when the dataset changes. A database fingerprint blocks a different import over existing edges, preserving the relationship between reports, audits and their original paths.
