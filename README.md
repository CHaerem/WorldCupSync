# VM 2026 — følg & ta igjen fotball-VM 🇳🇴⚽

A tiny static site for following the 2026 FIFA World Cup from Norway — and **catching up without getting spoiled**. Most matches kick off in the middle of the night Oslo time, so the point is to scan the week, plan what to watch on replay the next day, and jump straight to the right stream on **NRK TV** or **TV 2 Play**.

## What it does

- **Spoiler-free by default.** Scores, group tables, scorers and bracket winners are hidden until you reveal them (per match) or flip global *Spoilermodus* ("catch up" mode).
- **Kamper** — a scannable, continuous week view: one compact line per match (time · teams · gated score · one replay link). Grouped by day with **I går / I dag / I morgen** headers, auto-scrolled to today. Matches that kick off after midnight Oslo are grouped with the previous evening under a **🌙 natt til …** divider, so a night's programme stays together. Star a match into *Min plan*.
- **Sluttspill** — a knockout bracket that shows **which countries could land in each slot** (the group's teams as candidate flags); in spoiler mode the current projection is highlighted. Spoiler-safe structure, fills in as groups resolve.
- **Statistikk** — top scorers, tournament totals and group tables (spoiler-gated).
- **Min plan** — your starred matches, with a "Klar for reprise" queue and a *marker sett* toggle.
- **Norway focus** — Norway's matches are highlighted in the list.
- **Design** — follows the official 2026 visual identity: black/white high-contrast, a geometric "26" mark, Noto Sans (FIFA's secondary typeface), one bold accent. All times Oslo, all text Norwegian, light & dark.

## Zero infrastructure

Runs on exactly three things — no backend, no database, no paid APIs, **no LLM**:

| Concern | How |
|---|---|
| **Hosting** | GitHub Pages, served from `/docs` |
| **Data** | ESPN public API (`fifa.world`), no key — fixtures, scores, group tables |
| **Top scorers** | computed from each finished match's ESPN summary → `docs/data/stats.json` |
| **NRK replay links** | NRK public catalog API → `docs/data/streams.json` (deterministic) |
| **TV 2 replay links** | one-off local capture from a logged-in session (TV 2 is paywalled) |

### Data flow

```
ESPN API ──► scripts/build.js ──────► docs/data/{matches,standings,meta}.json
                 ▲      ▲                       │
                 │      │                       └─ joins group + broadcaster + replay links
 NRK catalog ────┘      └── scripts/fetch-stats.js ──► docs/data/stats.json (top scorers)
 scripts/fetch-streams.js ──► docs/data/streams.json (NRK links, by kickoff time)
 scripts/config/tv2-streams.json ──► committed TV 2 links (captured locally)
```

The pipeline fetches **everything** (including results); the frontend (`docs/js/app.js`) is solely responsible for spoiler-gating. The data is always complete; the UI decides what's safe to show.

## Local dev

```bash
npm run build          # fetch matches + standings from ESPN
npm run fetch:streams  # resolve NRK replay links from the catalog
npm run fetch:stats    # aggregate top scorers from finished matches
npm run dev            # serve docs/ on http://localhost:8000
```

## Deploy

1. Push to GitHub.
2. **Settings → Pages** → *Deploy from a branch* → `main` / `/docs`.

No secrets, no tokens. The **Update World Cup data** workflow runs every 2 hours: build → resolve NRK links → rebuild → aggregate stats → commit. Edits to `docs/data` auto-deploy via Pages. `index.html` loads `app.js` with a cache-busting version tied to the latest data build, so a fresh deploy is never masked by a stale cached script.

## Stream links

TV 2 holds all 104 matches; NRK shows 51 free-to-air.

- **NRK matches** — fully automatic. `scripts/fetch-streams.js` reads NRK's public catalog (`psapi.nrk.no`), matches each episode to its ESPN fixture by kickoff time, and writes the exact replay URL. The free-match list in `scripts/config/broadcasters.json` is **auto-derived** from the catalog — no manual upkeep.
- **TV 2 matches** — TV 2 Play is authenticated/paywalled with no open catalog, so it **can't run in CI**. `scripts/local/capture-tv2.mjs` drives a logged-in browser (Playwright over CDP), harvests the match VOD links, maps them to fixtures, and writes `scripts/config/tv2-streams.json` (committed). Re-run occasionally as new matches get pages. Matches without a captured link fall back to a TV 2 Play search.
```bash
# launch a logged-in Chromium with a debug port, log into TV 2 Play, then:
node scripts/local/capture-tv2.mjs   # see the file header for the full setup
```
