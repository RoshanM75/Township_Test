#!/usr/bin/env python3
"""Capture a small, dated elevation grid for the educational pilot.

The Open-Meteo API provides Copernicus DEM GLO-90 elevations (90 m source
resolution). The archive is sampled at about 140 m; no user coordinates are
sent. Builds consume these committed data files without contacting the API.
"""
import argparse
import datetime
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
# Fixed pilot extents, with a narrow buffer so the centre's relief is not clipped.
BOUNDS = {
    "pasar-seni": (3.116, 101.665, 3.162, 101.720),
    "um-campus": (3.109, 101.634, 3.136, 101.671),
    "elmina": (3.16, 101.49, 3.20, 101.53),
}
STEP = 0.00125
ENDPOINT = "https://api.open-meteo.com/v1/elevation"


def fetch(area, start_count):
    south, west, north, east = BOUNDS[area]
    # Align the bounds to the sampling grid. Include at least one cell of margin.
    s, w = math.floor(south / STEP) - 1, math.floor(west / STEP) - 1
    n, e = math.ceil(north / STEP) + 1, math.ceil(east / STEP) + 1
    width, height = e - w + 1, n - s + 1
    points = [(round(y * STEP, 7), round(x * STEP, 7))
              for y in range(n, s - 1, -1) for x in range(w, e + 1)]
    elevations = []
    for i in range(0, len(points), 100):
        batch = points[i:i + 100]
        # Respect the published API limits even when each location is counted.
        if start_count[0]:
            time.sleep(12)
        query = urllib.parse.urlencode({
            "latitude": ",".join(str(p[0]) for p in batch),
            "longitude": ",".join(str(p[1]) for p in batch),
        }, safe=",")
        request = urllib.request.Request(f"{ENDPOINT}?{query}", headers={"User-Agent": "TownshipGo educational pilot (dated elevation archive)"})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.load(response)["elevation"]
        if len(data) != len(batch) or not all(isinstance(v, (int, float)) and math.isfinite(v) and -100 <= v < 1000 for v in data):
            raise ValueError(f"Invalid or incomplete elevation data for {area}")
        elevations.extend(data)
        start_count[0] += len(batch)
        print(f"{area}: {len(elevations)}/{len(points)} points", flush=True)
    record = {
        "source_url": "https://open-meteo.com/en/docs/elevation-api",
        "data_source": "Copernicus DEM GLO-90 (2021 release) via Open-Meteo",
        "attribution": "Copernicus DEM / Open-Meteo, CC BY 4.0",
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "source_resolution_m": 90,
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "bounds": [round(w * STEP, 7), round(s * STEP, 7), round(e * STEP, 7), round(n * STEP, 7)],
        "step_degrees": STEP,
        "width": width,
        "height": height,
        "row_order": "north-to-south, west-to-east",
        "elevations_m": elevations,
        "elevations_sha256": hashlib.sha256(json.dumps(elevations, separators=(",", ":")).encode()).hexdigest(),
    }
    path = ROOT / "data" / area / "source" / "elevation-grid.json"
    path.write_text(json.dumps(record, separators=(",", ":")) + "\n")
    print(f"Saved {path.relative_to(ROOT)} ({width}×{height}, {min(elevations)}–{max(elevations)} m)", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("areas", nargs="*", choices=list(BOUNDS))
    args = parser.parse_args()
    count = [0]
    for name in args.areas or BOUNDS:
        fetch(name, count)
