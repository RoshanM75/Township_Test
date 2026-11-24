# Central Kuala Lumpur map expansion

Open the **Central KL pilot** and use **Map neighbourhood** to jump to Bangsar, Brickfields, Perdana Botanical Gardens, Pudu or Bukit Bintang. Both 2D and 3D use the expanded local basemap. The 2D view also retains the OpenStreetMap street tiles. Select **Footpaths** under **Map information** to see the walking network. The map selector moves the camera. The starting-point picker sets where route planning begins.

| Area | Available detail |
| --- | --- |
| Bangsar | Bangsar Village, Telawi shops, clinics, rail stops and local footways. A local start is available. The connection to the Pasar Seni network needs more mapping. |
| Brickfields | Connected footways around KL Sentral and Little India, building footprints, station approaches and local businesses. |
| Perdana Botanical Gardens | Paths, six mapped gates, lakes, rest and shelter locations, toilets and DBKL visitor information. [DBKL park listing](https://www.dbkl.gov.my/fasiliti-awam/taman-awam/taman-botani-perdana) |
| Pudu | Street, rail and bus layers, healthcare and local venues. Footpath coverage around Pudu LRT is sparse, and the map has few 3D footprints there. |
| Bukit Bintang | Bintang Walk, mapped crossings, MRT and monorail stops, malls, everyday destinations and footways toward KLCC. |

The walking graph uses OSM ways that allow pedestrians. It connects supplemental ways at shared OSM nodes. An isolated network may support a local walk even when a route to Pasar Seni is unavailable. Path surfaces, cover, lighting, accessibility tags and any published hours keep their source provenance. Current conditions are recorded through the app's existing reporting and verification flow.

## Data and attribution

- The original Central KL archive supplies the core network and the garden park gates. The UM extract supplies Bangsar overlap. [TownshipGo source archives](../data)
- OpenStreetMap Overpass extracts add KL Sentral, KL Eco City, Mid Valley and KLCC geometry, along with regional rail and waterways. [Pinned Map Assets archive](https://github.com/spacingouty09/map-assets/tree/7cf245e3f3bf65c5391545c7474bf1a8831eba41)
- Bukit Bintang building footprints and recorded dimensions use an 8 August 2026 OpenStreetMap extract under ODbL. The shade model uses explicit heights and recorded levels from that extract. [Pinned building archive](https://github.com/crazyowl-idk/canopy/blob/831c322b7ad63417230445f51a1e62acfb2860ce/1-geoai-engine/data/kl_building_heights.geojson)
- Bukit Bintang pedestrian geometry and local places use the two original October 2026 Overpass exports. [Pinned Bukit Bintang archive](https://github.com/Nitteswaran/shadesmart/tree/3454680e5181f37b932616e01e5b61d19e702ebe/data/osm/kl)
- Additional streets use the Kuala Lumpur OSM driving extract for cartography. [Pinned street archive](https://github.com/tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025/tree/73ad6ffdbeb0feb74cace66788788ea049389be5/03_osm_network/road_edges)
- Healthcare points use the May 2024 OSM archive. Additional Pudu venues come from OSM-derived rows of the WheelCheck seed with the original OSM IDs. [Healthcare archive](https://github.com/jerrychong25/malaysia-map-data/tree/c66d725428def71bbcab69f9cb53a6c4b531fe23/healthcare) [Pudu venue archive](https://github.com/sirhafizho/wheelcheck/blob/8e3fcefc3b5d9b9631797f248eb6198cbc3cd88d/data/places-seed.sql.gz)
- Transit stops and routes use the 3 August 2026 Prasarana static GTFS archive, under CC BY 4.0. The export retains service dates and distinguishes mapped approaches and boarding tags. [Prasarana GTFS](https://developer.data.gov.my/realtime-api/gtfs-static.en) [Feed archive](https://github.com/r3dz4r/datapulse-my/tree/e5203fd9009c26fc31bca77b2b18f6a56413e8d1/samples/gtfs-static)

Map data © OpenStreetMap contributors, ODbL. Download the derived pedestrian, place and transit layers in the Pages build at `pilot/pasar-seni/gis/`. Per-source dates and SHA-256 hashes are in the public area context. [OpenStreetMap copyright and licence](https://www.openstreetmap.org/copyright)

## Rebuild the expansion

Normal server and Pages builds use the committed compressed data. To regenerate it, check out the pinned archives above under `.local/sources/kl-expansion/` as `map-assets`, `shadesmart`, `streets`, `facilities` and `wheelcheck`. Put the three Prasarana ZIPs at `.local/sources/walking-details/{rail,bus,feeder}.zip`. The importer checks that the feed ZIPs match those in the original walking-details snapshot.

```sh
npm run data:expand:kl
npm run db:setup
npm run build:pages
```

The expansion uses bounds `[3.116, 101.665, 3.162, 101.720]` in south, west, north, east order. Supply `--osm-file <overpass.json[.gz]> --osm-url <published-url>` to include a wider OSM extract with way geometries, public places and building footprints. The base bundle keeps its dataset and target IDs so existing deployment reports and field checks can continue to point to the same paths and places. Database setup appends the graph and can be repeated.
