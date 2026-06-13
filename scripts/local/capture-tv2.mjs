// LOCAL-ONLY helper — captures TV 2 Play match VOD deep-links → scripts/config/tv2-streams.json
//
// Why local: TV 2 Play is authenticated/paywalled, so its catalog can only be read from a
// logged-in browser session. GitHub Actions has no session, so this can never run in CI —
// it's a manual step you run on your machine, occasionally, as new match pages appear.
// (NRK, by contrast, is fully automatic via its open catalog API — see fetch-streams.js.)
//
// Setup (one time per run):
//   1. Launch the Playwright Chromium with a debugging port + its own profile:
//        "$(node -e "process.stdout.write(require('playwright').chromium.executablePath())")" \
//          --remote-debugging-port=9222 --user-data-dir="$HOME/.wcs-tv2-profile" \
//          https://play.tv2.no/sport/fotball/fifa-fotball-vm26
//   2. Log into TV 2 Play in that window (your credentials go only to TV 2, never through this script).
//   3. Run:  node scripts/local/capture-tv2.mjs   (needs `playwright` resolvable on NODE_PATH)
//
// The profile persists, so subsequent runs won't need a fresh login until the session expires.

import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CDP = process.env.WCS_CDP || "http://localhost:9222";

// Norwegian team slug → English (ESPN displayName). Closed set of 48 finalists.
const NO = {
  algerie: "Algeria", argentina: "Argentina", australia: "Australia", "østerrike": "Austria",
  belgia: "Belgium", "bosnia-hercegovina": "Bosnia-Herzegovina", brasil: "Brazil", canada: "Canada",
  "kapp verde": "Cape Verde", colombia: "Colombia", "dr kongo": "Congo DR", kongo: "Congo DR",
  kroatia: "Croatia", "curaçao": "Curaçao", tsjekkia: "Czechia", ecuador: "Ecuador", egypt: "Egypt",
  england: "England", frankrike: "France", tyskland: "Germany", ghana: "Ghana", haiti: "Haiti",
  iran: "Iran", irak: "Iraq", elfenbenskysten: "Ivory Coast", japan: "Japan", jordan: "Jordan",
  mexico: "Mexico", marokko: "Morocco", nederland: "Netherlands", "ny-zealand": "New Zealand",
  "new zealand": "New Zealand", norge: "Norway", panama: "Panama", paraguay: "Paraguay",
  portugal: "Portugal", qatar: "Qatar", "saudi-arabia": "Saudi Arabia", skottland: "Scotland",
  senegal: "Senegal", "sør-afrika": "South Africa", "sør-korea": "South Korea", spania: "Spain",
  sverige: "Sweden", sveits: "Switzerland", tunisia: "Tunisia", tyrkia: "Türkiye",
  usa: "United States", uruguay: "Uruguay", usbekistan: "Uzbekistan",
};
const slugify = (s) =>
  s.toLowerCase().replace(/ø/g, "oe").replace(/æ/g, "ae").replace(/å/g, "aa")
    .replace(/ç/g, "c").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const slug2en = {};
for (const [no, en] of Object.entries(NO)) slug2en[slugify(no)] = en;

// split "<home>-<away>-<assetid>" using the closed set of known team slugs
function parsePair(href) {
  const tk = href.split("/").pop().split("-");
  for (let i = 1; i <= 3; i++) {
    const a = tk.slice(0, i).join("-");
    if (!slug2en[a]) continue;
    for (let j = 1; j <= 3; j++) {
      const b = tk.slice(i, i + j).join("-");
      if (!slug2en[b]) continue;
      if (tk.slice(i + j).join("-").length >= 5) return [slug2en[a], slug2en[b]];
    }
  }
  return null;
}

const SOURCES = [
  ..."abcdefghijkl".split("").map((g) => `https://play.tv2.no/sport/fotball/fotballvm26-gruppe-${g}`),
  "https://play.tv2.no/sport/fotball/fotballvm26-%C3%B8vrig",
  "https://play.tv2.no/feed/feed_01ks2cph7nectvsrvd5w96ggrq", // "Se full kampoversikt"
];

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("tv2.no")) || ctx.pages()[0] || (await ctx.newPage());

const found = new Set();
for (const url of SOURCES) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2200);
    let prev = 0;
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, 2000).catch(() => {});
      await page.waitForTimeout(400);
      const n = await page.$$eval("a[href*='/fifa-fotball-vm-']", (a) => a.length).catch(() => 0);
      if (n === prev && i > 5) break;
      prev = n;
    }
    const ls = await page.$$eval("a[href*='/fifa-fotball-vm-']", (as) => as.map((a) => a.getAttribute("href")));
    ls.forEach((h) => {
      if (h && /\/fifa-fotball-vm-[^/]+\/[^/?]+-[a-z0-9]{5,}/i.test(h)) found.add(h.split("?")[0]);
    });
  } catch (e) {
    console.error("  source failed:", url, e.message.split("\n")[0]);
  }
}
await browser.close().catch(() => {}); // detaches CDP; does NOT close your browser

const matches = JSON.parse(readFileSync(join(ROOT, "docs", "data", "matches.json"))).matches;
const idx = {};
for (const m of matches) {
  if (m.home?.name && m.away?.name) idx[[m.home.name, m.away.name].sort().join("|")] = m;
}

const tv2 = {};
const unmatched = [];
for (const href of found) {
  const pair = parsePair(href);
  if (!pair) { unmatched.push(href + " (slug)"); continue; }
  const m = idx[pair.slice().sort().join("|")];
  if (!m) { unmatched.push(href + ` (${pair.join(" v ")} — no fixture)`); continue; }
  tv2[m.id] = "https://play.tv2.no" + href;
}

writeFileSync(
  join(ROOT, "scripts", "config", "tv2-streams.json"),
  JSON.stringify({
    _comment: "TV2 Play match VOD deep-links, keyed by ESPN match id. Captured from a logged-in TV2 Play session via scripts/local/capture-tv2.mjs (TV2 is authenticated, so this is manual/local — not part of CI). Re-run occasionally as new matches get asset pages.",
    updated: new Date().toISOString(),
    streams: tv2,
  }, null, 2) + "\n",
);

console.log(`captured ${found.size} links → mapped ${Object.keys(tv2).length} fixtures, ${unmatched.length} unmatched`);
unmatched.slice(0, 20).forEach((u) => console.log("   ?", u));
