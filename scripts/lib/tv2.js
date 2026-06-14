// TV 2 Play catalog resolver — deterministic, zero-LLM replay-link discovery.
//
// TV 2 carries the whole tournament. Every fixture is a page at
//   play.tv2.no/sport/fotball/fifa-fotball-vm-xx2qwthv/<slug>-<assetId>
// and those pages are listed publicly in TV 2's XML sitemaps (no auth needed —
// the JSON API requires a login token, the sitemaps do not). We match each page
// to an ESPN fixture by parsing the slug, which encodes the matchup:
//   • group stage : "<homeNo>-<awayNo>"  (Norwegian team names, e.g. "irak-norge")
//   • round of 32 : "<slot>-<slot>"      (FIFA group positions, e.g. "1c-2f", "1a-3cefhi")
//
// Round of 16 and later are intentionally NOT resolved: TV 2 chains feeder
// group-slots ("1c-2f-2e-2i") while ESPN references feeder match numbers, and the
// provisional third-place assignments differ between the two providers — so a
// derived link would sometimes be wrong. Those fall back to the WC hub in the app.

import { NO_TO_EN } from "./nrk.js";

const SITEMAP_INDEX = "https://play.tv2.no/sitemap.xml";
export const TV2_SERIES = "fifa-fotball-vm-xx2qwthv";
const FIXTURE_RE = new RegExp(`https://play\\.tv2\\.no/sport/fotball/${TV2_SERIES}/[^<?\\s]+`, "gi");

// Slugify a Norwegian team name the way TV 2 does (æøå transliterated, spaces → '-').
const slugify = (s) =>
  s.toLowerCase()
    .replace(/ø/g, "oe").replace(/å/g, "aa").replace(/æ/g, "ae")
    .replace(/ç/g, "c").replace(/ü/g, "u").replace(/é/g, "e")
    .replace(/\s+/g, "-");

// teamSlug → English displayName (ESPN spelling). Built from the shared NO_TO_EN map.
const SLUG_TO_EN = (() => {
  const out = {};
  for (const [no, en] of Object.entries(NO_TO_EN)) out[slugify(no)] = en;
  out["new-zealand"] = "New Zealand"; // TV 2 uses the English form, not "ny-zealand"
  return out;
})();

async function getText(url) {
  const res = await fetch(url, { headers: { accept: "application/xml", "User-Agent": "worldcupsync/0.1" } });
  if (!res.ok) throw new Error(`TV2 ${res.status} ${url}`);
  return res.text();
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim());

// Collect every WC fixture page URL from the sitemaps (sports-* hold live events).
async function fetchAllFixtureUrls() {
  const index = await getText(SITEMAP_INDEX);
  const sportsMaps = locs(index).filter((u) => /sitemap-sports-\d+\.xml/.test(u));
  const urls = new Set();
  for (const sm of sportsMaps) {
    try {
      const xml = await getText(sm);
      for (const u of xml.match(FIXTURE_RE) || []) urls.add(u.replace(/\?.*$/, ""));
    } catch (e) {
      console.error(`  tv2 sitemap ${sm.split("/").pop()} failed: ${e.message}`);
    }
  }
  return [...urls];
}

// "irak-norge" → ["Iraq","Norway"] (group stage), trying every split point so
// multi-word names ("new-zealand-belgia") resolve correctly. null if not two teams.
function parseGroupTeams(slug) {
  const p = slug.split("-");
  for (let i = 1; i < p.length; i++) {
    const a = SLUG_TO_EN[p.slice(0, i).join("-")];
    const b = SLUG_TO_EN[p.slice(i).join("-")];
    if (a && b) return [a, b];
  }
  return null;
}

// Returns { byMatchId: { id: tv2Url }, tv2MatchIds: [ids], ... }
// `urls` can be injected (tests); otherwise they're read from the live sitemaps.
export async function resolveTv2Links(matches, urls) {
  if (!urls) urls = await fetchAllFixtureUrls();

  const group = matches.filter((m) => /group/i.test(m.roundNote || ""));
  const r32 = matches.filter((m) => m.roundNote === "round-of-32");

  // group stage: index by unordered team-name pair
  const pairKey = (a, b) => [a, b].map((x) => (x || "").toLowerCase()).sort().join("|");
  const byPair = new Map();
  for (const m of group) byPair.set(pairKey(m.home?.name, m.away?.name), m);

  // R32: index by each concrete group slot (1A, 2F …) — unique to one R32 match
  const concreteSlots = (m) =>
    [m.home?.abbr, m.away?.abbr].filter((a) => /^[12][A-L]$/.test(a || "")).map((a) => a.toLowerCase());
  const bySlot = new Map();
  for (const m of r32) for (const s of concreteSlots(m)) bySlot.set(s, m);

  const byMatchId = {};
  const counts = { fixtures: urls.length, group: 0, r32: 0, knockoutSkipped: 0 };

  for (const url of urls) {
    const slug = url.split("/").pop().replace(/-[a-z0-9]{8}$/, "");

    // bracket slug? tokens look like 1c / 2f / 3cefhi
    const tokens = slug.split("-");
    const slotToks = tokens.filter((t) => /^[123][a-l]+$/.test(t));
    const isBracket = slotToks.length === tokens.length && tokens.length >= 2;

    if (!isBracket) {
      const teams = parseGroupTeams(slug);
      if (!teams) continue;
      const m = byPair.get(pairKey(teams[0], teams[1]));
      if (m) { byMatchId[m.id] = url; counts.group++; }
      continue;
    }

    // bracket: only R32 is safe (exactly two slots). Deeper rounds chain feeders.
    const concrete = slotToks.filter((t) => /^[12][a-l]$/.test(t));
    if (tokens.length === 2 && concrete.length) {
      // every concrete slot must point at the same R32 fixture
      const hits = new Set(concrete.map((t) => bySlot.get(t)).filter(Boolean));
      if (hits.size === 1) { byMatchId[[...hits][0].id] = url; counts.r32++; }
      else counts.knockoutSkipped++;
    } else {
      counts.knockoutSkipped++; // R16+ — left to the hub fallback
    }
  }

  return { byMatchId, tv2MatchIds: Object.keys(byMatchId), counts };
}
