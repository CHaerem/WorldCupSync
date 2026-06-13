# VM 2026 — spoiler-free World Cup replay planner 🇳🇴⚽

A tiny static site for following the 2026 FIFA World Cup from Norway **without getting spoiled** — most matches kick off in the middle of the night Oslo time, so the point is to plan what to watch on replay the next day and jump straight to the right stream on **NRK TV** or **TV 2 Play**.

## What it does

- **Spoiler-free by default.** Scores, group tables, and outcomes are hidden until you explicitly reveal them (per match) or flip global *Spoilermodus*. Finished matches just show "▶ Klar for reprise".
- **Replay planner.** Star matches into *Min plan*; a "Klar for reprise" queue surfaces the ones you haven't watched yet. Mark them *Sett* as you go.
- **Direct stream links.** Each match links to its NRK TV / TV 2 Play replay (resolved by the discovery step), with a broadcaster search as fallback.
- **All times in Oslo time**, all text in Norwegian.
- **Group tables** (12 groups, 48-team format) and fixtures, gated behind the spoiler toggle.

## Zero infrastructure

Runs on exactly three things — no backend, no database, no paid APIs:

| Concern | How |
|---|---|
| **Hosting** | GitHub Pages, served from `/docs` |
| **Data** | ESPN public API (`fifa.world`), no key — fixtures, scores, group tables |
| **Replay links** | GitHub Actions + Claude CLI web search → `docs/data/streams.json` |

### Data flow

```
ESPN API ─► scripts/build.js ─► docs/data/{matches,standings,meta}.json
                  │
                  └─ joins group tags + broadcaster (config) + replay links (streams.json)

Claude CLI + web search ─► scripts/discover-streams.js ─► docs/data/streams.json
```

The pipeline fetches **everything** (including results); the frontend (`docs/js/app.js`) is solely responsible for spoiler-gating. Clean separation — the data is always complete, the UI decides what's safe to show.

## Local dev

```bash
npm run build        # fetch matches + standings from ESPN
npm run dev          # serve docs/ on http://localhost:8000
```

`npm run discover:streams` resolves replay links (needs `CLAUDE_CODE_OAUTH_TOKEN`; no-ops without it).

## Deploy

1. Push to GitHub.
2. **Settings → Pages** → *Deploy from a branch* → `main` / `/docs`.
3. Add repo secret **`CLAUDE_CODE_OAUTH_TOKEN`** (your Claude Code Max token) so the nightly job can resolve replay links. Without it the site still works — it falls back to broadcaster search links.

The **Update World Cup data** workflow runs every 2 hours: rebuild data → discover replay links → commit. Edits to `docs/data` auto-deploy via Pages.

## Broadcaster mapping

TV 2 holds all 104 matches; NRK shows 51 free-to-air. `scripts/config/broadcasters.json` lists the ESPN match ids that NRK carries free (`nrkFreeMatchIds`) — those get a free NRK option, everything else defaults to TV 2. The discovery step maintains this as the schedule is confirmed.
