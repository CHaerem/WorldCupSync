// Deterministic replay-link resolution (zero LLM).
//
// NRK: public catalog API → match episodes to ESPN fixtures by kickoff time.
//      Also auto-derives which matches are on NRK (no manual curation).
// TV 2: public sitemaps list every fixture page → match by slug (team names for
//       the group stage, FIFA group slots for the round of 32). R16+ are left to
//       the app's hub fallback (provider bracket placeholders don't line up yet).
//
// Runs after build.js (needs matches.json). Writes docs/data/streams.json and
// updates scripts/config/broadcasters.json with the NRK free-match list.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveNrkLinks } from "./lib/nrk.js";
import { resolveTv2Links, resolveTv2Summaries } from "./lib/tv2.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "docs", "data");
const CONFIG = join(ROOT, "scripts", "config");

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function main() {
  const { matches } = await readJson(join(DATA, "matches.json"), { matches: [] });
  if (!matches.length) {
    console.log("fetch-streams: no matches.json yet — run build first");
    return;
  }

  const streamsDoc = await readJson(join(DATA, "streams.json"), { streams: {} });
  const streams = streamsDoc.streams || {};
  const broadcasters = await readJson(join(CONFIG, "broadcasters.json"), {
    defaultBroadcaster: "TV2",
    nrkFreeMatchIds: [],
  });

  let nrk = { byMatchId: {}, nrkMatchIds: [], episodeCount: 0 };
  try {
    nrk = await resolveNrkLinks(matches);
  } catch (e) {
    console.error("fetch-streams: NRK resolution failed —", e.message);
  }

  let tv2 = { byMatchId: {}, tv2MatchIds: [], counts: {} };
  let tv2sum = { byMatchId: {}, count: 0 };
  try {
    tv2 = await resolveTv2Links(matches);
    tv2sum = await resolveTv2Summaries(matches);
  } catch (e) {
    console.error("fetch-streams: TV 2 resolution failed —", e.message);
  }

  // merge resolved urls (each source only sets its own key; the others are preserved)
  for (const [id, url] of Object.entries(nrk.byMatchId)) {
    streams[id] = { ...(streams[id] || {}), nrk: url };
  }
  for (const [id, url] of Object.entries(tv2.byMatchId)) {
    streams[id] = { ...(streams[id] || {}), tv2: url };
  }
  for (const [id, url] of Object.entries(tv2sum.byMatchId)) {
    streams[id] = { ...(streams[id] || {}), summary: url };
  }

  // auto-derive NRK free-match list from the catalog
  broadcasters.nrkFreeMatchIds = [...new Set(nrk.nrkMatchIds)].sort();

  await writeFile(
    join(DATA, "streams.json"),
    JSON.stringify({ _comment: streamsDoc._comment, updated: new Date().toISOString(), streams }, null, 2),
  );
  await writeFile(join(CONFIG, "broadcasters.json"), JSON.stringify(broadcasters, null, 2) + "\n");

  const linked = new Set([...nrk.nrkMatchIds, ...tv2.tv2MatchIds]);
  console.log(
    `fetch-streams: NRK ${nrk.nrkMatchIds.length} (of ${nrk.episodeCount} episodes), ` +
      `TV 2 ${tv2.tv2MatchIds.length} (${tv2.counts.group || 0} group + ${tv2.counts.r32 || 0} R32, ` +
      `${tv2.counts.knockoutSkipped || 0} R16+ skipped); ` +
      `${linked.size}/${matches.length} matches now have a direct link; ` +
      `${tv2sum.count} TV 2 summaries`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
