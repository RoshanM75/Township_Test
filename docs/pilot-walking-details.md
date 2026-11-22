# UM and Pasar Seni walking details

**Walk to transit** in Plan and Explore lists nearby Rapid KL rail, bus and feeder stops and shows scheduled service in Malaysia time. Stops with matching OSM station codes use mapped access points. For a road-level bus stop near a mapped footpath, the planner can take the walker to that footpath. The last connection and boarding need separate checks. The walking plan stops at the access point.

The public snapshots use Prasarana's CC BY 4.0 feeds, archived on 3 August 2026 by [data-pulse.my](https://github.com/r3dz4r/datapulse-my/tree/e5203fd9009c26fc31bca77b2b18f6a56413e8d1/samples/gtfs-static). Each source has a capture date and SHA-256 hash. The included feeder timetable only covers August 2026. Its stop locations still appear with that source date. Scheduled service uses the dates published in the feed, calendar exceptions and frequency windows. Confirm service with the operator before travelling. [Official GTFS documentation](https://developer.data.gov.my/realtime-api/gtfs-static.en)

Station activity uses the matched station codes for 24 August 2026 from a [public archive of the official Rapid Rail OD data](https://github.com/changwu/data-gov-my/blob/14a2c0eea4d88581aa588184e8165a68be4a3e32/data/ridership_od_rapidrail_daily/rapidrail_2026_daily.parquet). Use `rapid-rail-od.csv` from the [official dataset](https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily) for an update. If starting from the archived Parquet, export its latest dated rows with the columns `date,origin,destination,ridership`. The importer prefers the publisher's all-stations totals where present.

The two Pasar Seni MRT gate names come from MRT Corp's station plan. Their positions and connections use shared nodes in the OSM pedestrian graph. The station plan shows lifts inside the station. Gate routing covers the mapped walking network and marks information that needs a current check. An OSM wheelchair tag indicates mapped information. [Pasar Seni station plan](https://www.mymrt.com.my/wp-content/uploads/2024/11/S16-PASAR-SENI.pdf)

## Accessibility checks

- **My walking needs** supports a minimum clear path width, tactile paving at crossings and audible pedestrian signals. These choices exclude segments or crossings with missing matching information. The route timeline shows recorded width, kerb ramps, tactile paving, green-phase time and audible signals where available.
- **Explore** shows whether toilet access, backrests, armrests, water and opening hours are mapped or checked. Regular rest requirements continue to use current checks.
- **Verification** in the server version accepts dated path and crossing widths, tactile and audible observations, and lift availability at an entrance that relies on a lift for step-free access. For a walkway closure record `path_open=false`. For an entrance closure record `available=false`. For a lift outage record `lift_available=false`. Use the operator record method and dated source when adding notices from a facilities team. Post a newer observation after reopening. The resident planner shows current verified disruptions and their review dates.
- The public preview reads source snapshots. Operator access and authentication need to be configured before exposing the trusted verification workspace to the public. [Deployment guide](github-pages.md)

## Shade, shelter and severe weather

The Shade map layer estimates shade at representative times of 09:00, 12:00 and 16:00 Malaysia time on the input OSM snapshot date. An offline model projects mapped footprints and explicit heights, or estimates heights from floor counts at three metres per floor. It can also use surveyed canopy footprints and heights. The supplied snapshots use building data. Positive coverage is an estimate for the sampled path, with unmatched locations left unknown. The Roof cover layer uses separate mapped or checked cover for rain planning. A dated field check takes precedence over an estimate.

The app shows MET Malaysia warnings alongside Open-Meteo temperature and rain forecasts. The server proxies and caches the warning API. Pages asks the public API when supported by the browser. The feed's bulletin validity times determine when warnings expire. Warnings mentioning the area are highlighted by place name, and other active regional bulletins remain available. [Malaysia weather API](https://developer.data.gov.my/realtime-api/weather)

## Updating the source files

```sh
npm run data:details
npm run db:setup
npm run build:pages
```

`data:details` builds the two walking-detail snapshots from the included OSM archives and any supplemental files. It preserves each base walking graph's dataset ID. The database setup adds the named gates and refreshes context without replacing existing paths or verification history. Pages publishes the public context, with private audits remaining in the server database. The standard Pasar Seni OSM importer can also start from a local Geofabrik PBF. [Source acquisition](pasar-seni-pilot.md)

To fetch current Prasarana feeds, run `npm run data:details -- --fetch-gtfs` from an environment that can reach the official API. For offline ingestion, put publisher ZIPs in `.local/sources/walking-details/` or use `--sources-dir`. The script reads `rail.zip`, `bus.zip` and `feeder.zip`. Use `--archive-url` and `--archive-date YYYY-MM-DD` when building from a dated archive. Previous feeds remain available when a source download fails. Check each coverage date before publishing.

| File in the source directory | Input |
| --- | --- |
| `um-shuttle.zip` and `um-shuttle.source.json` | Current UM operator GTFS with reuse permission. The source JSON has `url`, `license` and `data_at`. Until supplied, the UM shuttle link opens the operator's information. [UM Transport](https://jhb.um.edu.my/transport) |
| `pasar-seni.shade.geojson` or `um-campus.shade.geojson` | Reusable local WGS84 polygons with `kind` set to `canopy` or `building` and numeric `height_m` on each feature. The collection includes `source_url`, `license` and `data_at`. |
| `rapid-rail-od.csv` | Published station-to-station journeys. Counts describe transit trips and feed the district context panel. |
| `<area>.wikidata.json` | Geographic Wikidata SPARQL JSON results. Existing landmark links come from IDs in OSM. |
| `<area>.scenes.json` | Sentinel-2 or ESA WorldCover STAC search results. The app displays scene metadata and footprints to support survey planning. |

**About this map and its sources** links to UM's Inclusive Map, the Central Market audit from IncluCity, the MRT Corp plan and the DBKL landscape plan. Check the applicable reuse terms before importing any operator surveys. DOSM population figures apply to the district and stay outside route planning.
