// TV 2 slug resolver tests (network-free — fixture URLs are injected).
// Locks in the matching layers: group stage by team name, round of 32 by FIFA
// group slot, and the deliberate skip of round-of-16+ chained-feeder slugs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTv2Links } from "../scripts/lib/tv2.js";

const base = "https://play.tv2.no/sport/fotball/fifa-fotball-vm-xx2qwthv";

const MATCHES = [
  // group stage — team names in the slug
  { id: "g1", roundNote: "group-stage", home: { name: "Iraq", abbr: "" }, away: { name: "Norway", abbr: "" } },
  { id: "g2", roundNote: "group-stage", home: { name: "New Zealand", abbr: "" }, away: { name: "Belgium", abbr: "" } },
  // round of 32 — FIFA group slots in the slug
  { id: "k1", roundNote: "round-of-32", home: { name: "Group C Winner", abbr: "1C" }, away: { name: "Group F 2nd Place", abbr: "2F" } },
  { id: "k2", roundNote: "round-of-32", home: { name: "Group A Winner", abbr: "1A" }, away: { name: "Third Place Group C/E/F/H/I", abbr: "3RD" } },
  // round of 16 — must NOT be resolved (chained feeders, provisional placeholders)
  { id: "r16", roundNote: "round-of-16", home: { name: "Round of 32 1 Winner", abbr: "RD32" }, away: { name: "Round of 32 3 Winner", abbr: "RD32" } },
];

const URLS = [
  `${base}/irak-norge-190xshna`,
  `${base}/new-zealand-belgia-aa11bb22`,
  `${base}/1c-2f-nez3he0v`,
  `${base}/1a-3cefhi-jxsna16s`,
  `${base}/1c-2f-2e-2i-5zjc9f2t`, // R16 — should be skipped
];

test("TV 2 resolver links group stage by team name and R32 by group slot, skips R16+", async () => {
  const { byMatchId, counts } = await resolveTv2Links(MATCHES, URLS);
  assert.equal(byMatchId.g1, `${base}/irak-norge-190xshna`, "Iraq–Norway group match");
  assert.equal(byMatchId.g2, `${base}/new-zealand-belgia-aa11bb22`, "multi-word team name splits correctly");
  assert.equal(byMatchId.k1, `${base}/1c-2f-nez3he0v`, "R32 1C/2F by both concrete slots");
  assert.equal(byMatchId.k2, `${base}/1a-3cefhi-jxsna16s`, "R32 keyed off the concrete slot, ignoring the 3rd-place combo");
  assert.equal(byMatchId.r16, undefined, "R16 chained-feeder slug must not produce a (possibly wrong) link");
  assert.equal(counts.group, 2);
  assert.equal(counts.r32, 2);
  assert.equal(counts.knockoutSkipped, 1);
});

test("TV 2 resolver ignores unknown fixtures without throwing", async () => {
  const { tv2MatchIds } = await resolveTv2Links(MATCHES, [`${base}/atlantis-eldorado-00000000`]);
  assert.deepEqual(tv2MatchIds, [], "an unmatchable slug links nothing");
});
