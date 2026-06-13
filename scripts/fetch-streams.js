// Deterministic replay-link resolution (zero LLM).
//
// NRK: public catalog API → match episodes to ESPN fixtures by kickoff time.
//      Also auto-derives which matches are on NRK (no manual curation).
// TV 2: holds all 104 matches; resolution handled separately (see notes in README).
//
// Runs after build.js (needs matches.json). Writes docs/data/streams.json and
// updates scripts/config/broadcasters.json with the NRK free-match list.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveNrkLinks } from "./lib/nrk.js";

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

  // merge NRK urls (preserve any existing tv2 links)
  for (const [id, url] of Object.entries(nrk.byMatchId)) {
    streams[id] = { ...(streams[id] || {}), nrk: url };
  }

  // auto-derive NRK free-match list from the catalog
  broadcasters.nrkFreeMatchIds = [...new Set(nrk.nrkMatchIds)].sort();

  await writeFile(
    join(DATA, "streams.json"),
    JSON.stringify({ _comment: streamsDoc._comment, updated: new Date().toISOString(), streams }, null, 2),
  );
  await writeFile(join(CONFIG, "broadcasters.json"), JSON.stringify(broadcasters, null, 2) + "\n");

  console.log(
    `fetch-streams: NRK catalog ${nrk.episodeCount} episodes → ${nrk.nrkMatchIds.length} matches linked; ` +
      `${matches.length - nrk.nrkMatchIds.length} remaining on TV 2`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
