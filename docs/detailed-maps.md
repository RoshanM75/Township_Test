# Detailed 2D and 3D maps

The map update retains the existing resident layout and the routing, accessibility, weather, reports and verification models. It affects the display layer only. Basemap paths, buildings, elevations and labels must not be used as a new field check or to infer an accessible connection.

## What is displayed

Both resident maps are built from the same committed, dated OpenStreetMap archives, including the existing Central KL expansion. The richer extraction includes complete multipolygon outlines and holes, building sections, roof/canopy polygons, named land uses, parks, sports pitches, water areas, pedestrian plazas, parking areas, bridges, rail alignments and progressively more detailed labels. Steps, crossings, roof cover, private/restricted alignments and underground connections have distinct line styles; these are map tags, not accessibility determinations.

The detailed 2D view uses a viewport-culled, high-DPI canvas with collision-filtered names, road casings, building outlines and subtle cartographic shadows, plus the existing interactive route and facility layers above it. The original OpenStreetMap street tiles remain available in **Layers → Map appearance → Original street map** and outside the local detailed extent. If external tiles are unavailable, local geometry continues to provide a basemap. The 3D view uses MapLibre, differentiated building sections and elevation-dependent volumes, consistent street detail and zoom-dependent place labels. Tap an eligible mapped building, path or label for its available source detail. On maps used to pick a report or verification location, location selection still takes priority.

For every building, the display distinguishes an explicit mapped height, a height estimated from mapped floors (3 m per floor plus mapped roof height), and a low, simplified visual-only volume for unknown dimensions. The use of mapped building parts avoids extruding an entire parent outline through those parts. Roof forms with no surveyed geometry are simplified; these are not architectural or photorealistic building models. Unknown heights and cartographic offsets do not enter the solar model. The existing `*-shade.json` outputs are unchanged compared with the previous map build; calculated cast shadows can now be viewed in the detailed 2D view as well as 3D.

### Map coverage (generated snapshot)

| Area | Prior map features | Detailed map features | Building footprints/parts | Named place labels |
| --- | ---: | ---: | ---: | ---: |
| Central KL | 20,808 | 24,533 | 6,139 | 3,542 |
| Universiti Malaya | 11,083 | 11,726 | 5,135 | 1,265 |
| Elmina | 2,084 | 2,154 | 864 | 31 |

These counts include display geometry, labels and contours, not newly verified paths. The map has 475 separately tagged building parts across KL and UM. The covered area and walking graph IDs are unchanged. Some neighbourhoods still have missing building footprints, actual dimensions and detailed connections. The 3D font bundle supports Latin/Latin-1 and general punctuation; source names in other scripts are retained in the data and 2D labels, where available. See [Central KL map sources](central-kl-expansion.md) and [OSM licence and attribution](https://www.openstreetmap.org/copyright).

## Terrain source and display

A fixed public-coordinate grid was obtained on **28 November 2026** using the [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api), based on the Copernicus DEM GLO-90 2021 release, source resolution 90 m. The three local archives contain 3,977 elevation samples at 0.00125-degree intervals (about 139 m in these locations). The exact coordinates, sample values, retrieval time, data attribution and licence are recorded in `data/{area}/source/elevation-grid.json`. This is a coarse elevation model, not a survey of footpath slopes, kerbs or bridge levels. Interpolation smooths the cartography and does not improve the source resolution.

| Area | Samples | Elevation range in sampled extent |
| --- | ---: | ---: |
| Central KL | 1,927 | 17–151 m |
| Universiti Malaya | 825 | 28–136 m |
| Elmina | 1,225 | 19–132 m |

`node scripts/build-map-area.mjs` builds the local hillshade raster, 20 m contours, metadata and RGB elevation tiles deterministically without API calls or extra dependencies. Both maps use the **Terrain relief** switch in Layers. The normal 3D building view uses hillshade and contours with a flat ground plane so street and route labels remain readable. **3D ground terrain** enables the actual interpolated height mesh at 1× height. A collision-filtered screen-space label overlay preserves place names in this mode. Relief is valid within the archived grid; edge pixels in the outer tiles are padded for rendering, and terrain outside the pilot is not surveyed.

Attribution: Copernicus DEM (2021, GLO-90) via Open-Meteo, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data information: [Open-Meteo data licence](https://open-meteo.com/en/license), [Copernicus DEM collection](https://doi.org/10.5270/ESA-c5d3d65). The source data were downloaded for the educational pilot. The committed data and generated maps require no further elevation API calls. Any later API refresh or commercial service usage must follow the provider's applicable terms.

Refresh the archive for a non-commercial educational pilot using `python scripts/fetch-map-elevation.py pasar-seni um-campus elmina`. The capture script requests fixed grid coordinates in bounded batches, not residents' locations. Review the resulting grid and provenance before updating a deployed snapshot.
