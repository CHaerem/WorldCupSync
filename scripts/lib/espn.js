// ESPN public API helpers for the 2026 FIFA World Cup (league code: fifa.world).
// No auth required. These are the only data calls the project makes for results/stats.

const SITE = "https://site.api.espn.com/apis";
export const LEAGUE = "fifa.world";
export const SEASON = 2026;

// Tournament window (Europe/Oslo dates). USA/Canada/Mexico 2026: 11 Jun – 19 Jul.
export const TOURNAMENT_START = "20260611";
export const TOURNAMENT_END = "20260719";

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "worldcup-2026/0.1 (+github-pages)" },
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

export function scoreboardUrl() {
  return `${SITE}/site/v2/sports/soccer/${LEAGUE}/scoreboard?dates=${TOURNAMENT_START}-${TOURNAMENT_END}&limit=500`;
}

export function standingsUrl() {
  return `${SITE}/v2/sports/soccer/${LEAGUE}/standings?season=${SEASON}`;
}

export const fetchScoreboard = () => getJson(scoreboardUrl());
export const fetchStandings = () => getJson(standingsUrl());

// --- time helpers (Europe/Oslo) -------------------------------------------

const OSLO = "Europe/Oslo";

export function osloParts(isoUtc) {
  const d = new Date(isoUtc);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: OSLO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // YYYY-MM-DD
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: OSLO,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d); // HH:MM
  const weekday = new Intl.DateTimeFormat("nb-NO", {
    timeZone: OSLO,
    weekday: "long",
  }).format(d);
  return { osloDate: date, osloTime: time, osloWeekday: weekday };
}
