// Pure algorithm shared between the Node build script, the in-browser
// runtime, and the test suite.
//
// In Node (build script, tests): `require('./lib/coverage')`.
// In the browser: build-map.js reads this file and inlines its contents
// into the page's <script> block. The bottom of this file exposes the
// API on `module.exports` (Node) or `globalThis.Coverage` (browser).

function haversineLL(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Parse every <trkpt> in a GPX string. Tolerates either lat/lon attribute
// order and both self-closing (<trkpt ... />) and full-tag forms.
// Returns [{ lat, lon, ele }] in document order; ele is null if absent.
function parseTrkpts(xml) {
  const pts = [];
  const re = /<trkpt\b([^>]*)(\/>|>([\s\S]*?)<\/trkpt>)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[3] || "";
    const latM = attrs.match(/\blat="([-0-9.eE+]+)"/);
    const lonM = attrs.match(/\blon="([-0-9.eE+]+)"/);
    if (!latM || !lonM) continue;
    const lat = parseFloat(latM[1]);
    const lon = parseFloat(lonM[1]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    let ele = null;
    const eleM = inner.match(/<ele>([-0-9.eE+]+)<\/ele>/);
    if (eleM) {
      const v = parseFloat(eleM[1]);
      if (!Number.isNaN(v)) ele = v;
    }
    pts.push({ lat, lon, ele });
  }
  return pts;
}

// Insert linearly-interpolated points so that no gap between consecutive
// points exceeds `maxStep` metres. The nearest-point matcher in
// computeCoverage is exact only when the activity is dense — some
// route/export GPX leaves 30–50 m gaps on straight stretches, which
// makes the closest *point* further away than the closest *line*. This
// turns sparse polylines into dense ones cheaply.
function densifyActivity(pts, maxStep) {
  if (pts.length < 2) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(pts[i]);
    const a = pts[i], b = pts[i + 1];
    const d = haversineLL(a, b);
    if (d > maxStep) {
      const n = Math.ceil(d / maxStep);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push({
          lat: a.lat + t * (b.lat - a.lat),
          lon: a.lon + t * (b.lon - a.lon),
          ele: null,
        });
      }
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Returns a Set of segment numbers (seg.n) covered by the activity.
// `segments` is an array of objects with `.n` (number) and `.coords`
// (array of [lat, lon] pairs). Direction-agnostic: descending counts.
function computeCoverage(activityPts, segments, options) {
  const opts = options || {};
  const DIST = opts.dist != null ? opts.dist : 25;   // metres — match tolerance per sample
  const STEP = opts.step != null ? opts.step : 15;   // metres — segment sampling interval
  const FRAC = opts.frac != null ? opts.frac : 0.7;  // ≥FRAC of samples must be within DIST
  const CELL = opts.cell != null ? opts.cell : 0.003; // spatial-hash cell (~330 m at Flanders latitude)
  const MAX_STEP = opts.maxStep != null ? opts.maxStep : 10; // densify activity so no gap > MAX_STEP

  const covered = new Set();
  if (!activityPts || activityPts.length < 2) return covered;

  const dense = densifyActivity(activityPts, MAX_STEP);

  const grid = new Map();
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i];
    const key = Math.floor(p.lat / CELL) + "," + Math.floor(p.lon / CELL);
    let cell = grid.get(key);
    if (!cell) { cell = []; grid.set(key, cell); }
    cell.push(p);
  }

  function hasNearby(lat, lon, maxD) {
    const cx = Math.floor(lat / CELL);
    const cy = Math.floor(lon / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get((cx + dx) + "," + (cy + dy));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          if (haversineLL({ lat: lat, lon: lon }, cell[i]) <= maxD) return true;
        }
      }
    }
    return false;
  }

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (!seg.coords || seg.coords.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < seg.coords.length; i++) {
      cum[i] = cum[i - 1] + haversineLL(
        { lat: seg.coords[i - 1][0], lon: seg.coords[i - 1][1] },
        { lat: seg.coords[i][0],     lon: seg.coords[i][1] }
      );
    }
    const total = cum[cum.length - 1];
    if (total <= 0) continue;
    const nSamples = Math.max(5, Math.ceil(total / STEP));
    let near = 0;
    for (let s = 0; s < nSamples; s++) {
      const target = (s / (nSamples - 1)) * total;
      let idx = 0;
      while (idx < cum.length - 1 && cum[idx + 1] < target) idx++;
      let lat, lon;
      if (idx >= cum.length - 1) {
        lat = seg.coords[seg.coords.length - 1][0];
        lon = seg.coords[seg.coords.length - 1][1];
      } else {
        const denom = (cum[idx + 1] - cum[idx]) || 1;
        const t = (target - cum[idx]) / denom;
        lat = seg.coords[idx][0] + (seg.coords[idx + 1][0] - seg.coords[idx][0]) * t;
        lon = seg.coords[idx][1] + (seg.coords[idx + 1][1] - seg.coords[idx][1]) * t;
      }
      if (hasNearby(lat, lon, DIST)) near++;
    }
    if (near / nSamples >= FRAC) covered.add(seg.n);
  }

  return covered;
}

// Distance + hysteresis-based elevation gain for an activity track.
// 3 m hysteresis matches the route-gain heuristic in build-map.js.
function activityStats(pts) {
  let dist = 0;
  for (let i = 1; i < pts.length; i++) dist += haversineLL(pts[i - 1], pts[i]);
  let gain = null;
  const hasEle = pts.length > 1 && pts.every(function (p) { return p.ele != null; });
  if (hasEle) {
    const T = 3;
    let g = 0;
    let ref = pts[0].ele;
    for (let i = 1; i < pts.length; i++) {
      const diff = pts[i].ele - ref;
      if (diff > T) { g += diff; ref = pts[i].ele; }
      else if (pts[i].ele < ref) { ref = pts[i].ele; }
    }
    gain = g;
  }
  return { distanceM: dist, gainM: gain };
}

const API = { haversineLL, parseTrkpts, computeCoverage, activityStats, densifyActivity };
if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
} else if (typeof globalThis !== "undefined") {
  globalThis.Coverage = API;
}
