// Dependency-free tests (node:test). Cover the regression class that broke the
// page ("Laster" — app.js threw at boot), the pure logic (dates, projection,
// venues, weather), and asset integrity. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL(`../docs/${p}`, import.meta.url), "utf8");
const APP = read("js/app.js");
const AMERICAS = read("js/americas.js");

// minimal DOM/host stubs so app.js can boot in a vm context
function makeEl() {
  return {
    innerHTML: "", hidden: false, textContent: "", dataset: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, remove() {}, scrollIntoView() {}, appendChild() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 156 }; },
    clientWidth: 320, clientHeight: 156,
  };
}

const FAKE = {
  matches: {
    matches: [
      { id: "1", date: "2026-06-13T19:00Z", osloDate: "2026-06-13", osloTime: "21:00", state: "post", completed: true, group: "Group A", roundNote: "group-stage", venue: "Estadio Banorte", city: "Mexico City", nrkFree: true, streams: { nrk: "https://nrk" }, home: { name: "Mexico", score: 2, logo: "" }, away: { name: "USA", score: 0, logo: "" } },
      { id: "2", date: "2026-06-14T02:00Z", osloDate: "2026-06-14", osloTime: "02:00", state: "pre", completed: false, group: "Group B", roundNote: "group-stage", venue: "BC Place", city: "Vancouver", nrkFree: false, streams: { tv2: "https://tv2" }, home: { name: "Canada", logo: "" }, away: { name: "Norway", logo: "" } },
      { id: "3", date: "2026-06-20T19:00Z", osloDate: "2026-06-20", osloTime: "21:00", state: "pre", completed: false, group: "Group C", roundNote: "group-stage", venue: "MetLife Stadium", city: "East Rutherford", nrkFree: true, streams: {}, home: { name: "Brazil", logo: "" }, away: { name: "England", logo: "" } },
    ],
  },
  standings: { groups: [{ name: "Group A", entries: [{ team: "Mexico", logo: "", played: 1, wins: 1, ties: 0, losses: 0, gf: 2, ga: 0, gd: 2, points: 3 }] }] },
  stats: { matchesPlayed: 1, totalGoals: 2, avgGoals: 2, topScorers: [{ name: "X", team: "Mexico", goals: 2, assists: 1, teamLogo: "" }] },
};

const EXPOSE = "\n;globalThis.__t = { programDate, dayDiff, naX, naY, venueCountry, wmo, isStale, isRevealed, todayOslo, VENUES };";

function boot() {
  const appEl = makeEl();
  const els = { app: appEl };
  const store = {};
  const sandbox = {
    console,
    navigator: { userAgent: "node-test" },
    location: { origin: "http://localhost" },
    addEventListener() {},
    setTimeout, clearTimeout,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    fetch: (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(url.includes("matches") ? FAKE.matches : url.includes("standings") ? FAKE.standings : FAKE.stats) }),
    document: {
      getElementById: (id) => (id === "app" ? appEl : (els[id] ||= makeEl())),
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => makeEl(),
      body: { appendChild() {} },
      activeElement: null,
      documentElement: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {} },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(AMERICAS, ctx, { filename: "americas.js" });
  vm.runInContext(APP + EXPOSE, ctx, { filename: "app.js" });
  return { sandbox, appEl };
}

const shift = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test("app boots and renders without throwing (the 'Laster' regression)", async () => {
  let appEl;
  assert.doesNotThrow(() => ({ appEl } = boot()));
  ({ appEl } = boot());
  await new Promise((r) => setTimeout(r, 30)); // let load()'s fetch + render resolve
  assert.ok(appEl.innerHTML.length > 0, "#app should render content");
  assert.doesNotMatch(appEl.innerHTML, /Kunne ikke laste/, "render must not error out");
});

test("programDate: after-midnight matches belong to the previous evening", () => {
  const { __t } = boot().sandbox;
  assert.equal(__t.programDate({ osloDate: "2026-06-12", osloTime: "02:00" }), "2026-06-11");
  assert.equal(__t.programDate({ osloDate: "2026-06-12", osloTime: "21:00" }), "2026-06-12");
});

test("dayDiff counts whole days", () => {
  const { __t } = boot().sandbox;
  assert.equal(__t.dayDiff("2026-06-14", "2026-06-12"), 2);
  assert.equal(__t.dayDiff("2026-06-14", "2026-06-14"), 0);
});

test("staleness: yesterday hidden, 2+ days ago auto-revealed", () => {
  const { __t } = boot().sandbox;
  const today = __t.todayOslo();
  const fresh = { completed: true, osloDate: shift(today, -1), osloTime: "21:00" };
  const old = { completed: true, osloDate: shift(today, -3), osloTime: "21:00" };
  assert.equal(__t.isStale(fresh), false);
  assert.equal(__t.isStale(old), true);
  assert.equal(__t.isRevealed(fresh), false, "fresh result stays hidden");
  assert.equal(__t.isRevealed(old), true, "old result shows automatically");
});

test("map projection matches the silhouette viewBox", () => {
  const { __t } = boot().sandbox;
  assert.equal(__t.naX(-170), 0);
  assert.equal(__t.naX(-50), 240);
  assert.equal(__t.naY(73), 0);
  assert.equal(__t.naY(6), 134);
  assert.ok(Math.abs(__t.naX(-99.15) - 141.7) < 1, "Mexico City x");
  assert.ok(Math.abs(__t.naY(19.3) - 107.4) < 1, "Mexico City y");
});

test("venueCountry maps the 16 hosts to the right country", () => {
  const { __t } = boot().sandbox;
  assert.equal(Object.keys(__t.VENUES).length, 16);
  assert.equal(__t.venueCountry("Estadio Banorte"), "Mexico");
  assert.equal(__t.venueCountry("BC Place"), "Canada");
  assert.equal(__t.venueCountry("MetLife Stadium"), "USA");
});

test("weather codes map to Norwegian conditions", () => {
  const { __t } = boot().sandbox;
  assert.equal(__t.wmo(0), "klart");
  assert.equal(__t.wmo(2), "lettskyet");
  assert.equal(__t.wmo(61), "regn");
  assert.equal(__t.wmo(95), "torden");
});

test("scripts parse (syntax) and PWA shell assets exist", () => {
  for (const f of ["js/app.js", "js/americas.js", "sw.js"]) assert.doesNotThrow(() => new vm.Script(read(f)), f);
  JSON.parse(read("manifest.webmanifest"));
  for (const f of ["index.html", "js/app.js", "js/americas.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
    assert.ok(fs.existsSync(new URL(`../docs/${f}`, import.meta.url)), `missing ${f}`);
  }
});
