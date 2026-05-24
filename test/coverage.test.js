const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseTrkpts, computeCoverage } = require("../lib/coverage");

const ROOT = path.join(__dirname, "..");

function loadSegments() {
  const dir = path.join(ROOT, "gpx");
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".gpx"))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return files.map((file) => {
    const pts = parseTrkpts(fs.readFileSync(path.join(dir, file), "utf8"));
    return {
      n: parseInt(file, 10),
      name: file.replace(/\.gpx$/i, "").replace(/^\d+-/, "").replace(/-/g, " "),
      coords: pts.map((p) => [p.lat, p.lon]),
    };
  });
}

function loadRoute(name) {
  return parseTrkpts(fs.readFileSync(path.join(ROOT, "routes", name), "utf8"));
}

const SEGMENTS = loadSegments();
const ROUTES = {
  "1-day":   loadRoute("1-day.gpx"),
  "2-day-1": loadRoute("2-day-1.gpx"),
  "2-day-2": loadRoute("2-day-2.gpx"),
  "3-day-1": loadRoute("3-day-1.gpx"),
  "3-day-2": loadRoute("3-day-2.gpx"),
  "3-day-3": loadRoute("3-day-3.gpx"),
};

const ALL_NS = new Set(SEGMENTS.map((s) => s.n));

function missingFrom(covered) {
  return [...ALL_NS].filter((n) => !covered.has(n)).sort((a, b) => a - b);
}

function describeMissing(missing) {
  if (!missing.length) return "";
  const byN = new Map(SEGMENTS.map((s) => [s.n, s.name]));
  return missing.map((n) => `${n} ${byN.get(n)}`).join(", ");
}

test("parseTrkpts: handles both attribute orders and self-closing tags", () => {
  const xml = `
    <gpx>
      <trk><trkseg>
        <trkpt lat="50.1" lon="3.5"><ele>100</ele></trkpt>
        <trkpt lon="3.6" lat="50.2"><ele>110.5</ele></trkpt>
        <trkpt lat="50.3" lon="3.7" />
      </trkseg></trk>
    </gpx>`;
  const pts = parseTrkpts(xml);
  assert.equal(pts.length, 3);
  assert.deepEqual(pts[0], { lat: 50.1, lon: 3.5, ele: 100 });
  assert.equal(pts[1].lat, 50.2);
  assert.equal(pts[1].lon, 3.6);
  assert.equal(pts[1].ele, 110.5);
  assert.equal(pts[2].ele, null);
});

test("fixtures: 59 segments and 6 routes all load with points", () => {
  assert.equal(SEGMENTS.length, 59, "expected 59 segment GPX files");
  for (const s of SEGMENTS) {
    assert.ok(s.coords.length > 1, `segment ${s.n} ${s.name} has no points`);
  }
  for (const [id, pts] of Object.entries(ROUTES)) {
    assert.ok(pts.length > 100, `route ${id} parsed only ${pts.length} points`);
  }
});

test("empty activity covers nothing", () => {
  assert.equal(computeCoverage([], SEGMENTS).size, 0);
  assert.equal(computeCoverage([{ lat: 50, lon: 3 }], SEGMENTS).size, 0);
});

test("a segment's own points as activity cover that segment", () => {
  const seg = SEGMENTS[0];
  const activity = seg.coords.map(([lat, lon]) => ({ lat, lon, ele: null }));
  const covered = computeCoverage(activity, SEGMENTS);
  assert.ok(covered.has(seg.n), `expected segment ${seg.n} (${seg.name}) covered`);
});

test("reversed segment GPX still covers it (direction-agnostic)", () => {
  const seg = SEGMENTS[0];
  const activity = [...seg.coords].reverse().map(([lat, lon]) => ({ lat, lon, ele: null }));
  const covered = computeCoverage(activity, SEGMENTS);
  assert.ok(covered.has(seg.n));
});

test("a far-away activity covers no Flandrien segments", () => {
  // A made-up track in Paris (~250 km south-west of Flanders).
  const activity = [];
  for (let i = 0; i < 200; i++) {
    activity.push({ lat: 48.85 + i * 0.0001, lon: 2.35, ele: null });
  }
  assert.equal(computeCoverage(activity, SEGMENTS).size, 0);
});

test("1-day route covers all 59 segments", () => {
  const covered = computeCoverage(ROUTES["1-day"], SEGMENTS);
  const missing = missingFrom(covered);
  assert.deepEqual(missing, [], `Missing: ${describeMissing(missing)}`);
});

test("2-day routes combined cover all 59 segments", () => {
  const activity = [...ROUTES["2-day-1"], ...ROUTES["2-day-2"]];
  const covered = computeCoverage(activity, SEGMENTS);
  const missing = missingFrom(covered);
  assert.deepEqual(missing, [], `Missing: ${describeMissing(missing)}`);
});

test("3-day routes combined cover all 59 segments", () => {
  const activity = [
    ...ROUTES["3-day-1"], ...ROUTES["3-day-2"], ...ROUTES["3-day-3"],
  ];
  const covered = computeCoverage(activity, SEGMENTS);
  const missing = missingFrom(covered);
  assert.deepEqual(missing, [], `Missing: ${describeMissing(missing)}`);
});

test("each 2-day half covers a non-trivial subset", () => {
  const d1 = computeCoverage(ROUTES["2-day-1"], SEGMENTS);
  const d2 = computeCoverage(ROUTES["2-day-2"], SEGMENTS);
  assert.ok(d1.size > 0, "2-day-1 covers nothing");
  assert.ok(d2.size > 0, "2-day-2 covers nothing");
  assert.ok(d1.size < 59, "2-day-1 unexpectedly covers all");
  assert.ok(d2.size < 59, "2-day-2 unexpectedly covers all");
});

test("each 3-day day covers a non-trivial subset", () => {
  for (const id of ["3-day-1", "3-day-2", "3-day-3"]) {
    const covered = computeCoverage(ROUTES[id], SEGMENTS);
    assert.ok(covered.size > 0, `${id} covers nothing`);
    assert.ok(covered.size < 59, `${id} unexpectedly covers all`);
  }
});
