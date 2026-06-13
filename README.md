# VM 2026 — spoiler-free World Cup replay planner 🇳🇴⚽

A tiny static site for following the 2026 FIFA World Cup from Norway **without getting spoiled** — most matches kick off in the middle of the night Oslo time, so the point is to plan what to watch on replay the next day and jump straight to the right stream on **NRK TV** or **TV 2 Play**.

## What it does

- **Spoiler-free by default.** Scores, group tables, and outcomes are hidden until you explicitly reveal them (per match) or flip global *Spoilermodus*. Finished matches just show "▶ Klar for reprise".
- **Replay planner.** Star matches into *Min plan*; a "Klar for reprise" queue surfaces the ones you haven't watched yet. Mark them *Sett* as you go.
- **Direct stream links.** NRK matches link straight to the exact replay (resolved from NRK's public catalog); TV 2 matches link into TV 2 Play.
- **All times in Oslo time**, all text in Norwegian.
- **Group tables** (12 groups, 48-team format) and fixtures, gated behind the spoiler toggle.

## Zero infrastructure

Runs on exactly three things — no backend, no database, no paid APIs:

| Concern | How |
|---|---|
| **Hosting** | GitHub Pages, served from `/docs` |
| **Data** | ESPN public API (`fifa.world`), no key — fixtures, scores, group tables |
| **Replay links** | NRK public catalog API → `docs/data/streams.json` (deterministic, no LLM) |

No AI/LLM is needed anywhere — fixtures and stats come from ESPN's open API, and NRK replay links come from NRK's open catalog API.

### Data flow

```
ESPN API ──► scripts/build.js ──► docs/data/{matches,standings,meta}.json
                  ▲                         │
                  │                         └─ joins group tags + broadcaster + replay links
NRK catalog API ──┴─► scripts/fetch-streams.js ──► docs/data/streams.json
                      (matches NRK episodes to ESPN fixtures by kickoff time)
```

The pipeline fetches **everything** (including results); the frontend (`docs/js/app.js`) is solely responsible for spoiler-gating. Clean separation — the data is always complete, the UI decides what's safe to show.

## Local dev

```bash
npm run build          # fetch matches + standings from ESPN
npm run fetch:streams  # resolve NRK replay links from the catalog
npm run dev            # serve docs/ on http://localhost:8000
```

## Deploy

1. Push to GitHub.
2. **Settings → Pages** → *Deploy from a branch* → `main` / `/docs`.

That's it — no secrets, no tokens. The **Update World Cup data** workflow runs every 2 hours: rebuild data → resolve NRK links → commit. Edits to `docs/data` auto-deploy via Pages.

## Broadcaster mapping & stream links

TV 2 holds all 104 matches; NRK shows 51 free-to-air.

- **NRK matches** — `scripts/fetch-streams.js` reads NRK's public catalog (`psapi.nrk.no`), matches each episode to its ESPN fixture by kickoff time, and writes the exact replay URL. The free-match list in `scripts/config/broadcasters.json` is **auto-derived** from the catalog — no manual upkeep.
- **TV 2 matches** — TV 2 Play is a paywalled, authenticated service with no open catalog, so these link into TV 2 Play (search / VM hub) where you're already logged in, rather than a resolved deep-link.
