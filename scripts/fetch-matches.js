// Fetch all 104 World Cup matches from ESPN → docs/data/matches.json
// IMPORTANT: this file contains scores/results. The frontend is responsible for
// spoiler-gating them — the data layer fetches everything.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchScoreboard, osloParts } from "./lib/espn.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "data", "matches.json");

function stateOf(status) {
  const s = status?.type?.state; // "pre" | "in" | "post"
  return s || "pre";
}

function mapCompetitor(c) {
  const t = c?.team || {};
  return {
    id: t.id,
    name: t.displayName || t.name,
    abbr: t.abbreviation,
    logo: t.logos?.[0]?.href || t.logo || null,
    score: c?.score != null ? Number(c.score) : null,
    winner: c?.winner === true,
  };
}

export async function buildMatches() {
  const data = await fetchScoreboard();
  const events = data.events || [];

  const matches = events.map((e) => {
    const comp = e.competitions?.[0] || {};
    const competitors = comp.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") || competitors[1];
    const status = comp.status || e.status || {};
    const state = stateOf(status);
    const note = comp.notes?.[0]?.headline || e.season?.slug || null;

    return {
      id: e.id,
      date: e.date, // ISO UTC
      ...osloParts(e.date),
      name: e.name,
      shortName: e.shortName,
      // group is joined in build.js from standings (team → group map)
      group: null,
      roundNote: note,
      venue: comp.venue?.fullName || e.venue?.fullName || null,
      city: comp.venue?.address?.city || null,
      state,
      completed: state === "post",
      statusDetail: status?.type?.shortDetail || status?.type?.detail || null,
      home: home ? mapCompetitor(home) : null,
      away: away ? mapCompetitor(away) : null,
    };
  });

  matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  return matches;
}

async function main() {
  const matches = await buildMatches();
  const payload = { updated: new Date().toISOString(), count: matches.length, matches };
  await writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(`matches.json: ${matches.length} matches`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
