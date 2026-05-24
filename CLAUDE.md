# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build, run, test

```sh
node build-map.js                       # regenerates index.html from gpx/ + routes/ + links.json
node --test test/coverage.test.js       # runs the activity-coverage test suite
```

There is no package.json, bundler, lint config, or dev server. Tests use Node's built-in `node:test` runner (no install). To preview locally, open `index.html` directly or serve the repo root (`python3 -m http.server`) — the page lazy-fetches route GPX from `routes/` at runtime, so `file://` won't show routes (CORS), but segments still render.

Deployment is GitHub Pages from `main` (the `.nojekyll` marker disables Jekyll processing).

## Architecture

This is a one-script static site. `build-map.js` reads GPX + JSON inputs, computes stats, and emits a single self-contained `index.html` with the segment data inlined and the runtime UI as one inline `<script>`.

**`index.html` is generated — never hand-edit it.** All page markup, CSS, and runtime JS lives as template strings inside `build-map.js`. Edits there; rebuild; commit both.

### Inputs and how they bind together

- `gpx/NN-Name.gpx` — one file per cobbled segment. The two-digit `NN` prefix is load-bearing: it sets the segment number (parsed with `parseInt(file, 10)`), the sort order in the sidebar, and the key used to look up the description URL in `links.json`. Renaming or renumbering a file changes the segment's identity.
- `links.json` — `{ "<segment number>": "<cyclinginflanders.cc URL>" }`. Keys are strings of the `NN` number, not the slug.
- `routes/*.gpx` + `ROUTES_META` in `build-map.js` (around line 125) — adding a route means dropping the GPX in `routes/` *and* adding an entry to `ROUTES_META` (id, group, label, file path, color, info URL).

### Two different loading strategies

- **Segments** are inlined into `index.html` as a `SEGMENTS` JS literal (coords + stats), so all 59 polylines render on first paint.
- **Routes** are *not* inlined — only the metadata + precomputed totals are. Route polylines are fetched from `routes/*.gpx` on demand when a checkbox is toggled (`loadRouteData` in the runtime script).

### Shared algorithm: `lib/coverage.js`

The GPX parser (`parseTrkpts`), haversine distance, activity-coverage detection (`computeCoverage`), and activity stats (`activityStats`) live in a single shared module. **`build-map.js` both `require`s it (for build-time stats) and reads its raw text to inline into the runtime `<script>` block.** The test suite imports it directly. One source of truth, three call sites — if you change the algorithm, the page and the tests update together. The module's footer auto-detects Node vs browser and exposes the API as `module.exports` or `globalThis.Coverage` respectively; the inlined functions become top-level declarations in the runtime scope, so the page calls `computeCoverage(...)` directly without going through `Coverage.computeCoverage`.

### Activity-coverage matching

`computeCoverage(activityPts, segments, opts)` returns the set of segment numbers covered by an activity. Algorithm: densify activity to 10 m gaps, build a spatial-hash grid (~330 m cells), sample each segment every 15 m, mark covered if ≥70 % of samples are within 25 m of an activity point. **Densification is load-bearing for sparse inputs** — without it, the curated route GPX files (50 m gaps on straight stretches) fail to match ~5 segments because samples fall between activity points; real Strava activities are dense enough not to care either way. Direction-agnostic (descending counts the same as climbing).

### Stat computations worth knowing before editing

Both live in `build-map.js`:

- **Segment max gradient (`computeStats`)** uses a 25 m sliding window over cumulative distance, not point-to-point, because raw GPS deltas produce nonsense spikes (80%+).
- **Segment elevation** is smoothed with a ±2-point moving average before computing gain and average gradient.
- **Route elevation gain (`computeRouteStats`)** uses a 3 m hysteresis threshold (only counts climbs of >3 m sustained above the running low point) — without it, GPS noise inflates total gain dramatically.

The elevation profile UI (`renderProfile`) only shows when *exactly one* route is checked; toggling a second route hides it. Cursor hover on the profile drops a synced `circleMarker` on the route polyline.

## Conventions

- LF line endings, enforced by `.gitattributes` (`* text=auto eol=lf`). Recent renormalization commit (`ea81410`) — don't reintroduce CRLF.
- The build script prints warnings for segments with no points or missing links; check the console after rebuilding.
- Commit both `build-map.js` changes and the regenerated `index.html` together so GitHub Pages stays in sync.
