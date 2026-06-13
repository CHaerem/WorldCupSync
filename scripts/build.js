// Orchestrates the data build:
//   1. fetch standings (group tables)
//   2. fetch matches, tag each with its group (from standings) + broadcaster + stream links
//   3. write matches.json, standings.json, meta.json
//
// Broadcaster + replay-stream links come from local config/data, not ESPN:
//   - scripts/config/broadcasters.json  (curated NRK-free-match list, hand/AI maintained)
//   - docs/data/streams.json            (per-match replay URLs, filled by discover-streams.js)

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildMatches } from "./fetch-matches.js";
import { buildStandings, teamGroupMap } from "./fetch-standings.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "docs", "data");

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const [groups, matches, broadcasters, streams] = await Promise.all([
    buildStandings(),
    buildMatches(),
    readJson(join(ROOT, "scripts", "config", "broadcasters.json"), {
      defaultBroadcaster: "TV2",
      nrkFreeMatchIds: [],
    }),
    readJson(join(DATA, "streams.json"), { streams: {} }),
  ]);

  const groupOf = teamGroupMap(groups);
  const nrkFree = new Set((broadcasters.nrkFreeMatchIds || []).map(String));
  const streamMap = streams.streams || {};

  for (const m of matches) {
    // tag group from standings (knockout matches stay null → use roundNote)
    m.group = groupOf[m.home?.name] || groupOf[m.away?.name] || null;

    // broadcaster: NRK if it's a free match, otherwise TV2 (which holds all 104)
    m.nrkFree = nrkFree.has(String(m.id));
    m.broadcaster = m.nrkFree ? "NRK" : broadcasters.defaultBroadcaster || "TV2";

    // replay links resolved by the discovery step (may be absent until then)
    m.streams = streamMap[m.id] || null;
  }

  const now = new Date().toISOString();
  await Promise.all([
    writeFile(
      join(DATA, "matches.json"),
      JSON.stringify({ updated: now, count: matches.length, matches }, null, 2),
    ),
    writeFile(
      join(DATA, "standings.json"),
      JSON.stringify({ updated: now, groups }, null, 2),
    ),
    writeFile(
      join(DATA, "meta.json"),
      JSON.stringify(
        {
          updated: now,
          matchCount: matches.length,
          groupCount: groups.length,
          withStreams: matches.filter((m) => m.streams).length,
        },
        null,
        2,
      ),
    ),
  ]);

  console.log(
    `build: ${matches.length} matches, ${groups.length} groups, ` +
      `${matches.filter((m) => m.streams).length} with replay links`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
