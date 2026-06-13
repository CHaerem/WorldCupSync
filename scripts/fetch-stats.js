// Tournament stats → docs/data/stats.json
//
// ESPN has no populated tournament-wide leaders endpoint for fifa.world, so we
// compute them ourselves by aggregating goal events from each finished match's
// summary. Deterministic, no LLM. Spoiler-laden (reveals scorers) — the frontend
// gates this behind spoiler mode.

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "docs", "data");
const SUMMARY = (id) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${id}`;

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "worldcupsync/0.1" } });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

// run async tasks with bounded concurrency
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
      }
    }),
  );
  return out;
}

export async function buildStats() {
  const { matches } = JSON.parse(await readFile(join(DATA, "matches.json"), "utf8"));
  const logoOf = {};
  for (const m of matches) {
    for (const t of [m.home, m.away]) if (t?.name && t.logo) logoOf[t.name] = t.logo;
  }
  const finished = matches.filter((m) => m.completed);

  const scorers = new Map(); // "name|team" -> {name, team, goals, assists}
  let totalGoals = 0;

  await pool(finished, 6, async (m) => {
    const data = await getJson(SUMMARY(m.id));
    for (const e of data.keyEvents || []) {
      if (!e.scoringPlay || e.shootout) continue; // skip own-goal? keep; skip shootout
      const team = e.team?.displayName;
      const parts = e.participants || [];
      const scorer = parts[0]?.athlete?.displayName;
      const assist = parts[1]?.athlete?.displayName;
      if (scorer) {
        totalGoals++;
        const key = `${scorer}|${team}`;
        const row = scorers.get(key) || { name: scorer, team, goals: 0, assists: 0 };
        row.goals++;
        scorers.set(key, row);
      }
      if (assist) {
        const key = `${assist}|${team}`;
        const row = scorers.get(key) || { name: assist, team, goals: 0, assists: 0 };
        row.assists++;
        scorers.set(key, row);
      }
    }
  });

  const topScorers = [...scorers.values()]
    .map((r) => ({ ...r, teamLogo: logoOf[r.team] || null }))
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name))
    .filter((r) => r.goals > 0)
    .slice(0, 30);

  return {
    matchesPlayed: finished.length,
    totalGoals,
    avgGoals: finished.length ? Math.round((totalGoals / finished.length) * 100) / 100 : 0,
    topScorers,
  };
}

async function main() {
  const stats = await buildStats();
  await writeFile(
    join(DATA, "stats.json"),
    JSON.stringify({ updated: new Date().toISOString(), ...stats }, null, 2),
  );
  console.log(
    `stats.json: ${stats.matchesPlayed} matches, ${stats.totalGoals} goals, ${stats.topScorers.length} scorers`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
