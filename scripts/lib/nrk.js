// NRK TV catalog resolver — deterministic, zero-LLM replay-link discovery.
//
// NRK exposes the whole tournament as a public catalog series. Each match it
// carries is an episode with an exact (Oslo) timestamp and a direct play URL.
// We match those episodes to ESPN fixtures by kickoff time (language-independent),
// using a Norwegian→English country map only to disambiguate simultaneous matches.

const PSAPI = "https://psapi.nrk.no";
export const NRK_SERIES = "fifa-fotball-vm-2026";

// Norwegian → English for the 48 finalists (ESPN's displayName spellings).
// Only needed to break ties when two matches kick off at the same instant.
const NO_TO_EN = {
  algerie: "Algeria", argentina: "Argentina", australia: "Australia",
  østerrike: "Austria", belgia: "Belgium", "bosnia-hercegovina": "Bosnia-Herzegovina",
  brasil: "Brazil", canada: "Canada", "kapp verde": "Cape Verde", colombia: "Colombia",
  "dr kongo": "Congo DR", kongo: "Congo DR", kroatia: "Croatia", curaçao: "Curaçao",
  tsjekkia: "Czechia", ecuador: "Ecuador", egypt: "Egypt", england: "England",
  frankrike: "France", tyskland: "Germany", ghana: "Ghana", haiti: "Haiti",
  iran: "Iran", irak: "Iraq", elfenbenskysten: "Ivory Coast", japan: "Japan",
  jordan: "Jordan", mexico: "Mexico", marokko: "Morocco", nederland: "Netherlands",
  "ny-zealand": "New Zealand", "new zealand": "New Zealand", norge: "Norway",
  panama: "Panama", paraguay: "Paraguay", portugal: "Portugal", qatar: "Qatar",
  "saudi-arabia": "Saudi Arabia", skottland: "Scotland", senegal: "Senegal",
  "sør-afrika": "South Africa", "sør-korea": "South Korea", spania: "Spain",
  sverige: "Sweden", sveits: "Switzerland", tunisia: "Tunisia", tyrkia: "Türkiye",
  usa: "United States", uruguay: "Uruguay", usbekistan: "Uzbekistan",
};

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json", "User-Agent": "worldcupsync/0.1" } });
  if (!res.ok) throw new Error(`NRK ${res.status} ${url}`);
  return res.json();
}

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const toEn = (noName) => NO_TO_EN[norm(noName)] || null;

function cleanUrl(href) {
  // strip URI-template tail like {&autoplay,t}
  return (href || "").replace(/\{.*$/, "");
}

// Parse an episode title such as "28. juni kl. 04:00 · Algerie–Østerrike".
// Returns the two Norwegian team names, or null for studio/highlight/round episodes.
function parseTeams(title) {
  if (!title) return null;
  const seg = title.split("·").pop().trim(); // last segment holds the teams
  const m = seg.split(/[–—-]/).map((x) => x.trim()); // en/em/hyphen dash
  if (m.length !== 2 || !m[0] || !m[1]) return null;
  // reject round labels ("16-delsfinale" splits oddly but has digits/keywords)
  if (/finale|delsfinale|sluttspill|studio|h.ydepunkt|magasin/i.test(seg)) return null;
  return [m[0], m[1]];
}

async function fetchAllEpisodes() {
  // The light /series/{id} endpoint carries the season list; the /tv/catalog one does not.
  const series = await getJson(`${PSAPI}/series/${NRK_SERIES}`);
  const seasons = (series.seasons || []).map((s) => s.name).filter(Boolean);
  const episodes = [];
  for (const name of seasons) {
    try {
      const data = await getJson(`${PSAPI}/tv/catalog/series/${NRK_SERIES}/seasons/${name}`);
      const eps = data._embedded?.episodes || data._embedded?.instalments || [];
      episodes.push(...eps);
    } catch (e) {
      console.error(`  nrk season ${name} failed: ${e.message}`);
    }
  }
  return episodes;
}

// Returns { byMatchId: { id: nrkUrl }, nrkMatchIds: [ids] }
export async function resolveNrkLinks(matches) {
  const episodes = await fetchAllEpisodes();

  // index ESPN matches by kickoff epoch (minute precision)
  const minute = (iso) => Math.round(new Date(iso).getTime() / 60000);
  const byTime = new Map();
  for (const m of matches) {
    const key = minute(m.date);
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(m);
  }

  const byMatchId = {};
  let parsed = 0;
  for (const ep of episodes) {
    const title = (typeof ep.titles === "object" ? ep.titles?.title : null) || ep.title;
    const when = ep.releaseDateOnDemand || ep.firstPublished || ep.usageRights?.availableFrom;
    const href = cleanUrl(ep._links?.share?.href || ep._links?.self?.href);
    if (!when || !href) continue;
    parsed++;

    const teams = parseTeams(title);
    const key = minute(when);
    // candidates within ±15 min (NRK occasionally rounds availability time)
    let candidates = [];
    for (let d = -15; d <= 15; d++) candidates.push(...(byTime.get(key + d) || []));
    if (!candidates.length) continue;

    let match;
    if (candidates.length === 1) {
      match = candidates[0];
    } else if (teams) {
      const en = teams.map(toEn);
      match = candidates.find((c) => {
        const names = [c.home?.name, c.away?.name];
        return en.every((e) => e && names.includes(e));
      });
    }
    if (match) byMatchId[match.id] = href;
  }

  return { byMatchId, nrkMatchIds: Object.keys(byMatchId), episodeCount: episodes.length, parsedCount: parsed };
}
