# TownshipGo pedestrian model

The model is about the walking world, not photorealistic landmark replicas. Both renderers, route planning, field inspection and the operator's infrastructure comparison use source-addressable pedestrian features. The existing TownshipGo weighted walking graph, route IDs, entrance anchors, profile preferences, rest requirements and report workflow are retained.

## Using the new features

- In Resident, open **Layers → Walking layer**. See all levels, surface paths, elevated links, underground links, unspecified indoor levels or a specifically mapped floor. This changes the view, not your saved or active route. A bridge layer is relative ordering; a building floor or layer number is not a measured elevation.
- **Pedestrian details** shows the procedural low-poly walking layer: mapped roof strips, bridge decks, stair markings, ramp shapes, tactile indications, benches, entrance, lift and amenity symbols. At lower zoom only larger features render. The detailed 2D map and the original street style remain available. Schematic widths and height offsets are explicitly display-only. Step bands use the recorded count when available (simplified at large counts); no count means a symbolic pattern. A ramp next to steps is not a confirmed step-free link.
- Tap a mapped feature to inspect its available attributes, origin and data date where known. There is a source list and downloadable survey CSV/GeoJSON under **Layers → Data sources and survey gaps**. The operator's Maintenance impact page offers the same downloads. The gap rows are *survey targets*, not confirmed defects: geometry, source reference, missing fields and associated stable edge/asset IDs when available. GeoJSON opens in QGIS/QField for structured offline inspection.
- The walking graph connects mapped shared nodes, not coincident longitude/latitude. Explicitly contradictory floor junctions are separated; a genuine mapped stair/ramp/vertical connector still needs its actual endpoint links. Do not infer station indoor paths or lift connections from a lift pin. Recorded public-access hours are applied at planning/entry/exit; unsupported opening-hours expressions remain unknown. Route checks and existing active reports retain priority over open-map estimates.
- **Access and conditions** shows hourly Open-Meteo apparent temperature, solar beam intensity, cloud cover, humidity and precipitation alongside the existing timeline. The Coolest and Sheltered search weights use the forecast at the time each edge would be travelled, and high rain risk can favour a roof-covered alternative without relaxing access requirements. Geometry shade is estimated separately from weather. Cloud-adjusted weights are relative planning scores, not a measured street-level temperature or a guarantee of comfort. The existing official MET Malaysia feed is shown separately; a warning or outage is not inferred as a safe walking condition.
- **Advanced access and rest settings → Require checked continuous tactile guidance** is optional, defaults off, and requires current positive segment checks rather than relying on a mapped tactile point. Reviewer forms accept tactile continuity, physical level connection, measured deck height, step count, kerb height and passage hours. The Walk screen offers ordered manual step review, optional read-aloud in English or Malay, and attention vibrations under the existing device preferences when optional GPS guidance is enabled. It does not tell anyone to cross, certify a route for a blind walker or determine a building floor from GPS. Position and walking history remain on the device.
- **Dashboard → Maintenance impact** compares closures, kerb ramps, replacing steps with a step-free connection, lift repairs, and proposed roof, tree canopy, seat or new link between two real mapped nodes. Choose the start, profile, time, duration and up to eight scenarios. Results show reachable places, journey time savings, full reachable path segments, roof-covered metres, modelled/unknown shade and reachable rest locations. The proposal geometry uses the same corridor/crown generator and solar model as the map. A proposed link assumes a straight step-free connection (1.8 m width, 5% grade); roof/crown dimensions are design inputs; roof cover is counted for the full path only if the proposal spans the mapped or explicitly assumed path width. Replacement stairs assume a feasible 8% grade. Results are isolated, hypothetical comparisons, not new live facilities, work orders, accessibility certification, or actual construction feasibility.

## Shared data and provenance

`walking-world-source.mjs` reads the committed, openly redistributable OSM archives and optional public supplemental model clips. `pedestrian-model.mjs` produces schematic map geometry, way-level facts and survey targets. `pedestrian-external.mjs` validates external source lineage. The build generates:

| Product | Role |
| --- | --- |
| `public/map-area/<area>.geojson` | 2D and 3D common geometry |
| `<area>-world.json` | OpenSidewalks-inspired source-addressable facts and counts, graph-specific shade fractions, sources |
| `<area>-shade.json` | Source-qualified building parts, roofs and crowns (when available), preserving holes and bases |
| `<area>-survey-gaps.csv` and `.geojson` | Offline field survey inventory |

The shared solar model computes sun position and ray intersections with actual qualified geometry. It uses recorded heights, floor-count estimates and imported reusable height/canopy estimates, not generic display volumes, decorative benches or schematic walkway elevations. It respects holes and suppresses building envelopes when mapped parts represent them. The missing height/canopy inventory is incomplete: no intersecting modelled object means *unknown*, not proven full sun. The representative morning/midday/afternoon samples are generated by the same model, linked to the graph fingerprint. Dated checks remain in the operator database and are not published as open source data. Roof coverage observations remain distinct from shadow estimates. Current model ignores terrain occlusion between surfaces and detailed crown transmissivity; it is not a UMEP/SOLWEIG or measured thermal-comfort result.

The KL and UM sources are the dated OpenStreetMap-derived extracts already included under `data/`. [Full source lineage and pinned archives](central-kl-expansion.md). OSM database and derivative map data © OpenStreetMap contributors, ODbL. The original street map remains available. No additional paid map provider, API token or commercial basemap is required. [OpenStreetMap licence](https://www.openstreetmap.org/copyright)

### Data products loaded and still pending

| Data product | Reuse / integration |
| --- | --- |
| OpenStreetMap / archived Overpass and Geofabrik data | **Loaded.** Actual mapped geometries, height/floor/surface/cover/level/accessibility tags. ODbL. Existing dataset dates and expansion lineage retained. |
| Copernicus GLO-90 via Open-Meteo | **Loaded existing local grid.** CC BY 4.0; relief, contours, ground model. Not a measured ramp gradient. |
| [Open-Meteo](https://open-meteo.com/en/docs) | **Connected.** Current weather and 72-hour temperature, humidity, radiation, cloud and precipitation forecast. Free hosted API for non-commercial pilot use; weather data CC BY 4.0. Check [service terms](https://open-meteo.com/en/terms) before a commercial hosted deployment. |
| [MET Malaysia warning API](https://developer.data.gov.my/realtime-api/weather) | **Existing connection.** Official warning feed with outage handling; not a private weather sensor. |
| [Prasarana GTFS](https://developer.data.gov.my/realtime-api/gtfs-static.en), DOSM, local place data | **Existing dated snapshots retained.** Check timetable validity and station access; map pins do not establish inside-station links. |
| [Overture Maps Buildings](https://docs.overturemaps.org/guides/buildings/) | **Importer implemented, actual new extract pending.** ODbL; bbox-clipped building footprints, height and floor attributes, stable GERS IDs. OSM geometry takes priority; overlapping buildings are not duplicated. |
| [Google Open Buildings 2.5D Temporal](https://sites.research.google/gr/open-buildings/temporal/) | **Importer implemented, actual raster pending.** CC BY 4.0 or ODbL, Malaysia covered. Annual height estimates 2016–23; output pixels are finer than effective spatial resolution (~4 m). The importer samples local matched footprints; missing, thin or capped ~100 m estimates are not used, and recorded heights/floors are preserved. |
| [Meta/WRI CHMv2](https://registry.opendata.aws/dataforgood-fb-forestsv2/) | **Importer implemented, actual raster pending.** CC BY 4.0, cite Meta and WRI (2026), source imagery © 2016 Vantor. Aggregate to 5/10 m model surfaces in a 35 m buffer around mapped paths; retain tile observation dates. Do not count individual trees or infer physical crown bases from a height raster. |
| ETH 10 m canopy, Dynamic World, ESA WorldCover, Microsoft footprints | Potential legally reusable supplementary context; **not loaded in this update**. Land-cover class alone cannot establish tree heights. Check product/version-specific coverage and terms before importing. |
| UM/DBKL tree inventories, UM Inclusive Map, station interior layouts, IncluCity, imagery, government geospatial catalogues | Useful references and survey partners. No current reusable point-level export supplied for these new features. Do not scrape or relabel reference maps as licensed routing evidence. |
| GlobalBuildingAtlas LoD1/heights | Not used because of non-commercial restrictions on those products. |

In this implementation environment the direct Google storage, Overture STAC/S3 and Meta/WRI S3 data hosts were denied by the managed network policy; the requested allowlist confirmation did not complete. No satellite raster or external building extract is being presented as loaded. In particular, the archived OSM extracts contain mapped wooded land/parks, but no qualified individual tree crown geometries. The app does not manufacture a tree inventory. The normal offline build uses the actual archived OSM data and remains functional without these supplemental sources.

## Reproduce the external import

Obtain official local clips **in an environment permitted to reach those providers**, using the documented release/catalogue. The clipping areas are `[south, west, north, east]`: Central KL `[3.116,101.665,3.162,101.720]`, UM `[3.109,101.634,3.136,101.671]`, Elmina `[3.16,101.49,3.20,101.53]`.

- Export Overture `building` as WGS84 GeoJSON via the [official bbox download client](https://docs.overturemaps.org/getting-data/). Preserve `id`, `height`, `num_floors`, `min_height`, actual release and attribution. Optionally include the official `building_part` export in the same FeatureCollection with its `building_id` and dimensions. Linked parts of newly imported parents render separately; existing OSM outlines and mapped parts are retained rather than overwritten.
- Download the Google dataset's **actual height band** for the selected year from the [dataset download instructions](https://sites.research.google/gr/open-buildings/temporal/). Export or mosaic a georeferenced, one-band local height GeoTIFF in metres; do not use a colour-rendered map image.
- Obtain the relevant CHMv2 GeoTIFF and its observation-date metadata from the [official registry](https://registry.opendata.aws/dataforgood-fb-forestsv2/). Use one consistent dated clip, or import tiles with their correct observation date instead of guessing the year.

System Python with GDAL/OGR and NumPy is needed only during data preparation, not by the web app. For example, with real files and their real dates:

```sh
npm run data:map
python3 scripts/import-pedestrian-data.py pasar-seni \
  --overture /path/to/kl-building.geojson --overture-release YYYY-MM-DD \
  --google-height /path/to/kl-2023-height.tif --google-year 2023 \
  --canopy /path/to/kl-chmv2.tif --canopy-observed YYYY-MM-DD
npm run data:map
npm run build:pages
```

Repeat for `um-campus` or `elmina`; flags for sources without a clip can be omitted. This generates `data/<area>/source/pedestrian-external.json.gz` with clipped geometry, source dates, licenses and SHA-256 of each supplied file. Re-running with only a subset replaces the sidecar; provide the full set of desired inputs together. The builder accepts only the recognized lawful sources and validates bounds and dimensions. Review the coverage counters and geometry before publishing the derived dataset. When publishing a combined OSM/Overture-derived database, preserve ODbL and all required source attribution. A reusable published survey can instead use `data/<area>/source/pedestrian-survey.geojson` with `source_url`, free redistribution `license`, `data_at`, polygon records with `kind` (`building` or `canopy`) and `height_m`; specify `osm_ref` for existing building footprints. Keep private inspection documents out of the published archive. Actual field observations belong in the verification API.

## Real-world survey priorities

1. **Safe, continuous connections:** missing pedestrian segments and legal public access; actual entrance locations; bridge/underpass clear width, deck height, served floor, staircase connections, operating hours, lift doors/availability and working conditions. A mapped lift location alone is not an accessible connector.
2. **Accessibility:** measured incline, minimum unobstructed width, kerb ramp on *both* crossing ends, kerb height, step count, tactile continuity/damage, audible signals and real green timing, surface condition; measure each relevant segment. Test actual journeys with users who rely on those features.
3. **Shade and shelter:** dated tree/crown extent and height (especially UM and Perdana Gardens), tree removal/planting, roof start/end points/width/height and open gaps, bridge height and indoor passages. Building heights without a source need ground or reusable official GIS data. Satellite estimates cannot verify current path-level conditions.
4. **Rest and arrival:** seat condition, backrest, armrests, step-free approach and wheelchair space; actual accessible toilet, drinking-water facility, opening hours, tags for public/customer-only access and fees. Check whether indoor spaces are genuinely available for pedestrian shelter.
5. **Repeat checks:** use the report-to-check-to-fix process, observation dates, expiry and source IDs. Current verified corrections determine the condition and route; a static mapped object remains a dated context layer rather than a claim it still exists.

## Reference projects and future scaling

- [OpenSidewalks](https://github.com/OpenSidewalks/OpenSidewalks-Schema) informs path/connector attributes; the app retains its own stable graph and is not claiming full schema certification.
- [OSM2World](https://github.com/tordanik/OSM2World) informs procedural building and pedestrian geometry. We use lightweight MapLibre native extrusions, canvas and reusable ribbons, rather than shipping a full simulator or manually modelling buildings.
- [AccessMap](https://github.com/TaskarCenterAtUW/AccessMap) and [Project Sidewalk](https://github.com/ProjectSidewalk/SidewalkWebpage) are references for accessibility-first routing and structured auditing. [QGIS](https://qgis.org/) and [QField](https://docs.qfield.org/) can work with the source-linked gap export.
- [UMEP/SOLWEIG](https://umep-docs.readthedocs.io/projects/tutorial/en/latest/Tutorials/IntroductionToSolweig.html) and [CoolWalks](https://github.com/henrik-wolf/CoolWalks) are references for solar/thermal and shaded walking research. Current tests cover analytic ray geometry, holes, measured deck heights and forecast effects; field validation against independent measured/shadow observations remains needed.
- [Planetiler](https://github.com/onthegomap/planetiler) and [PMTiles](https://github.com/protomaps/PMTiles) are good next scaling options when the pilot expands beyond compact area clips. For the present areas, downloaded local GeoJSON, spatial solar indexes, zoom-dependent rendering, cached map sources and the existing local planning worker avoid an additional tile service or large runtime GIS dependency.

## Tests

`npm test` includes real archive generation, floor topology, provenance, shadow holes, route restrictions, guidance, weather ranking and isolated proposal tests. `npm run lint`, `npm run typecheck`, `npm run build:pages`, `npm run build`, `npm run test:integration` check the existing app. To exercise all three raster/footprint import adapters with explicitly synthetic test fixtures (never published as real data), run `python3 tests/pedestrian-import.test.py` with GDAL/NumPy installed.
