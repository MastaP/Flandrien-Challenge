# Flandrien Challenge — Interactive Map

[![Live map](https://img.shields.io/badge/Open%20the%20map-Flandrien%20Challenge-1565c0?style=for-the-badge)](https://mastap.github.io/Flandrien-Challenge/)

Interactive Leaflet map of the [Flandrien Challenge](https://www.cyclinginflanders.cc/flandrien-challenge):
all 59 cobbled bergs and farm-road segments of Flanders, plus the official
1-day, 2-day, and 3-day route variants — with stats, links, and an elevation
profile that follows your cursor.

## Features

- **59 numbered segments** — every climb plotted as a coloured polyline with
  a numbered start marker. Click a segment (line or marker) for length,
  average and max gradient, elevation gain, and a download link.
- **Per-segment sidebar** — each row has `[info]` (the climb's page on
  cyclinginflanders.cc) and `[gpx]` (download the segment GPX). A `show`
  toggle in the header hides all segments from the map without collapsing
  the list.
- **Three route variants** — 1-day, 2-day, 3-day. Tick any combination to
  overlay them simultaneously; each row shows distance and elevation gain,
  and the 2-day / 3-day group headers carry the running totals across stages.
  Routes sit below the segment overlay so the bergs stay visible on top.
- **Elevation profile** — when exactly one route is selected, a profile bar
  appears at the bottom of the map. Hover anywhere on it to see distance +
  elevation at that point and drop a synced marker on the route on the map.

## What's in the repo

| Path | What it is |
|---|---|
| `index.html` | The whole app — a single self-contained page. Generated. |
| `build-map.js` | Build script. Reads the GPX folders, computes stats, writes `index.html`. |
| `gpx/NN-Name.gpx` | One GPX per segment. `NN` is the frozen segment number. |
| `routes/*.gpx` | Route overlays: `1-day.gpx`, `2-day-1.gpx`, `2-day-2.gpx`, `3-day-1.gpx`, `3-day-2.gpx`, `3-day-3.gpx`. |
| `links.json` | Maps each segment number to its description page on cyclinginflanders.cc. |

## Building

No bundler, no framework, no dev server. Just Node:

```sh
node build-map.js
```

The script:

1. Reads each `gpx/NN-Name.gpx`, parses the trackpoints, computes length,
   average and max gradient (over a 25 m sliding window so GPS jitter
   doesn't produce 80 % spikes), and elevation gain.
2. Reads each `routes/*.gpx`, computes total distance and elevation gain
   (with a small hysteresis threshold so the gain doesn't inflate).
3. Pulls per-segment description URLs from `links.json`.
4. Emits `index.html` with everything embedded — segment polylines and
   stats inline; route track data is fetched lazily from `routes/` on
   click so initial page weight stays small.

The page itself depends only on Leaflet (loaded from a CDN) and
OpenStreetMap tiles.

## Updating

- **Change a segment's description link** — edit `links.json` and rebuild.
- **Replace a segment GPX** — drop the new file into `gpx/` using the
  existing `NN-Name.gpx` filename (the `NN` prefix is what fixes the
  segment number).
- **Add or replace a route** — put the GPX in `routes/` and add an entry
  to the `ROUTES_META` array near the top of `build-map.js`.

## Credits

- Route data and per-climb pages — [cyclinginflanders.cc](https://www.cyclinginflanders.cc/flandrien-challenge).
- Map tiles — © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Map library — [Leaflet 1.9](https://leafletjs.com/).

Not affiliated with cyclinginflanders.cc — this is a hobby viewer built
on top of their publicly available route data.
