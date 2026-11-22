# Central KL pedestrian pilot

The primary area is **Pasar Seni–Chinatown–Masjid Jamek**. The original two Elmina bridge destinations remain a separate, labelled example. Use the Walking area selector, `/resident?area=pasar-seni` or `/resident?area=elmina`; old links containing an Elmina bridge identifier still open the example.

The real OSM and DOSM source files are included. See the [source assessment and coverage counts](../data/pasar-seni/README.md). Use `npm run data:rebuild` to reproduce the base snapshot from compressed original downloads. A separate walking-details snapshot adds dated GTFS timetables, mapped access and facility facts, Wikidata links and shade estimates. See [source update commands](pilot-walking-details.md).

## Source acquisition

No account, hosted database subscription or paid map/routing API is needed. Imports are explicit maintenance commands, not a download every time someone plans a walk.

| Source | Implemented use | Interpretation |
| --- | --- | --- |
| OpenStreetMap / Overpass | Pedestrian graph, real places, mapped entrances and facilities | ODbL attribution. Missing paths stay missing. Mapping does not verify condition or public availability. |
| Geofabrik regional PBF | Alternative input for the same OSM network, clipped using the free `osmium` tool | ODbL. Not a second independent verification of OSM. |
| Malaysia GTFS | Local rail, bus and feeder stops, serving routes and calendar ranges | CC BY 4.0 per official documentation. Stop coordinates do not establish usable station entrances; this version does not predict train arrivals. |
| Rapid Rail daily OD | Latest matched local station entry/exit journeys | Not pavement footfall. Unmatched station identifiers leave demand unavailable until a crosswalk is reviewed. |
| DOSM district population | District population and share aged 65+, converting source thousands | Context for Kuala Lumpur, not a neighbourhood population estimate or a route score. |
| Wikidata | Geographic landmark names and background links | CC0 structured data. No photo reuse is implied. |
| Open-Meteo | Hourly feels-like temperature and rain at the selected area's location | Free non-commercial API and attribution; forecasts are not street sensor readings. Weather outages remain unavailable. |
| Sentinel-2 / ESA WorldCover | Scene metadata and GIS footprint layers | Published resolutions/licences apply. No canopy percentage, street thermal map or exact shade is inferred from a footprint. |

Enable these HTTPS download hosts in the cloud environment's **Additional allowed domains**, preserving existing entries: `overpass-api.de`, `download.geofabrik.de`, `api.data.gov.my`, `storage.data.gov.my`, `storage.dosm.gov.my`, `openapi-malaysia-transport.s3.ap-southeast-1.amazonaws.com`, `query.wikidata.org`, `www.wikidata.org`, `planetarycomputer.microsoft.com`. Existing weather access uses `api.open-meteo.com`; public tiles use `tile.openstreetmap.org`. This is cloud network configuration, separate from GitHub repository environments and website publishing.

```bash
npm run data:refresh
npm run gis:export
npm run db:setup
npm run build:pages
```

The required OSM download must succeed and include a connected walking component with mapped destinations. Optional sources have individual loaded/partial/unavailable states, shown in **About this map and its sources**. Original source dates, retrieval dates and SHA-256 hashes are retained separately; a new retrieval date never pretends the underlying data is new.

Raw downloads stay in ignored `.local/sources/pasar-seni/`. Review generated `data/pasar-seni/bundle.json` and `sources.json` before committing them. They contain public source data, with empty verification, report and hazard arrays. The Pages build reads these files and the Elmina snapshot, never the local database. There is no automatic scheduled downloader or billable service.

For a supplied Overpass `out body geom` file use `npm run data:refresh -- --osm-file /path/to/source.json --osm-date YYYY-MM-DDTHH:mm:ssZ`. Optional `--gtfs-rail-file`, `--gtfs-bus-file`, `--gtfs-feeder-file`, `--population-file`, `--ridership-file`, `--wikidata-file` and `--satellite-file` accept original downloaded files. `--reuse` explicitly selects cached files; missing cache entries are not silently represented as fresh downloads. `--ridership-year YYYY` selects an annual OD file when needed.

Add `--offline` to use supplied files without attempting any external downloads. Sources not supplied are marked `not_loaded`. Supplied JSON/CSV files can be losslessly gzipped (`.gz`); the importer retains both the decompressed-content and archive SHA-256 hashes. Population CSVs are streamed and filtered to the district before context calculations. `--raw-dir` can select a separate working cache for an isolated import.

For repeatable larger OSM imports, install the free `osmium-tool`, download the [Geofabrik Malaysia/Singapore/Brunei extract](https://download.geofabrik.de/asia/malaysia-singapore-brunei.html), then run `npm run data:refresh -- --geofabrik-pbf /path/to/extract.osm.pbf --osm-date ORIGINAL_EXTRACT_DATE`. `--fetch-geofabrik` downloads the regional PBF instead. This alternative is optional; normal Overpass imports do not need osmium.

## Spatial rules and QGIS

GIS is directly relevant: the backend already stores PostGIS points/lines and checks distances on geography in metres. Source exports add interoperable GeoJSON and a QGIS project, without another hosting service.

`npm run gis:export` writes `.local/gis/pasar-seni/` with `paths.geojson`, `places.geojson`, `transit.geojson`, `satellite.geojson` and `pasar-seni.qgs`. Layers use WGS84 longitude/latitude (EPSG:4326); the project uses **WGS84 / UTM zone 47N (EPSG:32647)** for local metre-based analysis. The public Pages source panel also links the four GeoJSON layers.

Review connected-component IDs, isolated facilities, station access, road crossings and the `connection_model` attribute. Path junctions come from shared OSM node identities: lines crossing on the map do not create an invented junction between an overpass and the street. Pedestrian one-way tags are honoured. Known conflicting levels are excluded from facility anchors. The strict importer excludes carriageways and private/prohibited foot access, so incompletely mapped pavements can leave real destinations unreachable.

An explicit building/OSM stop-area association can supply a **mapped entrance**. An arbitrary nearby metro door is never assigned to a station by proximity. Places without a mapped door get a clearly labelled **approximate approach**, at most 30 metres from a mapped path. This spatial join is not evidence of physical access across a wall, a working entrance, step-free access or opening hours. More than 30 metres leaves a point unconnected. Unknown conditions remain yellow; strict current-check/rest requirements can produce no matching route.

Satellite scene footprints support locating imagery for subsequent analysis. WorldCover/Sentinel imagery alone cannot establish precise footpath shade, kerb height or working lights. Field checks and any future derived raster measurements must retain their actual date, resolution, method and uncertainty. They must not be inserted as verified observations by this importer.

## Shared data and compatibility

The Next.js APIs accept an explicit `?area=pasar-seni` or `?area=elmina` for graphs, walking data, context, hazards, reports, weather and report fixes. Writes include `area_id`. Legacy API calls without an area keep Elmina behaviour. The browser sends an explicit area for the pilot.

Additive schema changes label existing records Elmina. KL path/asset identifiers have a separate stable namespace. Imports preserve the Elmina graph, reports and audit targets, and reject changing an already-imported KL walking dataset. To adopt changed graph geometry, use a separate database/version and plan an explicit record migration; do not drop a volume or attach old checks to new paths. Context feeds can be refreshed against the same walking dataset.

Personal reports are scoped by area and dataset. Old device records without an area belong to Elmina. Saved packs retain the area, source revision and dates; replanning an Elmina pack opens its own area. A current unfinished walk must be completed before switching areas.

Place search uses imported names locally, without a public geocoder/autocomplete service. Candidate routing is bounded and runs in a local Web Worker to keep the interface responsive. It has a local fallback for browsers without workers. Public OSM map tiles are not bulk-downloaded or cached for offline use.

## Validation and current import status

Automated tests use **clearly labelled synthetic fixtures in temporary directories/databases**, separate from production source files. They check entrance associations, direction restrictions, disconnected networks, CSV/GTFS parsing, population units, source privacy and cross-area writes. Existing Elmina routes remain tested against the actual included OSM snapshot.

The included real KL bundle enables the pilot as the Pages default. Tests exercise actual landmark routes, source/archive hashes, mapped venue hours, unverified rests and district population units, alongside the isolated synthetic edge cases. If a future checkout lacks the KL bundle, Pages can still deploy the actual Elmina example. KL is labelled data pending and disabled, and explicit KL links explain its status. Malformed or private source data still stops the build. Local `--example-only` validation remains available and is refused in GitHub Actions.
