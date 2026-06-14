// VM 2026 — follow & catch up on the World Cup.
// Spoilers are gated AUTOMATICALLY — there is no global on/off mode. The real pain
// is opening the app the morning after and being spoiled by *last night's* matches,
// so a finished match's result (score, bracket winner) stays hidden only while it's
// still fresh — today's + overnight + yesterday's programme. Anything from 2+
// programme-days ago auto-reveals (you've moved on). A match you starred but haven't
// marked watched stays hidden regardless of age — you still plan to see it. You can
// always tap a single hidden result to reveal just that match. Fixtures, times,
// replay links and the bracket *structure* are always safe to show. Statistikk is an
// aggregate spoiler, so it's revealed with one tap per visit (not persisted).

const MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
const WD = ["søn","man","tir","ons","tor","fre","lør"];
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("wc26:" + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem("wc26:" + k, JSON.stringify(v)); },
};
const state = {
  matches: [], groups: [], stats: null,
  view: "schedule",
  reveal: LS.get("reveal", {}), // per-match override: id -> true(show)/false(hide); absent = automatic. Always reversible.
  watched: new Set(LS.get("watched", [])),
  plan: new Set(LS.get("plan", [])),
  statsShown: false, // session-only: stats are aggregate spoilers, revealed per visit
};
// migrate the legacy permanent "revealed" array (pre-toggle model) into overrides
{
  const legacy = LS.get("revealed", null);
  if (Array.isArray(legacy)) { legacy.forEach((id) => (state.reveal[id] = true)); LS.set("reveal", state.reveal); localStorage.removeItem("wc26:revealed"); }
}
const peeking = new Set(); // in-memory only — hold-to-peek never persists
const app = document.getElementById("app");
const todayOslo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());

async function load() {
  try {
    const [m, s, st] = await Promise.all([
      fetch("data/matches.json").then((r) => r.json()),
      fetch("data/standings.json").then((r) => r.json()).catch(() => ({ groups: [] })),
      fetch("data/stats.json").then((r) => r.json()).catch(() => null),
    ]);
    state.matches = m.matches || []; state.groups = s.groups || []; state.stats = st;
    render();
  } catch (e) {
    app.innerHTML = `<div class="empty">Kunne ikke laste data.<br/><small>${e.message}</small></div>`;
  }
}

// ---------- helpers ----------
// A finished match is "stale" once its programme day is GRACE_DAYS or more before
// today (Oslo): today=0, yesterday=1 stay hidden; 2+ days ago auto-reveals.
const GRACE_DAYS = 2;
const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
const planUnwatched = (m) => state.plan.has(m.id) && !state.watched.has(m.id);
const isStale = (m) => m.completed && dayDiff(todayOslo(), programDate(m)) >= GRACE_DAYS;
// No global spoiler mode. Automatic default: a stale result reveals itself (unless
// you've starred it to watch). An explicit per-match override always wins — and it's
// reversible, so an accidental reveal is never permanent.
const autoShown = (m) => isStale(m) && !planUnwatched(m);
const isRevealed = (m) => (m.id in state.reveal ? state.reveal[m.id] : autoShown(m));
const setReveal = (id, show) => { state.reveal[id] = show; LS.set("reveal", state.reveal); };
const isNO = (m) => m.home?.name === "Norway" || m.away?.name === "Norway";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- icons in the SF Symbols idiom (no emoji): one stroke weight, true
// silhouettes, rounded joins; fill only where SF uses a .fill variant ----------
const SVG = (inner, o = {}) => `<svg class="ic" viewBox="0 0 24 24" fill="${o.fill || "none"}" stroke="${o.stroke || "currentColor"}" stroke-width="${o.sw || 1.7}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  eye: SVG('<path d="M2.6 12C4.4 8.4 7.9 6.2 12 6.2s7.6 2.2 9.4 5.8c-1.8 3.6-5.3 5.8-9.4 5.8S4.4 15.6 2.6 12z"/><circle cx="12" cy="12" r="2.7"/>'),
  eyeOff: SVG('<path d="M2.6 12C4.1 9 6.6 6.9 9.7 6.4M21.4 12c-1.4 2.9-3.8 4.9-6.8 5.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M4 4l16 16"/>'),
  play: SVG('<path d="M7 5.2v13.6L18.8 12z"/>', { fill: "currentColor", stroke: "none" }),
  starOn: SVG('<path d="M12 3.2l2.6 5.8 6.3.6-4.7 4.2 1.3 6.2L12 17l-5.8 3.2 1.3-6.2-4.7-4.2 6.3-.6z"/>', { fill: "currentColor", stroke: "none" }),
  starOff: SVG('<path d="M12 3.2l2.6 5.8 6.3.6-4.7 4.2 1.3 6.2L12 17l-5.8 3.2 1.3-6.2-4.7-4.2 6.3-.6z"/>'),
  check: SVG('<path d="M4.5 12.5l4.7 4.7L19.5 6.4"/>', { sw: 1.9 }),
  moon: SVG('<path d="M20.6 14.4A8.6 8.6 0 0 1 9.6 3.4 8.6 8.6 0 1 0 20.6 14.4z"/>', { fill: "currentColor", stroke: "none" }),
  reset: SVG('<path d="M4 4.2v4.6h4.6"/><path d="M4.4 8.8A8 8 0 1 1 4 13.6"/>'),
  search: SVG('<circle cx="10.5" cy="10.5" r="6.6"/><path d="M20.5 20.5l-5.2-5.2"/>'),
  chart: SVG('<path d="M5 20.5V10.5M12 20.5V4.5M19 20.5v-7"/>', { sw: 1.9 }),
};
const ROUND = { "group-stage": "Gruppespill","round-of-32":"16-delsfinale","round-of-16":"8-delsfinale",quarterfinals:"Kvartfinale",semifinals:"Semifinale","3rd-place-match":"Bronsefinale",final:"Finale" };
const roundName = (n) => ROUND[n] || "Kamp";
const isPH = (n) => /winner|loser|place|group [a-l]\b|quarterfinal|semifinal|round of/i.test(n || "");
const short = (n) => isPH(n) ? String(n).replace(/Third Place/i,"3.pl").replace(/2nd Place/i,"2.pl").replace(/Group /i,"gr.").replace(/Round of 32/i,"16-del").replace(/Quarterfinal/i,"KF").replace(/Semifinal/i,"SF").replace(/Winner/i,"vinner").replace(/Loser/i,"taper").trim() : n;
const fmtDay = (iso) => { const [, mo, d] = iso.split("-").map(Number); const wd = new Date(iso + "T12:00:00Z").getUTCDay(); return { wd: WD[wd], d, label: `${["Søndag","Mandag","Tirsdag","Onsdag","Torsdag","Fredag","Lørdag"][wd]} ${d}. ${MONTHS[mo - 1]}` }; };

function primaryLinks(m) {
  const q = encodeURIComponent(`${m.home?.name || ""} ${m.away?.name || ""}`.trim());
  const s = m.streams || {}; const out = [];
  if (s.nrk) out.push({ cls: "nrk", label: "NRK TV", short: "NRK", href: s.nrk, ico: ICON.play });
  else if (m.nrkFree) out.push({ cls: "ghost", label: "Søk NRK", short: "NRK", href: `https://tv.nrk.no/sok?q=${q}`, ico: ICON.search });
  if (s.tv2) out.push({ cls: "tv2", label: "TV 2 Play", short: "TV 2", href: s.tv2, ico: ICON.play });
  else if (!m.nrkFree || !s.nrk) out.push({ cls: "ghost", label: "Søk TV 2", short: "TV 2", href: `https://play.tv2.no/sok?q=${q}`, ico: ICON.search });
  return out;
}

// ---------- match row (compact, one line — scannable week overview) ----------
function matchRow(m, opts = {}) {
  const live = m.state === "in", post = m.completed, reveal = isRevealed(m);
  const onPlan = state.plan.has(m.id), watched = state.watched.has(m.id);
  // A finished match still inside the catch-up window (hidden score = fresh, e.g.
  // last night's) is precisely a "natt-kamp klar for reprise" — flag it so it pops.
  // Older finished matches (auto-revealed) fade back as history.
  const repro = post && !live && !reveal;
  const status = live ? "m-live" : repro ? "m-rep" : post ? "m-done" : "m-up";
  const lt = live
    ? `<span class="live" title="spilles nå"></span><span class="when na">Nå</span>`
    : repro
      ? `<span class="when rep" title="Klar for reprise">${ICON.play}${m.osloTime}</span>`
      : `<span class="when">${m.osloTime}</span>`;
  const score = `${m.home?.score ?? "-"}–${m.away?.score ?? "-"}`;
  let md;
  if (!(post || live)) md = `<span class="md vs">–</span>`;
  else if (reveal) {
    // a revealed result — tap to hide again. Fresh ones (not old history) show a hide hint.
    const fresh = !isStale(m);
    md = `<button class="md shown" data-hide="${m.id}" title="Skjul resultat igjen">${score}${fresh ? `<span class="eyeoff">${ICON.eyeOff}</span>` : ""}</button>`;
  } else {
    // hidden — hold the eye to peek (transient); hold a little longer to lock it open
    md = `<button class="md peek" data-peek="${m.id}" title="Hold for å kikke · hold litt lenger for å låse"><span class="eye">${ICON.eye}</span><span class="sc">${score}</span></button>`;
  }
  let act = "";
  if (post || live) { const l = primaryLinks(m)[0]; if (l) act += `<a class="go ${l.cls}" href="${l.href}" target="_blank" rel="noopener" title="Se reprise — ${l.label}">${l.ico} ${l.short}</a>`; }
  if (opts.plan && post) act += `<button class="wch ${watched ? "on" : ""}" data-watched="${m.id}" title="Marker sett">${ICON.check}</button>`;
  act += `<button class="star ${onPlan ? "on" : ""}" data-plan="${m.id}" title="Min plan">${onPlan ? ICON.starOn : ICON.starOff}</button>`;
  return `<div class="m ${status}${isNO(m) ? " no" : ""}">
    <div class="lt">${lt}</div>
    <div class="teams">
      <span class="hh"><span class="nm">${esc(m.home?.name || "TBD")}</span>${m.home?.logo ? `<img src="${m.home.logo}" alt="" loading="lazy"/>` : ""}</span>
      ${md}
      <span class="aa">${m.away?.logo ? `<img src="${m.away.logo}" alt="" loading="lazy"/>` : ""}<span class="nm">${esc(m.away?.name || "TBD")}</span></span>
    </div>
    <div class="act">${act}</div>
  </div>`;
}

// ---------- schedule: continuous week view ----------
// Matches kicking off after midnight Oslo (00:00–05:59) belong to the PREVIOUS
// evening's programme ("natt til ..."), not the next calendar day — group by that
// programme day so a night's matches stay together with the evening's.
const WDFULL = ["søndag","mandag","tirsdag","onsdag","torsdag","fredag","lørdag"];
const shiftDate = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const programDate = (m) => (parseInt(m.osloTime.slice(0, 2), 10) < 6 ? shiftDate(m.osloDate, -1) : m.osloDate);
const relLabel = (iso) => { const t = todayOslo(); return iso === t ? "I dag" : iso === shiftDate(t, -1) ? "I går" : iso === shiftDate(t, 1) ? "I morgen" : null; };
function viewSchedule() {
  const today = todayOslo();
  const byDay = {}, order = [];
  for (const m of state.matches) { const p = programDate(m); if (!byDay[p]) { byDay[p] = []; order.push(p); } byDay[p].push(m); }
  order.sort();
  if (!order.length) return `<div class="empty">Ingen kamper.</div>`;
  // anchor the initial scroll on today's programme (or the next upcoming day)
  const anchor = order.find((p) => p >= today) || order[order.length - 1];

  // safety net: one tap to re-hide everything you've revealed (back to automatic)
  const hasManual = Object.values(state.reveal).some((v) => v === true);
  const resetBar = hasManual ? `<div class="resetbar"><button class="reset" id="resetReveals" title="Tilbake til automatisk – skjuler alt du har vist">${ICON.reset} Skjul resultatene jeg har vist</button></div>` : "";

  return resetBar + order.map((p) => {
    const ms = byDay[p].sort((a, b) => new Date(a.date) - new Date(b.date));
    const f = fmtDay(p), rel = relLabel(p);
    const lbl = rel ? `<b>${rel}</b> · ${f.label.toLowerCase()}` : f.label;
    let rows = "";
    let night = false;
    for (const m of ms) {
      if (!night && parseInt(m.osloTime.slice(0, 2), 10) < 6) {
        rows += `<div class="night">${ICON.moon} natt til ${WDFULL[new Date(m.osloDate + "T12:00:00Z").getUTCDay()]}</div>`;
        night = true;
      }
      rows += matchRow(m);
    }
    // count split makes "klar for reprise" vs "kommer" obvious at a glance
    let rep = 0, played = 0, up = 0, liveN = 0;
    for (const x of ms) {
      if (x.state === "in") liveN++;
      else if (x.completed) (isRevealed(x) ? played++ : rep++);
      else up++;
    }
    const cparts = [];
    if (liveN) cparts.push(`<b class="c-live">${liveN} direkte</b>`);
    if (rep) cparts.push(`<b class="c-rep">${rep} reprise</b>`);
    if (played) cparts.push(`<span>${played} spilt</span>`);
    if (up) cparts.push(`<span>${up} kommer</span>`);
    // iOS inset-grouped style: a muted section header above a rounded content card
    return `<div class="day-head"${p === anchor ? ' id="anchor"' : ""}><span class="dl">${lbl}</span><span class="dcount">${cparts.join(" · ")}</span></div><section class="card group">${rows}</section>`;
  }).join("");
}

function viewPlan() {
  const planned = state.matches.filter((m) => state.plan.has(m.id)).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!planned.length) return `<div class="empty">Ingen kamper i planen ennå.<br/>Trykk ${ICON.starOff} på en kamp for å legge den til.</div>`;
  const queue = planned.filter((m) => m.completed && !state.watched.has(m.id));
  const rest = planned.filter((m) => !(m.completed && !state.watched.has(m.id)));
  let h = "";
  if (queue.length) h += `<div class="block"><h3 class="h3ic">${ICON.play} Klar for reprise (${queue.length})</h3>${queue.map((m) => matchRow(m, { plan: true })).join("")}</div>`;
  if (rest.length) h += `<div class="block"><h3>Resten av planen</h3>${rest.map((m) => matchRow(m, { plan: true })).join("")}</div>`;
  return h;
}

// ---------- bracket with candidate countries ----------
function slotCandidates(name, gmap) {
  const mg = /Group ([A-L])\b/i.exec(name || "");
  if (!mg) return null;
  const g = gmap["Group " + mg[1].toUpperCase()];
  if (!g) return null;
  return { teams: g, pos: /2nd/i.test(name) ? 2 : /winner/i.test(name) ? 1 : 0 };
}
function viewBracket() {
  const order = ["round-of-32","round-of-16","quarterfinals","semifinals","final"];
  const cols = order.map((rn) => ({ rn, ties: state.matches.filter((m) => m.roundNote === rn).sort((a, b) => new Date(a.date) - new Date(b.date)) })).filter((c) => c.ties.length);
  if (!cols.length) return `<div class="empty">Sluttspillet er ikke satt opp ennå.</div>`;
  const gmap = {}; for (const g of state.groups) gmap[g.name] = g.entries;
  const team = (x, reveal) => {
    const known = x?.name && !isPH(x.name);
    if (known) {
      const w = reveal && x.winner ? " win" : "";
      return `<div class="t known${w}">${x.logo ? `<img src="${x.logo}" alt=""/>` : ""}<span class="nm">${esc(x.name)}</span>${reveal && x.score != null ? `<span class="g">${x.score}</span>` : ""}</div>`;
    }
    const c = slotCandidates(x?.name, gmap);
    if (c) {
      const flags = c.teams.map((e) => `<img class="cf" src="${e.logo}" title="${esc(e.team)}" alt=""/>`).join("");
      return `<div class="t cand"><span class="lbl">${esc(short(x?.name))}</span><span class="cfs">${flags}</span></div>`;
    }
    return `<div class="t"><span class="nm">${esc(short(x?.name) || "—")}</span></div>`;
  };
  const tie = (m, fin) => { const [, mo, d] = m.osloDate.split("-").map(Number); const r = isRevealed(m); return `<div class="tie ${fin ? "final" : ""}">${team(m.home, r)}${team(m.away, r)}<div class="dt">${d}. ${MONTHS[mo - 1].slice(0, 3)} · ${m.osloTime}</div></div>`; };
  const third = state.matches.find((m) => m.roundNote === "3rd-place-match");
  let h = `<div class="bracket">${cols.map((c) => `<div class="round"><h4>${roundName(c.rn)}</h4>${c.ties.map((m) => tie(m, c.rn === "final")).join("")}</div>`).join("")}</div>`;
  if (third) h += `<div class="block"><h3>Bronsefinale</h3><div class="bracket"><div class="round" style="width:200px">${tie(third, false)}</div></div></div>`;
  return h;
}

function viewStats() {
  if (!state.statsShown) return `<div class="veil"><span class="veilic">${ICON.chart}</span><br/>Statistikk røper resultater, tabeller og hvem som leder.<br/><button class="reveal-btn" id="revealStats">Vis statistikk</button></div>`;
  let h = ""; const s = state.stats;
  if (s) {
    h += `<div class="statline"><div><div class="n">${s.matchesPlayed}</div><div class="k">kamper spilt</div></div><div><div class="n">${s.totalGoals}</div><div class="k">mål</div></div><div><div class="n">${s.avgGoals}</div><div class="k">snitt/kamp</div></div></div>`;
    if (s.topScorers?.length) h += `<div class="block"><h3>Toppscorere</h3><table><thead><tr><th class="l">Spiller</th><th>Mål</th><th>Mål.gi.</th></tr></thead><tbody>${s.topScorers.slice(0, 20).map((r, i) => `<tr><td class="l team">${r.teamLogo ? `<img src="${r.teamLogo}" alt=""/>` : ""}<span><span class="rk">${i + 1}</span>${esc(r.name)}</span></td><td class="pts">${r.goals}</td><td>${r.assists || ""}</td></tr>`).join("")}</tbody></table></div>`;
  }
  h += state.groups.length ? state.groups.map((g) => `<div class="block"><h3>${esc(g.name)}</h3><table><thead><tr><th class="l">Lag</th><th>K</th><th>S</th><th>U</th><th>T</th><th>MF</th><th>P</th></tr></thead><tbody>${g.entries.map((e, i) => `<tr class="${i < 2 ? "adv" : ""}"><td class="l team">${e.logo ? `<img src="${e.logo}" alt=""/>` : ""}${esc(e.team)}</td><td>${e.played ?? 0}</td><td>${e.wins ?? 0}</td><td>${e.ties ?? 0}</td><td>${e.losses ?? 0}</td><td>${e.gd ?? 0}</td><td class="pts">${e.points ?? 0}</td></tr>`).join("")}</tbody></table></div>`).join("") : `<div class="empty">Tabeller ikke tilgjengelig ennå.</div>`;
  return h;
}

let didAnchor = false; // only auto-scroll to today once per visit to Kamper
function render() {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  const body = { schedule: viewSchedule, bracket: viewBracket, stats: viewStats, plan: viewPlan }[state.view]();
  app.innerHTML = body;
  if (state.view === "schedule" && !didAnchor) {
    const a = document.getElementById("anchor");
    if (a) { a.scrollIntoView({ block: "start" }); didAnchor = true; }
  }
}

// ---------- events ----------
document.getElementById("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (!b) return; state.view = b.dataset.view; didAnchor = false; render(); });
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-hide],[data-plan],[data-watched],#revealStats,#resetReveals");
  if (!t) return;
  if (t.id === "revealStats") { state.statsShown = true; render(); return; }
  if (t.id === "resetReveals") { for (const k in state.reveal) if (state.reveal[k]) delete state.reveal[k]; LS.set("reveal", state.reveal); render(); return; }
  if (t.dataset.hide) { setReveal(t.dataset.hide, false); render(); return; }              // tap a shown score → hide again
  if (t.dataset.plan) { toggle(state.plan, t.dataset.plan, "plan"); render(); return; }
  if (t.dataset.watched) { toggle(state.watched, t.dataset.watched, "watched"); setReveal(t.dataset.watched, state.watched.has(t.dataset.watched)); render(); } // marking watched reveals; un-marking re-hides
});
function toggle(set, id, key) { set.has(id) ? set.delete(id) : set.add(id); LS.set(key, [...set]); }

// ---------- hold-to-peek: the safe reveal ----------
// Press & hold the eye to see the score only while held; release and it hides again.
// Keep holding past LOCK_MS to lock it open (reversible). A stray tap can't reveal.
let peekEl = null, peekTimer = 0, peekArmed = false;
const LOCK_MS = 600;
function endPeek() {
  if (!peekEl) return;
  clearTimeout(peekTimer);
  const btn = peekEl, id = btn.dataset.peek;
  peekEl = null; peeking.delete(id);
  if (peekArmed) { setReveal(id, true); render(); }                    // held long enough → lock open
  else { btn.classList.remove("peeking", "lockready"); }               // brief peek → hide again
}
app.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".md.peek[data-peek]");
  if (!b) return;
  e.preventDefault(); // suppress text selection / long-press callout
  peekEl = b; peekArmed = false; peeking.add(b.dataset.peek);
  b.classList.add("peeking"); // CSS swaps the eye for the score while held
  peekTimer = setTimeout(() => { peekArmed = true; b.classList.add("lockready"); }, LOCK_MS);
});
addEventListener("pointerup", endPeek);
addEventListener("pointercancel", endPeek); // scrolling / gesture interruption → revert (stays hidden)

load();
