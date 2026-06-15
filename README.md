# WorldCupSync — follow & catch up on the 2026 FIFA World Cup 🇳🇴⚽

**▶ Live: [chaerem.github.io/WorldCupSync](https://chaerem.github.io/WorldCupSync/)**

A tiny static site for following the 2026 FIFA World Cup from Norway — and **catching up without getting spoiled**. Most matches kick off in the middle of the night Oslo time, so the point is to scan the week, plan what to watch on replay the next day, and jump straight to the right stream on **NRK TV** or **TV 2 Play**.

> The UI is in Norwegian (its audience). The four tabs are **Kamper** (Matches), **Sluttspill** (Knockout), **Statistikk** (Stats) and **Min plan** (My plan). All times are Oslo time.

## What it does

- **Automatic spoiler protection — no toggle to manage.** The real pain is opening the app the morning after and being spoiled by last night's matches. So a finished result (score, bracket winner) stays hidden only while it's *fresh* — today, overnight and yesterday's programme. Anything 2+ programme-days old auto-reveals (you've moved on). A match you starred but haven't marked watched stays hidden at any age. You can always tap a single hidden result to reveal just that match. Fixtures, kickoff times, replay links and the bracket *structure* are always shown.
- **Matches** — a scannable, continuous week view: one compact line per match (time · teams · gated score · one replay link). Grouped by day with **Yesterday / Today / Tomorrow** headers, auto-scrolled to today. Matches that kick off after midnight Oslo are grouped with the previous evening under a **🌙 "natt til …"** (overnight) divider, so a night's programme stays together. Last night's still-hidden matches — the ones ready to watch on replay — are highlighted with an accent band and a "▶" time; live matches show "Nå" (now); older, already-revealed matches fade back as history. Each day header splits the count (e.g. *2 reprise · 3 kommer* — 2 ready to replay, 3 upcoming). Star a match into *My plan*.
- **Knockout** — a bracket that shows **which countries could land in each slot** (the group's teams as candidate flags). Each tie reveals its result on the same automatic basis as the match list. Spoiler-safe structure, fills in as groups resolve.
- **Stats** — top scorers, tournament totals and group tables. As an aggregate spoiler it's revealed with one tap per visit (not persisted).
- **My plan** — your starred matches, with a "ready to watch" queue and a *mark watched* toggle.
- **Norway focus** — Norway's matches are highlighted in the list.
- **Design** — Apple **Liquid Glass**: a translucent, refractive chrome layer (the floating bottom tab bar bends the backdrop through an SVG edge-lens in Chrome/Edge, with a clear-glass frost fallback in Safari), beveled specular edges, a pointer-reactive gleam and a drifting modern-hue aurora. Built on the system font (SF), iOS-style inset-grouped day cards and a large in-content title. Light & dark.

## Zero infrastructure

Runs on exactly three things — no backend, no database, no paid APIs, **no LLM**:

| Concern | How |
|---|---|
| **Hosting** | GitHub Pages, served from `/docs` |
| **Data** | ESPN public API (`fifa.world`), no key — fixtures, scores, group tables |
| **Top scorers** | computed from each finished match's ESPN summary → `docs/data/stats.json` |
| **NRK replay links** | NRK public catalog API → `docs/data/streams.json` (deterministic) |
| **TV 2 replay links** | TV 2 public sitemaps → matched by slug → `docs/data/streams.json` (deterministic) |

### Data flow

```
ESPN API ──► scripts/build.js ──────► docs/data/{matches,standings,meta}.json
                 ▲      ▲                       │
                 │      │                       └─ joins group + broadcaster + replay links
 NRK catalog ────┘      └── scripts/fetch-stats.js ──► docs/data/stats.json (top scorers)
 scripts/fetch-streams.js ──► docs/data/streams.json (NRK + TV 2 links, deterministic)
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

No secrets, no tokens. The **Update World Cup data** workflow runs every 2 hours: build → resolve NRK + TV 2 links → rebuild → aggregate stats → commit. Edits to `docs/data` auto-deploy via Pages. `index.html` loads `app.js` with a cache-busting version tied to the latest data build, so a fresh deploy is never masked by a stale cached script.

## Stream links

TV 2 holds all 104 matches; NRK shows 51 free-to-air. **Both run fully automatically in CI** — no logins, no manual capture. `scripts/fetch-streams.js` resolves both and writes the exact URLs to `docs/data/streams.json`.

- **NRK** (`scripts/lib/nrk.js`) — reads NRK's public catalog (`psapi.nrk.no`) and matches each episode to its ESPN fixture by kickoff time. The free-match list in `scripts/config/broadcasters.json` is **auto-derived** from the catalog. NRK publishes its catalog ~2 weeks ahead.
- **TV 2** (`scripts/lib/tv2.js`) — TV 2's JSON API needs a login, but its public XML **sitemaps** list every fixture page. We harvest those and match by parsing the slug: group-stage pages carry team names (`irak-norge`), round-of-32 pages carry FIFA group slots (`1c-2f`, `1a-3cefhi`) that line up with our fixtures' `home.abbr`/`away.abbr`.
- **TV 2 summaries** (`resolveTv2Summaries`) — a short highlights clip per played match, from TV 2's "kampoppsummering" series. The episode URLs are only numbered, but each series-sitemap entry carries a `<video:title>` (`Oppsummering: Ghana - Panama`) we parse for the teams. Surfaced as a **Sammendrag** button in a match's detail sheet once it's played. (NRK publishes no per-match summaries.)

Both resolvers fill in as the broadcasters publish more pages, so coverage grows on each 2-hourly run. Matches without a resolved link fall back in the app to the broadcaster's **World Cup hub page** (where the match will appear), never a broken search.

**Round of 16 and later are deliberately left to the hub fallback.** TV 2's deeper-round slugs chain feeder group-slots (`1c-2f-2e-2i`) while ESPN references feeder *match numbers*, and the provisional third-place assignments differ between the two providers — so a derived knockout link would sometimes point at the wrong match. Round of 32 is safe because it keys on a concrete group slot that uniquely identifies the fixture.
