// Resolve per-match replay deep links on NRK TV / TV 2 Play.
//
// Norwegian broadcasters expose no clean API for "match X replay URL", so this
// uses the Claude CLI + web search (the same zero-infra discovery pattern as the
// rest of the stack) to look up VOD links for recently completed matches and
// write them into docs/data/streams.json, keyed by ESPN match id.
//
// Runs in CI when CLAUDE_CODE_OAUTH_TOKEN (Max subscription) is present. Without
// it, the script no-ops cleanly and the frontend falls back to broadcaster search
// links — so the site degrades gracefully and never breaks the data pipeline.

import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "docs", "data");

const MAX_PER_RUN = 8; // bound LLM cost
const LOOKBACK_HOURS = 72; // only chase links for recently finished matches

function hasAuth() {
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

function pickCandidates(matches, streams) {
  const now = Date.now();
  return matches
    .filter((m) => m.completed)
    .filter((m) => now - new Date(m.date).getTime() < LOOKBACK_HOURS * 3600e3)
    .filter((m) => !streams[m.id] || (!streams[m.id].nrk && !streams[m.id].tv2))
    .slice(0, MAX_PER_RUN);
}

function buildPrompt(candidates) {
  const rows = candidates
    .map((m) => `- id ${m.id}: ${m.home?.name} vs ${m.away?.name}, spilt ${m.osloDate} (${m.broadcaster}${m.nrkFree ? " gratis på NRK" : ""})`)
    .join("\n");
  return `Du skal finne direkte reprise-/VOD-lenker for fotball-VM 2026-kamper på norske strømmetjenester.

For hver kamp under, søk på nett og finn den mest spesifikke URL-en til kampreprisen:
- NRK TV: en tv.nrk.no-lenke til akkurat denne kampen (kun for kamper merket "gratis på NRK").
- TV 2 Play: en play.tv2.no-lenke til akkurat denne kampen.

Kamper:
${rows}

Returner KUN gyldig JSON, ingen tekst rundt, på formen:
{"<id>": {"nrk": "<url eller null>", "tv2": "<url eller null>"}}
Bruk null når du ikke finner en trygg, spesifikk lenke. Ikke gjett – en feil lenke er verre enn ingen.`;
}

function runClaude(prompt) {
  const sysFile = join(DATA, ".streams-sys.tmp");
  const userFile = join(DATA, ".streams-user.tmp");
  writeFileSync(sysFile, "You are a precise research assistant. You return only valid JSON. You never invent URLs.");
  writeFileSync(userFile, prompt);
  try {
    const model = process.env.WC_QUOTA_MODEL || "claude-sonnet-4-6";
    const cmd = `cat "${userFile}" | npx -y @anthropic-ai/claude-code@latest -p --system-prompt-file "${sysFile}" --model ${model} --output-format json --max-turns 8 --allowedTools "WebSearch" "WebFetch"`;
    const out = execSync(cmd, { encoding: "utf-8", timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    const envelope = JSON.parse(out);
    const text = envelope.result || envelope.content || "";
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } finally {
    try { unlinkSync(sysFile); } catch {}
    try { unlinkSync(userFile); } catch {}
  }
}

async function main() {
  const matchesDoc = await readJson(join(DATA, "matches.json"), { matches: [] });
  const streamsDoc = await readJson(join(DATA, "streams.json"), { streams: {} });
  const streams = streamsDoc.streams || {};

  const candidates = pickCandidates(matchesDoc.matches, streams);
  if (!candidates.length) {
    console.log("discover-streams: no candidates needing links");
    return;
  }
  if (!hasAuth()) {
    console.log(`discover-streams: ${candidates.length} candidates, but no Claude auth — skipping (frontend uses search fallback)`);
    return;
  }

  console.log(`discover-streams: resolving links for ${candidates.length} matches`);
  let resolved = {};
  try {
    resolved = runClaude(buildPrompt(candidates));
  } catch (e) {
    console.error("discover-streams: Claude lookup failed —", e.message);
    return; // non-fatal
  }

  let added = 0;
  for (const [id, links] of Object.entries(resolved)) {
    const clean = {};
    if (links?.nrk && /tv\.nrk\.no/.test(links.nrk)) clean.nrk = links.nrk;
    if (links?.tv2 && /(play\.tv2\.no|tv2\.no)/.test(links.tv2)) clean.tv2 = links.tv2;
    if (Object.keys(clean).length) {
      streams[id] = { ...(streams[id] || {}), ...clean };
      added++;
    }
  }

  await writeFile(
    join(DATA, "streams.json"),
    JSON.stringify({ _comment: streamsDoc._comment, updated: new Date().toISOString(), streams }, null, 2),
  );
  console.log(`discover-streams: added/updated links for ${added} matches`);
}

main().catch((e) => { console.error(e); process.exit(1); });
