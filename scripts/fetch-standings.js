// Fetch group standings from ESPN → docs/data/standings.json
// Spoiler-laden: the frontend gates this behind an explicit reveal.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchStandings } from "./lib/espn.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "data", "standings.json");

function stat(entry, name) {
  const s = (entry.stats || []).find((x) => x.name === name);
  return s ? (s.value != null ? s.value : s.displayValue) : null;
}

export async function buildStandings() {
  const data = await fetchStandings();
  const groups = (data.children || []).map((g) => {
    const entries = (g.standings?.entries || []).map((e) => ({
      teamId: e.team?.id,
      team: e.team?.displayName || e.team?.name,
      abbr: e.team?.abbreviation,
      logo: e.team?.logos?.[0]?.href || e.team?.logo || null,
      rank: stat(e, "rank"),
      played: stat(e, "gamesPlayed"),
      wins: stat(e, "wins"),
      ties: stat(e, "ties"),
      losses: stat(e, "losses"),
      gf: stat(e, "pointsFor"),
      ga: stat(e, "pointsAgainst"),
      gd: stat(e, "pointDifferential"),
      points: stat(e, "points"),
      advanced: stat(e, "advanced"),
    }));
    entries.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    return { name: g.name, abbreviation: g.abbreviation, entries };
  });
  return groups;
}

// team displayName -> group name, used by build.js to tag matches
export function teamGroupMap(groups) {
  const map = {};
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.team) map[e.team] = g.name;
    }
  }
  return map;
}

async function main() {
  const groups = await buildStandings();
  const payload = { updated: new Date().toISOString(), groups };
  await writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(`standings.json: ${groups.length} groups`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
