// Reads every .gpx in this folder, extracts track points, and writes a
// standalone Leaflet map (flandrien-map.html) with one numbered, named
// segment per file. Re-run after adding/removing GPX files.

const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith(".gpx"))
  .sort((a, b) => a.localeCompare(b, "en"));

function labelFromFilename(file) {
  let s = file.replace(/\.gpx$/i, "");
  s = s.replace(/^Flandrien.Challenge/i, ""); // drops "Flandrien-Challenge" + the separator char (incl. soft hyphen)
  s = s.replace(/^[^A-Za-z0-9]+/, ""); // strip any leftover leading separators
  s = s.replace(/[-_]+/g, " ").trim(); // hyphens/underscores -> spaces for readability
  return s;
}

const segments = files.map((file, i) => {
  const xml = fs.readFileSync(path.join(dir, file), "utf8");
  const pts = [];
  const re = /<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"|<trkpt[^>]*\blon="([-\d.]+)"[^>]*\blat="([-\d.]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const lat = m[1] !== undefined ? parseFloat(m[1]) : parseFloat(m[4]);
    const lon = m[2] !== undefined ? parseFloat(m[2]) : parseFloat(m[3]);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) pts.push([lat, lon]);
  }
  return { n: i + 1, name: labelFromFilename(file), file, coords: pts };
});

const totalPts = segments.reduce((a, s) => a + s.coords.length, 0);
console.log(`Parsed ${segments.length} segments, ${totalPts} track points.`);
const empty = segments.filter((s) => s.coords.length === 0);
if (empty.length) console.log("WARNING: no points in:", empty.map((s) => s.file).join(", "));

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
    width: 280px; overflow-y: auto; background: #11161c; color: #e6e6e6;
    box-shadow: -2px 0 8px rgba(0,0,0,.3); z-index: 500;
  }
  #side h1 { font-size: 15px; margin: 0; padding: 14px 16px; background: #0b0e12;
    position: sticky; top: 0; border-bottom: 1px solid #2a323c; }
  #side ul { list-style: none; margin: 0; padding: 6px 0; }
  #side li { display: flex; align-items: center; gap: 10px; padding: 7px 14px;
    cursor: pointer; font-size: 13px; }
  #side li:hover { background: #1d2630; }
  .badge { flex: none; width: 24px; height: 24px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: #fff; }
  .seg-num { background: #fff; color: #111; border-radius: 50%;
    width: 22px; height: 22px; line-height: 22px; text-align: center;
    font-size: 11px; font-weight: 700; box-shadow: 0 0 0 2px rgba(0,0,0,.4); }
</style>
</head>
<body>
<div id="app">
  <div id="map"></div>
  <div id="side">
    <h1>Flandrien Challenge — ${segments.length} segments</h1>
    <ul id="list"></ul>
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

const allBounds = [];
const layers = {};

SEGMENTS.forEach(function (seg, idx) {
  if (!seg.coords.length) return;
  const color = colorFor(idx, SEGMENTS.length);

  const line = L.polyline(seg.coords, { color: color, weight: 4, opacity: 0.85 })
    .addTo(map)
    .bindTooltip(seg.n + ". " + seg.name, { sticky: true });

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
    .bindPopup("<b>" + seg.n + ". " + seg.name + "</b>");

  layers[seg.n] = { line: line, marker: marker, bounds: line.getBounds() };
  allBounds.push(start);
  seg.coords.forEach(function (c) { allBounds.push(c); });
});

map.fitBounds(L.latLngBounds(allBounds), { padding: [30, 30] });

const list = document.getElementById("list");
SEGMENTS.forEach(function (seg, idx) {
  const li = document.createElement("li");
  const color = colorFor(idx, SEGMENTS.length);
  li.innerHTML =
    '<span class="badge" style="background:' + color + '">' + seg.n + "</span>" +
    "<span>" + seg.name + (seg.coords.length ? "" : " (no data)") + "</span>";
  li.addEventListener("click", function () {
    const L0 = layers[seg.n];
    if (!L0) return;
    map.fitBounds(L0.bounds, { padding: [60, 60], maxZoom: 17 });
    L0.marker.openPopup();
  });
  list.appendChild(li);
});
</script>
</body>
</html>
`;

const out = path.join(dir, "flandrien-map.html");
fs.writeFileSync(out, html, "utf8");
console.log("Wrote " + out);
