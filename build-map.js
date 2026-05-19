// Reads every .gpx in ./gpx/, computes per-segment stats, and writes a
// standalone Leaflet map (index.html). GPX files are named NN-Label.gpx;
// the NN prefix fixes the segment number and order. Re-run after editing
// or adding files in ./gpx/.

const fs = require("fs");
const path = require("path");

const dir = __dirname;
const gpxDir = path.join(dir, "gpx");
const links = JSON.parse(fs.readFileSync(path.join(dir, "links.json"), "utf8"));

const files = fs
  .readdirSync(gpxDir)
  .filter((f) => f.toLowerCase().endsWith(".gpx"))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

function parsePoints(xml) {
  const pts = [];
  const re = /<trkpt\b([^>]*?)\/?>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] !== undefined ? m[1] : m[3];
    const inner = m[2] || "";
    const lat = parseFloat((attrs.match(/\blat="([-\d.]+)"/) || [])[1]);
    const lon = parseFloat((attrs.match(/\blon="([-\d.]+)"/) || [])[1]);
    const eleM = inner.match(/<ele>([-\d.]+)<\/ele>/);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    pts.push({ lat, lon, ele: eleM ? parseFloat(eleM[1]) : null });
  }
  return pts;
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

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
    cum[i] = cum[i - 1] + haversine(pts[i - 1], pts[i]);
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

const segments = files.map((file) => {
  const xml = fs.readFileSync(path.join(gpxDir, file), "utf8");
  const pts = parsePoints(xml);
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

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flandrien Challenge — Segments</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  #app { display: flex; height: 100%; }
  #map { flex: 1; }
  #side {
    width: 300px; background: #11161c; color: #e6e6e6;
    box-shadow: -2px 0 8px rgba(0,0,0,.3); z-index: 500;
    display: flex; flex-direction: column; overflow: hidden;
  }
  #side h1 { font-size: 15px; margin: 0; padding: 14px 16px; background: #0b0e12;
    border-bottom: 1px solid #2a323c; flex: none; }
  #side h1 a { color: inherit; text-decoration: none; }
  #side h1 a:hover { text-decoration: underline; }
  #side ul#list { list-style: none; margin: 0; padding: 6px 0;
    flex: 1 1 0; overflow-y: auto; }
  #side li { display: flex; align-items: center; gap: 10px; padding: 7px 14px;
    cursor: pointer; font-size: 13px; }
  #side li:hover { background: #1d2630; }
  #routes { flex: none; border-top: 1px solid #2a323c; background: #0b0e12;
    padding-bottom: 10px; max-height: 45%; overflow-y: auto; }
  .route-group-h { font-size: 11px; text-transform: uppercase;
    letter-spacing: .06em; color: #8aa0b8; padding: 10px 14px 4px; }
  .route-row { display: flex; align-items: center; gap: 10px;
    padding: 5px 14px; cursor: pointer; font-size: 13px; }
  .route-row:hover { background: #1d2630; }
  .route-row input[type=checkbox] { margin: 0; flex: none; }
  .swatch { width: 22px; height: 5px; border-radius: 3px; flex: none; }
  .route-label { flex: 1; }
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
</style>
</head>
<body>
<div id="app">
  <div id="map"></div>
  <div id="side">
    <h1><a href="https://www.cyclinginflanders.cc/flandrien-challenge" target="_blank" rel="noopener">Flandrien Challenge — ${segments.length} segments</a></h1>
    <ul id="list"></ul>
    <div id="routes"></div>
  </div>
</div>
<script>
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
  const color = colorFor(idx, SEGMENTS.length);

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.background = color;
  badge.textContent = seg.n;

  const label = document.createElement("span");
  label.className = "seg-label";
  label.textContent = seg.name + (seg.coords.length ? "" : " (no data)");

  li.appendChild(badge);
  li.appendChild(label);

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
    L0.marker.openPopup();
  });
  list.appendChild(li);
});

const ROUTES = [
  { id: "1d",  group: "1-day", label: "Full route", file: "routes/1-day.gpx",   color: "#1565c0", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-1-day" },
  { id: "2d1", group: "2-day", label: "Day 1",      file: "routes/2-day-1.gpx", color: "#2e7d32", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-2-days-day-1" },
  { id: "2d2", group: "2-day", label: "Day 2",      file: "routes/2-day-2.gpx", color: "#7cb342", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-2-days-day-2" },
  { id: "3d1", group: "3-day", label: "Day 1",      file: "routes/3-day-1.gpx", color: "#ef6c00", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-3-days-day-1" },
  { id: "3d2", group: "3-day", label: "Day 2",      file: "routes/3-day-2.gpx", color: "#c62828", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-3-days-day-2" },
  { id: "3d3", group: "3-day", label: "Day 3",      file: "routes/3-day-3.gpx", color: "#6a1b9a", info: "https://www.cyclinginflanders.cc/routes/flandrien-challenge-3-days-day-3" }
];

map.createPane("routesPane");
map.getPane("routesPane").style.zIndex = 350;

const routeLayers = {};
async function loadRouteCoords(file) {
  const res = await fetch(file);
  const xml = await res.text();
  const coords = [];
  const re = /<trkpt[^>]*lat="([-0-9.eE+]+)"[^>]*lon="([-0-9.eE+]+)"|<trkpt[^>]*lon="([-0-9.eE+]+)"[^>]*lat="([-0-9.eE+]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const lat = parseFloat(m[1] !== undefined ? m[1] : m[4]);
    const lon = parseFloat(m[2] !== undefined ? m[2] : m[3]);
    if (!isNaN(lat) && !isNaN(lon)) coords.push([lat, lon]);
  }
  return coords;
}
async function setRouteVisible(route, on, checkbox) {
  if (on) {
    if (!routeLayers[route.id]) {
      checkbox.disabled = true;
      try {
        const coords = await loadRouteCoords(route.file);
        routeLayers[route.id] = L.polyline(coords, {
          color: route.color, weight: 5, opacity: 0.75,
          pane: "routesPane"
        }).bindTooltip(route.group + " — " + route.label, { sticky: true });
      } catch (e) {
        console.error("route load failed", route.file, e);
        checkbox.checked = false;
        return;
      } finally { checkbox.disabled = false; }
    }
    routeLayers[route.id].addTo(map);
  } else if (routeLayers[route.id]) {
    map.removeLayer(routeLayers[route.id]);
  }
}

const routesEl = document.getElementById("routes");
const byGroup = {};
ROUTES.forEach(function (r) { (byGroup[r.group] = byGroup[r.group] || []).push(r); });
Object.keys(byGroup).forEach(function (g) {
  const h = document.createElement("div");
  h.className = "route-group-h";
  h.textContent = g + " route";
  routesEl.appendChild(h);
  byGroup[g].forEach(function (r) {
    const row = document.createElement("div");
    row.className = "route-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = r.color;
    const lab = document.createElement("span");
    lab.className = "route-label";
    lab.textContent = r.label;
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
    row.appendChild(lab);
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
</script>
</body>
</html>
`;

const out = path.join(dir, "index.html");
fs.writeFileSync(out, html, "utf8");
console.log("Wrote " + out);
