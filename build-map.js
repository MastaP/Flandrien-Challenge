// Reads every .gpx in ./gpx/, computes per-segment stats, and writes a
// standalone Leaflet map (index.html). GPX files are named NN-Label.gpx;
// the NN prefix fixes the segment number and order. Re-run after editing
// or adding files in ./gpx/.

const fs = require("fs");
const path = require("path");
const { haversineLL, parseTrkpts } = require("./lib/coverage");

const dir = __dirname;
const gpxDir = path.join(dir, "gpx");
const coverageJs = fs.readFileSync(path.join(dir, "lib/coverage.js"), "utf8");
const links = JSON.parse(fs.readFileSync(path.join(dir, "links.json"), "utf8"));

const files = fs
  .readdirSync(gpxDir)
  .filter((f) => f.toLowerCase().endsWith(".gpx"))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

function smooth(vals, radius) {
  return vals.map((_, i) => {
    let sum = 0;
    let cnt = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      if (k >= 0 && k < vals.length && vals[k] != null) {
        sum += vals[k];
        cnt++;
      }
    }
    return cnt ? sum / cnt : vals[i];
  });
}

function computeStats(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + haversineLL(pts[i - 1], pts[i]);
  }
  const total = cum[cum.length - 1] || 0;

  const haveEle = pts.every((p) => p.ele != null);
  let gain = 0;
  let avg = null;
  let max = null;
  if (haveEle && pts.length > 1) {
    const eS = smooth(
      pts.map((p) => p.ele),
      2
    );
    for (let i = 1; i < eS.length; i++) {
      const d = eS[i] - eS[i - 1];
      if (d > 0) gain += d;
    }
    avg = total > 0 ? ((eS[eS.length - 1] - eS[0]) / total) * 100 : 0;

    const WIN = 25; // metres — avoids GPS-jitter gradient spikes
    let best = -Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      let j = i + 1;
      while (j < pts.length - 1 && cum[j] - cum[i] < WIN) j++;
      const dd = cum[j] - cum[i];
      if (dd > 0) {
        const g = ((eS[j] - eS[i]) / dd) * 100;
        if (g > best) best = g;
      }
    }
    max = best === -Infinity ? avg : best;
  }

  const fmtLen =
    total >= 1000 ? (total / 1000).toFixed(2) + " km" : Math.round(total) + " m";
  return {
    length: fmtLen,
    avg: avg == null ? "n/a" : avg.toFixed(1) + "%",
    max: max == null ? "n/a" : max.toFixed(1) + "%",
    gain: haveEle ? Math.round(gain) + " m" : "n/a",
  };
}

function computeRouteStats(pts) {
  if (pts.length < 2) return { distanceM: 0, gainM: null };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += haversineLL(pts[i - 1], pts[i]);
  let gainM = null;
  if (pts.every((p) => p.ele != null)) {
    const eS = smooth(pts.map((p) => p.ele), 2);
    const T = 3; // metres — hysteresis threshold to suppress GPS noise
    let g = 0;
    let ref = eS[0];
    for (let i = 1; i < eS.length; i++) {
      const diff = eS[i] - ref;
      if (diff > T) { g += diff; ref = eS[i]; }
      else if (eS[i] < ref) { ref = eS[i]; }
    }
    gainM = g;
  }
  return { distanceM: total, gainM };
}

const ROUTES_META = [
  { id: "1d",  group: "1-day", label: "Full route", file: "routes/1-day.gpx",   color: "#1565c0", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-1-day" },
  { id: "2d1", group: "2-day", label: "Day 1",      file: "routes/2-day-1.gpx", color: "#2e7d32", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-2-days-day-1" },
  { id: "2d2", group: "2-day", label: "Day 2",      file: "routes/2-day-2.gpx", color: "#7cb342", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-2-days-day-2" },
  { id: "3d1", group: "3-day", label: "Day 1",      file: "routes/3-day-1.gpx", color: "#ef6c00", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-3-days-day-1" },
  { id: "3d2", group: "3-day", label: "Day 2",      file: "routes/3-day-2.gpx", color: "#c62828", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-3-days-day-2" },
  { id: "3d3", group: "3-day", label: "Day 3",      file: "routes/3-day-3.gpx", color: "#6a1b9a", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-3-days-day-3" }
];

const routes = ROUTES_META.map((r) => {
  const xml = fs.readFileSync(path.join(dir, r.file), "utf8");
  const pts = parseTrkpts(xml);
  return Object.assign({}, r, { stats: computeRouteStats(pts) });
});

const segments = files.map((file) => {
  const xml = fs.readFileSync(path.join(gpxDir, file), "utf8");
  const pts = parseTrkpts(xml);
  const n = parseInt(file, 10);
  const name = file
    .replace(/\.gpx$/i, "")
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .trim();
  return {
    n,
    name,
    gpx: "gpx/" + file,
    link: links[String(n)] || null,
    coords: pts.map((p) => [p.lat, p.lon]),
    stats: computeStats(pts),
  };
});

const totalPts = segments.reduce((a, s) => a + s.coords.length, 0);
console.log(`Parsed ${segments.length} segments, ${totalPts} track points.`);
const empty = segments.filter((s) => s.coords.length === 0);
if (empty.length) console.log("WARNING: no points in:", empty.map((s) => s.n).join(", "));
const noLink = segments.filter((s) => !s.link);
if (noLink.length) console.log("WARNING: no link for:", noLink.map((s) => s.n + " " + s.name).join(", "));
else console.log("All " + segments.length + " segments have a description link.");
console.log("Sample:", segments[0].n, segments[0].name, JSON.stringify(segments[0].stats));
console.log("Route stats:");
routes.forEach((r) => console.log("  " + r.id + " " + r.group + " " + r.label + ":", JSON.stringify(r.stats)));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flandrien Challenge — Segments</title>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-EVD72NS7P7"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-EVD72NS7P7');
</script>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  #app { display: flex; height: 100%; }
  #map-area { flex: 1; position: relative; min-width: 0; }
  #map { width: 100%; height: 100%; }
  #profile { position: absolute; left: 0; right: 0; bottom: 0; height: 130px;
    background: rgba(17, 22, 28, 0.92); border-top: 1px solid #2a323c;
    color: #e6e6e6; z-index: 1000; user-select: none; }
  #profile.hidden { display: none; }
  #profile svg { display: block; width: 100%; height: 100%; }
  #map-area.profile-on .leaflet-bottom { bottom: 130px; }
  #side {
    width: 300px; background: #11161c; color: #e6e6e6;
    box-shadow: -2px 0 8px rgba(0,0,0,.3); z-index: 500;
    display: flex; flex-direction: column; overflow: hidden;
  }
  #side h1 { font-size: 15px; margin: 0; padding: 14px 16px; background: #0b0e12;
    border-bottom: 1px solid #2a323c; flex: none;
    display: flex; align-items: center; gap: 10px; }
  #side h1 .title { flex: 1; min-width: 0; }
  #side h1 a { color: inherit; text-decoration: none; }
  #side h1 a:hover { text-decoration: underline; }
  .segs-toggle { display: flex; align-items: center; gap: 4px; font-size: 11px;
    font-weight: 400; text-transform: uppercase; letter-spacing: .06em;
    color: #8aa0b8; cursor: pointer; user-select: none; }
  .segs-toggle input { margin: 0; flex: none; }
  #side ul#list { list-style: none; margin: 0; padding: 6px 0;
    flex: 1 1 0; overflow-y: auto; }
  #side li { display: flex; align-items: center; gap: 10px; padding: 7px 14px;
    cursor: pointer; font-size: 13px; }
  #side li:hover { background: #1d2630; }
  #routes { flex: none; border-top: 1px solid #2a323c; background: #0b0e12;
    padding-bottom: 10px; max-height: 45%; overflow-y: auto; }
  .route-group-h { font-size: 11px; text-transform: uppercase;
    letter-spacing: .06em; color: #8aa0b8; padding: 10px 14px 4px; }
  .route-group-total { text-transform: none; letter-spacing: 0; color: #637589; }
  .route-row { display: flex; align-items: center; gap: 10px;
    padding: 5px 14px; cursor: pointer; font-size: 13px; }
  .route-row:hover { background: #1d2630; }
  .route-row input[type=checkbox] { margin: 0; flex: none; }
  .swatch { width: 22px; height: 5px; border-radius: 3px; flex: none; }
  .route-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
  .route-label { }
  .route-stats { font-size: 11px; color: #8aa0b8; }
  .badge { flex: none; width: 24px; height: 24px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: #fff; }
  .seg-label { flex: 1; }
  .gpx-link, .info-link { flex: none; color: #7fb2ff; text-decoration: none; font-size: 12px; }
  .gpx-link:hover, .info-link:hover { text-decoration: underline; }
  .seg-num { background: #fff; color: #111; border-radius: 50%;
    width: 22px; height: 22px; line-height: 22px; text-align: center;
    font-size: 11px; font-weight: 700; box-shadow: 0 0 0 2px rgba(0,0,0,.4); }
  .pop b { display: block; margin-bottom: 6px; font-size: 13px; }
  .pop table { border-collapse: collapse; font-size: 12px; }
  .pop td { padding: 1px 0; }
  .pop td:first-child { color: #666; padding-right: 14px; }
  .pop a { display: block; margin-top: 7px; color: #1769ff; }
  /* Activity upload */
  .activity-section { background: #0b0e12; border-top: 1px solid #2a323c;
    padding: 10px 14px; flex: none; max-height: 40%; overflow-y: auto; }
  .activity-upload-btn { display: block; width: 100%; padding: 8px 10px;
    background: #1d2630; color: #e6e6e6; border: 1px solid #2a323c;
    border-radius: 4px; cursor: pointer; font-size: 12px; font-family: inherit; }
  .activity-upload-btn:hover { background: #25313d; border-color: #3a4654; }
  .activity-upload-btn:disabled { opacity: .6; cursor: default; }
  .activity-hint { color: #8aa0b8; font-size: 11px; margin-top: 6px; text-align: center; }
  .activity-summary { font-size: 12px; color: #e6e6e6; margin-top: 10px; }
  .activity-summary b { color: #66bb6a; }
  .activity-list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .activity-item { display: flex; align-items: flex-start; gap: 8px;
    padding: 6px 8px; border: 1px solid #2a323c; border-radius: 4px;
    background: #11161c; font-size: 12px; }
  .activity-item.is-hidden { opacity: .55; }
  .activity-check { margin: 3px 0 0 0; flex: none; }
  .activity-swatch { width: 14px; height: 14px; border-radius: 3px; flex: none; margin-top: 2px; }
  .activity-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .activity-info-name { color: #e6e6e6; word-break: break-all; }
  .activity-info-stats { color: #8aa0b8; font-size: 11px; }
  .activity-remove { flex: none; background: transparent; border: none;
    color: #8aa0b8; cursor: pointer; padding: 0 4px; font-size: 16px;
    line-height: 1; font-family: inherit; }
  .activity-remove:hover { color: #ef5350; }
  /* Per-segment coverage marks */
  .seg-cover-dots { display: flex; gap: 2px; flex: none; align-items: center; margin-left: -2px; }
  .seg-cover-dot { width: 7px; height: 7px; border-radius: 50%; flex: none;
    box-shadow: 0 0 0 1px rgba(0,0,0,.4); }
  /* Distance markers along a route */
  .km-marker { width: 32px; height: 14px; display: flex; align-items: center;
    justify-content: center; color: #fff; font-size: 10px; font-weight: 700;
    border-radius: 7px; box-sizing: border-box;
    box-shadow: 0 0 0 1px rgba(255,255,255,.75), 0 0 3px rgba(0,0,0,.5);
    pointer-events: none; }
  /* Start/finish markers at route endpoints */
  .route-endpoint { width: 22px; height: 22px; display: flex; align-items: center;
    justify-content: center; color: #fff; font-size: 12px; font-weight: 800;
    border-radius: 4px;
    box-shadow: 0 0 0 2px #fff, 0 0 5px rgba(0,0,0,.55);
    pointer-events: none; }
</style>
</head>
<body>
<div id="app">
  <div id="map-area">
    <div id="map"></div>
    <div id="profile" class="hidden"></div>
  </div>
  <div id="side">
    <h1>
      <span class="title"><a href="https://www.cyclinginflanders.cc/flandrien-challenge" target="_blank" rel="noopener">Flandrien Challenge — ${segments.length} segments</a></span>
      <label class="segs-toggle"><input type="checkbox" id="segs-toggle" checked> show</label>
    </h1>
    <ul id="list"></ul>
    <div id="routes"></div>
    <div class="activity-section">
      <input type="file" id="activity-file" accept=".gpx,application/gpx+xml" multiple style="display:none">
      <button class="activity-upload-btn" id="activity-upload">Upload activity GPX</button>
      <div class="activity-hint">Upload your GPX file(s) to see which segments are covered. Not stored — refresh to clear.</div>
      <div class="activity-summary" id="activity-summary" style="display:none">
        <b id="activity-unique-count">0</b> / ${segments.length} unique segments covered
      </div>
      <div class="activity-list" id="activity-list"></div>
    </div>
  </div>
</div>
<script>
// --- inlined from lib/coverage.js (single source of truth, also imported by tests) ---
// Brings haversineLL, parseTrkpts, computeCoverage, activityStats into this scope
// as top-level function declarations.
${coverageJs}
// ----------------------------------------------------------------------------

const SEGMENTS = ${JSON.stringify(segments)};

const map = L.map("map");
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function colorFor(i, total) {
  return "hsl(" + Math.round((i * 360) / total) + ",75%,48%)";
}

function popupHtml(seg) {
  return '<div class="pop"><b>' + seg.n + ". " + seg.name + "</b>" +
    "<table>" +
    "<tr><td>Length</td><td>" + seg.stats.length + "</td></tr>" +
    "<tr><td>Avg gradient</td><td>" + seg.stats.avg + "</td></tr>" +
    "<tr><td>Max gradient</td><td>" + seg.stats.max + "</td></tr>" +
    "<tr><td>Elevation gain</td><td>" + seg.stats.gain + "</td></tr>" +
    "</table>" +
    '<a href="' + seg.gpx + '" download>Download GPX</a>' +
    (seg.link
      ? '<a href="' + seg.link + '" target="_blank" rel="noopener">Segment description ↗</a>'
      : "") +
    "</div>";
}

const allBounds = [];
const layers = {};
let segmentsVisible = true;

SEGMENTS.forEach(function (seg, idx) {
  if (!seg.coords.length) return;
  const color = colorFor(idx, SEGMENTS.length);
  const html = popupHtml(seg);

  const line = L.polyline(seg.coords, { color: color, weight: 4, opacity: 0.85 })
    .addTo(map)
    .bindTooltip(seg.n + ". " + seg.name, { sticky: true })
    .bindPopup(html);

  const start = seg.coords[0];
  const marker = L.marker(start, {
    icon: L.divIcon({
      className: "",
      html: '<div class="seg-num">' + seg.n + "</div>",
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  })
    .addTo(map)
    .bindPopup(html);

  layers[seg.n] = { line: line, marker: marker, bounds: line.getBounds() };
  allBounds.push(start);
  seg.coords.forEach(function (c) { allBounds.push(c); });
});

map.fitBounds(L.latLngBounds(allBounds), { padding: [30, 30] });

const list = document.getElementById("list");
SEGMENTS.forEach(function (seg, idx) {
  const li = document.createElement("li");
  li.dataset.segN = String(seg.n);
  const color = colorFor(idx, SEGMENTS.length);

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.background = color;
  badge.textContent = seg.n;

  const label = document.createElement("span");
  label.className = "seg-label";
  label.textContent = seg.name + (seg.coords.length ? "" : " (no data)");

  const dots = document.createElement("span");
  dots.className = "seg-cover-dots";

  li.appendChild(badge);
  li.appendChild(label);
  li.appendChild(dots);

  if (seg.link) {
    const info = document.createElement("a");
    info.className = "info-link";
    info.href = seg.link;
    info.target = "_blank";
    info.rel = "noopener";
    info.textContent = "[info]";
    info.addEventListener("click", function (e) { e.stopPropagation(); });
    li.appendChild(info);
  }

  const link = document.createElement("a");
  link.className = "gpx-link";
  link.href = seg.gpx;
  link.setAttribute("download", "");
  link.textContent = "[gpx]";
  link.addEventListener("click", function (e) { e.stopPropagation(); });
  li.appendChild(link);
  li.addEventListener("click", function () {
    const L0 = layers[seg.n];
    if (!L0) return;
    map.fitBounds(L0.bounds, { padding: [60, 60], maxZoom: 17 });
    if (segmentsVisible) L0.marker.openPopup();
  });
  list.appendChild(li);
});

document.getElementById("segs-toggle").addEventListener("change", function (e) {
  segmentsVisible = e.target.checked;
  Object.keys(layers).forEach(function (k) {
    const L0 = layers[k];
    if (segmentsVisible) { L0.line.addTo(map); L0.marker.addTo(map); }
    else { map.removeLayer(L0.line); map.removeLayer(L0.marker); }
  });
  if (segmentsVisible) updateSegmentMarks();
});

const ROUTES = ${JSON.stringify(routes)};

function fmtKm(m) {
  if (m == null) return "n/a";
  const km = m / 1000;
  return km >= 100 ? Math.round(km) + " km" : km.toFixed(1) + " km";
}
function fmtGain(m) {
  if (m == null) return "n/a";
  return Math.round(m) + " m";
}

map.createPane("routesPane");
map.getPane("routesPane").style.zIndex = 350;
map.createPane("routeMarkersPane");
map.getPane("routeMarkersPane").style.zIndex = 590; // above route polylines, below default markers (segment badges)

const routeLayers = {};
const routeData = {}; // id -> { pts:[{lat,lon,ele}], cum:[m...], totalM }
const routeMarkers = {}; // id -> [L.marker, ...] — 5-km labels + S/F endpoints

async function loadRouteData(file) {
  const res = await fetch(file);
  const xml = await res.text();
  const pts = parseTrkpts(xml);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversineLL(pts[i - 1], pts[i]);
  return { pts, cum, totalM: cum[cum.length - 1] || 0 };
}

// 5-km distance labels (showing direction by increasing number) plus S/F
// endpoints. Skips km labels within 1 km of the finish so they don't sit
// on top of the F marker. Used by both official routes and uploaded
// activities; pts is an array of {lat, lon} objects.
function buildDistanceMarkers(pts, color) {
  const out = [];
  if (!pts || pts.length < 2) return out;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversineLL(pts[i - 1], pts[i]);
  const totalM = cum[cum.length - 1] || 0;

  for (let km = 5; km * 1000 < totalM - 1000; km += 5) {
    const target = km * 1000;
    let idx = 0;
    while (idx < cum.length - 1 && cum[idx + 1] < target) idx++;
    let lat, lon;
    if (idx >= pts.length - 1) {
      lat = pts[pts.length - 1].lat;
      lon = pts[pts.length - 1].lon;
    } else {
      const denom = (cum[idx + 1] - cum[idx]) || 1;
      const t = (target - cum[idx]) / denom;
      lat = pts[idx].lat + t * (pts[idx + 1].lat - pts[idx].lat);
      lon = pts[idx].lon + t * (pts[idx + 1].lon - pts[idx].lon);
    }
    out.push(L.marker([lat, lon], {
      pane: "routeMarkersPane",
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "",
        html: '<div class="km-marker" style="background:' + color + ';">' + km + '</div>',
        iconSize: [32, 14],
        iconAnchor: [16, 7],
      }),
    }));
  }

  function endpoint(p, letter) {
    return L.marker([p.lat, p.lon], {
      pane: "routeMarkersPane",
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "",
        html: '<div class="route-endpoint" style="background:' + color + ';">' + letter + '</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    });
  }
  // Add S/F last so they render above any nearby km labels.
  out.push(endpoint(pts[0], "S"));
  out.push(endpoint(pts[pts.length - 1], "F"));
  return out;
}

async function setRouteVisible(route, on, checkbox) {
  if (on) {
    if (!routeLayers[route.id]) {
      checkbox.disabled = true;
      try {
        const data = await loadRouteData(route.file);
        routeData[route.id] = data;
        const coords = data.pts.map((p) => [p.lat, p.lon]);
        routeLayers[route.id] = L.polyline(coords, {
          color: track.color, weight: 5, opacity: 0.75,
          pane: "routesPane"
        }).bindTooltip(route.group + " — " + route.label + " · " + fmtKm(route.stats.distanceM) + " · " + fmtGain(route.stats.gainM) + " ↑", { sticky: true });
        routeMarkers[route.id] = buildDistanceMarkers(data.pts, track.color);
      } catch (e) {
        console.error("route load failed", route.file, e);
        checkbox.checked = false;
        return;
      } finally { checkbox.disabled = false; }
    }
    routeLayers[route.id].addTo(map);
    routeMarkers[route.id].forEach((m) => m.addTo(map));
  } else if (routeLayers[route.id]) {
    map.removeLayer(routeLayers[route.id]);
    if (routeMarkers[route.id]) routeMarkers[route.id].forEach((m) => map.removeLayer(m));
  }
  updateProfile();
}

const profileEl = document.getElementById("profile");
const mapAreaEl = document.getElementById("map-area");
let profileMarker = null;
let currentProfileTrackId = null;

function findIndexForDistance(cum, d) {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < d) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function renderProfile(track) {
  const pts = track.pts, cum = track.cum, totalM = track.totalM;
  if (!pts || pts.length < 2) { hideProfile(); return; }
  let eMin = Infinity, eMax = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const e = pts[i].ele;
    if (e == null) continue;
    if (e < eMin) eMin = e;
    if (e > eMax) eMax = e;
  }
  if (eMin === Infinity) { hideProfile(); return; }
  const W = profileEl.clientWidth || 800;
  const H = 130;
  const PAD_L = 38, PAD_R = 10, PAD_T = 18, PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const range = (eMax - eMin) || 1;
  const xOf = function (d) { return PAD_L + (d / totalM) * innerW; };
  const yOf = function (e) { return PAD_T + (1 - (e - eMin) / range) * innerH; };

  const N = Math.min(pts.length, 800);
  const step = Math.max(1, Math.floor(pts.length / N));
  let pathD = "", started = false;
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (p.ele == null) continue;
    const px = xOf(cum[i]).toFixed(1);
    const py = yOf(p.ele).toFixed(1);
    pathD += (started ? "L" : "M") + px + " " + py + " ";
    started = true;
  }
  const lastI = pts.length - 1;
  if (pts[lastI].ele != null) {
    pathD += "L" + xOf(cum[lastI]).toFixed(1) + " " + yOf(pts[lastI].ele).toFixed(1);
  }
  const baseY = (PAD_T + innerH).toFixed(1);
  const fillD = pathD + " L" + xOf(cum[lastI]).toFixed(1) + " " + baseY + " L" + xOf(0).toFixed(1) + " " + baseY + " Z";

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return f * totalM; });
  let xLabels = "";
  ticks.forEach(function (t, i) {
    const anchor = i === 0 ? "start" : i === 4 ? "end" : "middle";
    xLabels += '<text x="' + xOf(t).toFixed(1) + '" y="' + (PAD_T + innerH + 14).toFixed(1) + '" text-anchor="' + anchor + '" fill="#8aa0b8" font-size="10">' + (t / 1000).toFixed(1) + ' km</text>';
  });

  const html =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<path d="' + fillD + '" fill="' + track.color + '" fill-opacity="0.22" />' +
    '<path d="' + pathD + '" fill="none" stroke="' + track.color + '" stroke-width="1.5" />' +
    '<line x1="' + PAD_L + '" y1="' + baseY + '" x2="' + (W - PAD_R) + '" y2="' + baseY + '" stroke="#3a4654" />' +
    '<text x="' + (PAD_L - 6) + '" y="' + (PAD_T + 4) + '" text-anchor="end" fill="#8aa0b8" font-size="10">' + Math.round(eMax) + ' m</text>' +
    '<text x="' + (PAD_L - 6) + '" y="' + (PAD_T + innerH) + '" text-anchor="end" fill="#8aa0b8" font-size="10">' + Math.round(eMin) + ' m</text>' +
    xLabels +
    '<text x="' + PAD_L + '" y="13" fill="#e6e6e6" font-size="11">' + track.title + ' · ' + fmtKm(totalM) + ' · ' + fmtGain(track.gainM) + ' ↑</text>' +
    '<g id="profile-cursor" style="display:none;">' +
    '<line id="profile-cursor-line" x1="0" y1="' + PAD_T + '" x2="0" y2="' + (PAD_T + innerH) + '" stroke="#fff" stroke-width="1" stroke-dasharray="2 2" opacity="0.6" />' +
    '<circle id="profile-cursor-dot" cx="0" cy="0" r="3.5" fill="' + track.color + '" stroke="#fff" stroke-width="1" />' +
    '<text id="profile-cursor-label" x="0" y="' + (PAD_T + innerH - 4) + '" text-anchor="middle" fill="#fff" font-size="10" font-weight="600"></text>' +
    '</g>' +
    '</svg>';

  profileEl.innerHTML = html;
  profileEl.classList.remove("hidden");
  mapAreaEl.classList.add("profile-on");
  currentProfileTrackId = track.id;

  const svgEl = profileEl.querySelector("svg");
  const cursorG = profileEl.querySelector("#profile-cursor");
  const cursorLine = profileEl.querySelector("#profile-cursor-line");
  const cursorDot = profileEl.querySelector("#profile-cursor-dot");
  const cursorLabel = profileEl.querySelector("#profile-cursor-label");

  function onMove(e) {
    const rect = svgEl.getBoundingClientRect();
    const xCss = e.clientX - rect.left;
    const xSvg = (xCss / rect.width) * W;
    if (xSvg < PAD_L || xSvg > W - PAD_R) { onLeave(); return; }
    const dist = ((xSvg - PAD_L) / innerW) * totalM;
    const idx = findIndexForDistance(cum, dist);
    const p = pts[idx];
    if (p.ele == null) return;
    const px = xOf(cum[idx]);
    const py = yOf(p.ele);
    cursorG.style.display = "";
    cursorLine.setAttribute("x1", px);
    cursorLine.setAttribute("x2", px);
    cursorDot.setAttribute("cx", px);
    cursorDot.setAttribute("cy", py);
    let lx = px;
    if (lx < PAD_L + 30) lx = PAD_L + 30;
    if (lx > W - PAD_R - 30) lx = W - PAD_R - 30;
    cursorLabel.setAttribute("x", lx);
    cursorLabel.textContent = (cum[idx] / 1000).toFixed(1) + " km · " + Math.round(p.ele) + " m";
    if (!profileMarker) {
      profileMarker = L.circleMarker([p.lat, p.lon], {
        radius: 7, color: "#fff", weight: 2, fillColor: track.color, fillOpacity: 1, interactive: false
      }).addTo(map);
    } else {
      profileMarker.setLatLng([p.lat, p.lon]);
      profileMarker.setStyle({ opacity: 1, fillOpacity: 1, color: "#fff", fillColor: track.color });
    }
  }
  function onLeave() {
    cursorG.style.display = "none";
    if (profileMarker) profileMarker.setStyle({ opacity: 0, fillOpacity: 0 });
  }
  svgEl.addEventListener("mousemove", onMove);
  svgEl.addEventListener("mouseleave", onLeave);
}

function hideProfile() {
  profileEl.classList.add("hidden");
  mapAreaEl.classList.remove("profile-on");
  currentProfileTrackId = null;
  if (profileMarker) { map.removeLayer(profileMarker); profileMarker = null; }
}

// Tracks eligible for the elevation profile: visible official routes plus
// visible uploaded activities, normalised to a common shape. The profile
// renders only when exactly one of these is visible.
function visibleTracks() {
  const out = [];
  ROUTES.forEach(function (r) {
    if (routeLayers[r.id] && map.hasLayer(routeLayers[r.id])) {
      const data = routeData[r.id];
      out.push({
        id: "route-" + r.id,
        color: r.color,
        title: r.group + " — " + r.label,
        pts: data.pts,
        cum: data.cum,
        totalM: data.totalM,
        gainM: r.stats.gainM,
      });
    }
  });
  activities.forEach(function (a) {
    if (a.visible === false) return;
    if (!a.cum) {
      // Lazy cumulative-distance build for the activity track.
      a.cum = [0];
      for (let i = 1; i < a.pts.length; i++) {
        a.cum[i] = a.cum[i - 1] + haversineLL(a.pts[i - 1], a.pts[i]);
      }
      a.totalM = a.cum[a.cum.length - 1] || 0;
    }
    out.push({
      id: "activity-" + a.id,
      color: a.color,
      title: a.name,
      pts: a.pts,
      cum: a.cum,
      totalM: a.totalM,
      gainM: a.stats.gainM,
    });
  });
  return out;
}

function updateProfile() {
  const tracks = visibleTracks();
  if (tracks.length === 1) renderProfile(tracks[0]);
  else hideProfile();
}

let resizeT;
window.addEventListener("resize", function () {
  clearTimeout(resizeT);
  resizeT = setTimeout(function () {
    if (!currentProfileTrackId) return;
    const track = visibleTracks().find(function (t) { return t.id === currentProfileTrackId; });
    if (track) renderProfile(track);
    else hideProfile();
  }, 100);
});

const routesEl = document.getElementById("routes");
const byGroup = {};
ROUTES.forEach(function (r) { (byGroup[r.group] = byGroup[r.group] || []).push(r); });
Object.keys(byGroup).forEach(function (g) {
  const group = byGroup[g];
  const h = document.createElement("div");
  h.className = "route-group-h";
  const nameSpan = document.createElement("span");
  nameSpan.textContent = g + " route";
  h.appendChild(nameSpan);
  if (group.length > 1) {
    const totDist = group.reduce(function (a, r) { return a + (r.stats.distanceM || 0); }, 0);
    const someNullGain = group.some(function (r) { return r.stats.gainM == null; });
    const totGain = someNullGain ? null : group.reduce(function (a, r) { return a + r.stats.gainM; }, 0);
    const tot = document.createElement("span");
    tot.className = "route-group-total";
    tot.textContent = " · " + fmtKm(totDist) + " · " + fmtGain(totGain) + " ↑";
    h.appendChild(tot);
  }
  routesEl.appendChild(h);
  group.forEach(function (r) {
    const row = document.createElement("div");
    row.className = "route-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = r.color;
    const text = document.createElement("span");
    text.className = "route-text";
    const lab = document.createElement("span");
    lab.className = "route-label";
    lab.textContent = r.label;
    const stats = document.createElement("span");
    stats.className = "route-stats";
    stats.textContent = fmtKm(r.stats.distanceM) + " · " + fmtGain(r.stats.gainM) + " ↑";
    text.appendChild(lab);
    text.appendChild(stats);
    cb.addEventListener("change", function (e) { setRouteVisible(r, e.target.checked, e.target); });

    const info = document.createElement("a");
    info.className = "info-link";
    info.href = r.info;
    info.target = "_blank";
    info.rel = "noopener";
    info.textContent = "[info]";
    info.addEventListener("click", function (e) { e.stopPropagation(); });

    const gpx = document.createElement("a");
    gpx.className = "gpx-link";
    gpx.href = r.file;
    gpx.setAttribute("download", "");
    gpx.textContent = "[gpx]";
    gpx.addEventListener("click", function (e) { e.stopPropagation(); });

    row.appendChild(cb);
    row.appendChild(sw);
    row.appendChild(text);
    row.appendChild(info);
    row.appendChild(gpx);

    row.addEventListener("click", function (e) {
      if (e.target.closest("a") || e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });
    routesEl.appendChild(row);
  });
});

// ===== Activity upload (in-browser, non-persistent, multi-activity) =====
const activityFileEl = document.getElementById("activity-file");
const activityUploadBtn = document.getElementById("activity-upload");
const activitySummaryEl = document.getElementById("activity-summary");
const activityUniqueCountEl = document.getElementById("activity-unique-count");
const activityListEl = document.getElementById("activity-list");

map.createPane("activityPane");
map.getPane("activityPane").style.zIndex = 380; // above routes (350), below default overlays (400)

// Bright, visually distinct colours. Stable per activity: each upload gets
// the next colour by monotonically incrementing index, so removing an
// activity never reshuffles the others.
const ACTIVITY_PALETTE = [
  "#ef5350", "#42a5f5", "#66bb6a", "#ffa726", "#ab47bc",
  "#26c6da", "#ec407a", "#d4e157", "#5c6bc0", "#26a69a",
];

const activities = []; // [{ id, name, color, layer, covered:Set<n>, stats }]
let nextActivityId = 1;
let nextColorIndex = 0;

activityUploadBtn.addEventListener("click", function () { activityFileEl.click(); });
activityFileEl.addEventListener("change", onActivityFiles);

async function onActivityFiles(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = ""; // allow re-upload of the same file
  if (!files.length) return;
  activityUploadBtn.disabled = true;
  const originalLabel = activityUploadBtn.textContent;
  activityUploadBtn.textContent = files.length > 1
    ? "Reading " + files.length + " files…"
    : "Reading…";
  try {
    for (const file of files) {
      try {
        const text = await file.text();
        const pts = parseTrkpts(text);
        if (pts.length < 2) {
          alert("No usable trackpoints found in " + file.name + ".");
          continue;
        }
        addActivity(file.name, pts);
      } catch (err) {
        console.error(err);
        alert("Failed to read " + file.name + ": " + err.message);
      }
    }
  } finally {
    activityUploadBtn.disabled = false;
    activityUploadBtn.textContent = originalLabel;
  }
}

function decimateForDisplay(pts, maxPoints) {
  if (pts.length <= maxPoints) return pts;
  const step = Math.ceil(pts.length / maxPoints);
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

function addActivity(name, pts) {
  const id = nextActivityId++;
  const color = ACTIVITY_PALETTE[nextColorIndex++ % ACTIVITY_PALETTE.length];
  const display = decimateForDisplay(pts, 6000);
  const coords = display.map(function (p) { return [p.lat, p.lon]; });
  const layer = L.polyline(coords, {
    color: color, weight: 4, opacity: 0.85,
    dashArray: "6 4", pane: "activityPane"
  }).bindTooltip(name, { sticky: true }).addTo(map);

  // S/F + 5-km labels along the activity. Use the original (non-decimated)
  // points so distances are accurate.
  const markers = buildDistanceMarkers(pts, color);
  markers.forEach((m) => m.addTo(map));

  const stats = activityStats(pts);
  const covered = computeCoverage(pts, SEGMENTS);

  // Retain pts so the elevation profile can render this activity later.
  activities.push({ id, name, color, layer, markers, covered, stats, visible: true, pts });
  renderActivities();
  fitMapToActivities();
  updateProfile();
}

function removeActivity(id) {
  const idx = activities.findIndex((a) => a.id === id);
  if (idx < 0) return;
  map.removeLayer(activities[idx].layer);
  activities[idx].markers.forEach((m) => map.removeLayer(m));
  activities.splice(idx, 1);
  renderActivities();
  updateProfile();
}

function setActivityVisible(a, visible) {
  if (a.visible === visible) return;
  a.visible = visible;
  if (visible) {
    a.layer.addTo(map);
    a.markers.forEach((m) => m.addTo(map));
  } else {
    map.removeLayer(a.layer);
    a.markers.forEach((m) => map.removeLayer(m));
  }
  renderActivities();
  updateProfile();
}

function fitMapToActivities() {
  const visible = activities.filter((a) => a.visible !== false);
  if (!visible.length) return;
  const all = L.featureGroup(visible.map((a) => a.layer));
  const b = all.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [30, 30] });
}

function renderActivities() {
  activityListEl.innerHTML = "";
  activities.forEach(function (a) {
    const item = document.createElement("div");
    item.className = "activity-item" + (a.visible === false ? " is-hidden" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "activity-check";
    cb.checked = a.visible !== false;
    cb.title = "Show/hide on map";
    cb.addEventListener("change", function (e) { setActivityVisible(a, e.target.checked); });

    const sw = document.createElement("span");
    sw.className = "activity-swatch";
    sw.style.background = a.color;

    const info = document.createElement("div");
    info.className = "activity-info";
    const nameEl = document.createElement("div");
    nameEl.className = "activity-info-name";
    nameEl.textContent = a.name;
    const statsEl = document.createElement("div");
    statsEl.className = "activity-info-stats";
    statsEl.textContent =
      fmtKm(a.stats.distanceM) + " · " + fmtGain(a.stats.gainM) + " ↑ · " +
      a.covered.size + " segments";
    info.appendChild(nameEl);
    info.appendChild(statsEl);

    const rm = document.createElement("button");
    rm.className = "activity-remove";
    rm.title = "Remove activity";
    rm.textContent = "×";
    rm.addEventListener("click", function () { removeActivity(a.id); });

    item.appendChild(cb);
    item.appendChild(sw);
    item.appendChild(info);
    item.appendChild(rm);
    activityListEl.appendChild(item);
  });

  // Unique-segment count — only visible activities contribute.
  const uniq = new Set();
  activities.forEach(function (a) {
    if (a.visible === false) return;
    a.covered.forEach(function (n) { uniq.add(n); });
  });
  activityUniqueCountEl.textContent = String(uniq.size);
  activitySummaryEl.style.display = activities.length ? "" : "none";

  updateSegmentMarks();
}

// For each segment, accumulate the colours of activities that cover it
// and paint matching dots in the sidebar row + concentric rings on the
// map marker (one ring per covering activity).
function updateSegmentMarks() {
  const coverColors = new Map(); // segN -> [color, color, ...]
  activities.forEach(function (a) {
    if (a.visible === false) return;
    a.covered.forEach(function (n) {
      let arr = coverColors.get(n);
      if (!arr) { arr = []; coverColors.set(n, arr); }
      arr.push(a.color);
    });
  });

  document.querySelectorAll("#list li").forEach(function (li) {
    const n = parseInt(li.dataset.segN, 10);
    const dotsEl = li.querySelector(".seg-cover-dots");
    if (!dotsEl) return;
    dotsEl.innerHTML = "";
    const colors = coverColors.get(n);
    if (!colors) return;
    colors.forEach(function (c) {
      const d = document.createElement("span");
      d.className = "seg-cover-dot";
      d.style.background = c;
      dotsEl.appendChild(d);
    });
  });

  Object.keys(layers).forEach(function (k) {
    const L0 = layers[k];
    const el = L0.marker.getElement();
    if (!el) return;
    const numEl = el.querySelector(".seg-num");
    if (!numEl) return;
    const colors = coverColors.get(Number(k));
    if (!colors || !colors.length) {
      numEl.style.boxShadow = "";
      return;
    }
    // Stack concentric rings: each activity gets its own 2px outset.
    const shadows = colors.map(function (c, i) {
      return "0 0 0 " + ((i + 1) * 2) + "px " + c;
    });
    numEl.style.boxShadow = shadows.join(", ");
  });
}

</script>
</body>
</html>
`;

const out = path.join(dir, "index.html");
fs.writeFileSync(out, html, "utf8");
console.log("Wrote " + out);
