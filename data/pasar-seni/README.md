# Pasar Seni–Chinatown–Masjid Jamek source data

The first real pilot is built from the user-supplied `Pasar-seni-osm.json` and `population_district.csv`. Their original bytes are preserved losslessly in `source/*.gz`; SHA-256 values for both original content and archives are recorded in `sources.json`. The import uses the files as public map/statistical data, not as instructions or field verification.

| Input | Source | Data date | Use |
| --- | --- | --- | --- |
| `source/pasar-seni-osm.json.gz` | OpenStreetMap / Overpass, ODbL | `2026-11-18T17:21:50Z` | Real pedestrian geometry, mapped places, entrances and facilities |
| `source/population_district.csv.gz` | DOSM district population; source URL and licence note in `sources.json` | Reference years 2020–2026 | Latest Kuala Lumpur district total and age groups |

The OSM export contains 2,264 nodes, 8,683 ways and 44 relations with no Overpass error remark. All 5,311 highway ways have a point within the pilot bounds. Complete ways can extend slightly outside the boundary; the graph preserves their actual topology. Destinations and facilities are restricted to the pilot.

The strict pedestrian import produces:

| Coverage | Count |
| --- | ---: |
| Graph nodes | 4,588 |
| Pedestrian path segments | 5,142 |
| Mapped crossing segments | 576 |
| Places, including transit destinations | 2,090 |
| Seating, shelters, toilets and water facilities | 153 |
| Mapped entrance records | 310 |
| Approximate approach records | 1,913 |
| Separate connected components | 204 |
| Segments in the largest component | 4,451 |
| Access/facility points without a nearby mapped path connection | 178 |
| Field verification records | 0 |

Approximate approaches are geometric suggestions, not proof of physical access. Missing connections remain missing; routing never inserts a road crossing or joins an overpass by proximity alone. Dataran Merdeka is mapped, but its representative approach is not currently connected under the 30-metre rule. Central Market, Pasar Seni, Petaling Street and Masjid Jamek have routeable source access points. Current checks are still required before rests, step-free access or green route ratings can be claimed.

The 2026 DOSM context is **2,082,300 residents**, including **154,600 aged 65+ (about 7.4%)**, for the entire W.P. Kuala Lumpur district. Source values are in thousands and are converted once. These are estimates for district context, not the population of Chinatown or street-level pedestrian counts.

`bundle.json` contains the processed graph, mapped assets and context. Public verification, hazard and maintenance-report arrays are empty. English and original Malay/OSM names remain searchable; station references distinguish the MRT and LRT places. Mapped venue hours are retained on entrances when no more specific door hours are supplied.

GTFS, station demand, Wikidata and satellite data were not supplied for this import and are explicitly `not_loaded`. Open-Meteo forecasts continue to be fetched separately by the application. No other source was downloaded or silently reused.

To reproduce from the archived files, without access to any external data-source host:

```bash
npm run data:rebuild
npm run gis:export
npm run build:pages
```

The walking dataset fingerprint is independent of the import timestamp. A populated database rejects a different walking dataset so existing reports and checks retain their original targets. Elmina's graph and example destinations are separate and remain unchanged. See [pilot setup and GIS review](../../docs/pasar-seni-pilot.md).
## Central KL coverage beyond the original pilot

The committed expansion adds five neighbourhoods, further walking paths, a wider 2D and 3D basemap, and additional transit and venue records. The base bundle remains the original Pasar Seni source revision. [Coverage, data sources and rebuild instructions](../../docs/central-kl-expansion.md)
