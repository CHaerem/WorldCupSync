// VM 2026 — follow & catch up on the World Cup.
// Spoiler rule: results (scores, standings, scorers, bracket winners) are HIDDEN by
// default; revealed per-match or via global spoiler mode. Fixtures, times, replay
// links and the bracket *structure* are always safe to show.

const MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
const WD = ["søn","man","tir","ons","tor","fre","lør"];
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("wc26:" + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem("wc26:" + k, JSON.stringify(v)); },
};
const state = {
  matches: [], groups: [], stats: null,
  view: "schedule", scope: "week",
  spoiler: LS.get("spoiler", false),
  revealed: new Set(LS.get("revealed", [])),
  watched: new Set(LS.get("watched", [])),
  plan: new Set(LS.get("plan", [])),
};
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
const isRevealed = (m) => state.spoiler || state.revealed.has(m.id);
const isNO = (m) => m.home?.name === "Norway" || m.away?.name === "Norway";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ROUND = { "group-stage": "Gruppespill","round-of-32":"16-delsfinale","round-of-16":"8-delsfinale",quarterfinals:"Kvartfinale",semifinals:"Semifinale","3rd-place-match":"Bronsefinale",final:"Finale" };
const roundName = (n) => ROUND[n] || "Kamp";
const isPH = (n) => /winner|loser|place|group [a-l]\b|quarterfinal|semifinal|round of/i.test(n || "");
const short = (n) => isPH(n) ? String(n).replace(/Third Place/i,"3.pl").replace(/2nd Place/i,"2.pl").replace(/Group /i,"gr.").replace(/Round of 32/i,"16-del").replace(/Quarterfinal/i,"KF").replace(/Semifinal/i,"SF").replace(/Winner/i,"vinner").replace(/Loser/i,"taper").trim() : n;
const fmtDay = (iso) => { const [, mo, d] = iso.split("-").map(Number); const wd = new Date(iso + "T12:00:00Z").getUTCDay(); return { wd: WD[wd], d, label: `${["Søndag","Mandag","Tirsdag","Onsdag","Torsdag","Fredag","Lørdag"][wd]} ${d}. ${MONTHS[mo - 1]}` }; };

function primaryLinks(m) {
  const q = encodeURIComponent(`${m.home?.name || ""} ${m.away?.name || ""}`.trim());
  const s = m.streams || {}; const out = [];
  if (s.nrk) out.push({ cls: "nrk", label: "NRK TV", href: s.nrk, ico: "▶" });
  else if (m.nrkFree) out.push({ cls: "ghost", label: "Søk NRK", href: `https://tv.nrk.no/sok?q=${q}`, ico: "🔎" });
  if (s.tv2) out.push({ cls: "tv2", label: "TV 2 Play", href: s.tv2, ico: "▶" });
  else if (!m.nrkFree || !s.nrk) out.push({ cls: "ghost", label: "Søk TV 2", href: `https://play.tv2.no/sok?q=${q}`, ico: "🔎" });
  return out;
}

// ---------- match row ----------
function matchRow(m) {
  const live = m.state === "in", post = m.completed, reveal = isRevealed(m);
  const onPlan = state.plan.has(m.id), watched = state.watched.has(m.id);
  const mid = (post || live)
    ? (reveal ? `<span class="sc">${m.home?.score ?? "-"}–${m.away?.score ?? "-"}</span>` : `<span class="sc hide" data-reveal="${m.id}" title="Vis resultat">–&nbsp;–</span>`)
    : `<span class="tm">${m.osloTime}</span>`;
  const links = (post || live) ? primaryLinks(m).map((l) => `<a class="pill ${l.cls}" href="${l.href}" target="_blank" rel="noopener">${l.ico} ${l.label}</a>`).join("") : "";
  const metaLeft = [
    live ? `<span class="live"></span> spilles nå` : (post ? m.osloTime : null),
    m.group || roundName(m.roundNote), m.venue,
  ].filter(Boolean).join(' <span class="dot">·</span> ');
  return `<div class="m${isNO(m) ? " no" : ""}">
    <div class="m-row">
      <div class="side">${m.home?.logo ? `<img src="${m.home.logo}" alt="" loading="lazy"/>` : ""}<span class="nm">${esc(m.home?.name || "TBD")}</span></div>
      <div class="mid">${mid}</div>
      <div class="side away">${m.away?.logo ? `<img src="${m.away.logo}" alt="" loading="lazy"/>` : ""}<span class="nm">${esc(m.away?.name || "TBD")}</span></div>
    </div>
    <div class="m-meta"><span>${metaLeft}</span><span class="grow"></span>${links}
      ${post ? `<button class="watched ${watched ? "on" : ""}" data-watched="${m.id}">${watched ? "✓ sett" : "marker sett"}</button>` : ""}
      <button class="star ${onPlan ? "on" : ""}" data-plan="${m.id}" title="Min plan">${onPlan ? "★" : "☆"}</button>
    </div>
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
function dayHeader(iso, count) {
  const f = fmtDay(iso), rel = relLabel(iso);
  const lbl = rel ? `<b>${rel}</b> · ${f.label.toLowerCase()}` : f.label;
  return `<div class="day"><span class="dl">${lbl}</span><span class="dcount">${count} ${count === 1 ? "kamp" : "kamper"}</span></div>`;
}
function viewSchedule() {
  const today = todayOslo();
  let list, desc = false;
  if (state.scope === "played") { list = state.matches.filter((m) => m.completed); desc = true; }
  else if (state.scope === "all") { list = state.matches.slice(); }
  else { const from = shiftDate(today, -1), to = shiftDate(today, 7); list = state.matches.filter((m) => { const p = programDate(m); return p >= from && p <= to; }); }

  const seg = (k, l) => `<button class="${state.scope === k ? "on" : ""}" data-scope="${k}">${l}</button>`;
  const nav = `<div class="scopebar"><div class="seg">${seg("week", "Uke")}${seg("played", "Spilte")}${seg("all", "Alle")}</div></div>`;
  if (!list.length) return nav + `<div class="empty">Ingen kamper her.</div>`;

  const byDay = {}, order = [];
  for (const m of list) { const p = programDate(m); if (!byDay[p]) { byDay[p] = []; order.push(p); } byDay[p].push(m); }
  order.sort((a, b) => (desc ? b.localeCompare(a) : a.localeCompare(b)));

  const body = order.map((p) => {
    const ms = byDay[p].sort((a, b) => new Date(a.date) - new Date(b.date));
    let h = dayHeader(p, ms.length), night = false;
    for (const m of ms) {
      if (!night && parseInt(m.osloTime.slice(0, 2), 10) < 6) {
        const wd = WDFULL[new Date(m.osloDate + "T12:00:00Z").getUTCDay()];
        h += `<div class="night">🌙 natt til ${wd}</div>`;
        night = true;
      }
      h += matchRow(m);
    }
    return h;
  }).join("");
  return nav + body;
}

function viewPlan() {
  const planned = state.matches.filter((m) => state.plan.has(m.id)).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!planned.length) return `<div class="empty">Ingen kamper i planen ennå.<br/>Trykk ☆ på en kamp for å legge den til.</div>`;
  const queue = planned.filter((m) => m.completed && !state.watched.has(m.id));
  const rest = planned.filter((m) => !(m.completed && !state.watched.has(m.id)));
  let h = "";
  if (queue.length) h += `<div class="block"><h3>▶ Klar for reprise (${queue.length})</h3>${queue.map(matchRow).join("")}</div>`;
  if (rest.length) h += `<div class="block"><h3>Resten av planen</h3>${rest.map(matchRow).join("")}</div>`;
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
  const team = (x, post) => {
    const known = x?.name && !isPH(x.name);
    if (known) {
      const w = state.spoiler && post && x.winner ? " win" : "";
      return `<div class="t known${w}">${x.logo ? `<img src="${x.logo}" alt=""/>` : ""}<span class="nm">${esc(x.name)}</span>${state.spoiler && post && x.score != null ? `<span class="g">${x.score}</span>` : ""}</div>`;
    }
    const c = slotCandidates(x?.name, gmap);
    if (c) {
      const flags = c.teams.map((e, i) => `<img class="cf${state.spoiler && c.pos && i === c.pos - 1 ? " lead" : ""}" src="${e.logo}" title="${esc(e.team)}" alt=""/>`).join("");
      return `<div class="t cand"><span class="lbl">${esc(short(x?.name))}</span><span class="cfs">${flags}</span></div>`;
    }
    return `<div class="t"><span class="nm">${esc(short(x?.name) || "—")}</span></div>`;
  };
  const tie = (m, fin) => { const [, mo, d] = m.osloDate.split("-").map(Number); return `<div class="tie ${fin ? "final" : ""}">${team(m.home, m.completed)}${team(m.away, m.completed)}<div class="dt">${d}. ${MONTHS[mo - 1].slice(0, 3)} · ${m.osloTime}</div></div>`; };
  const third = state.matches.find((m) => m.roundNote === "3rd-place-match");
  let h = `<div class="bracket">${cols.map((c) => `<div class="round"><h4>${roundName(c.rn)}</h4>${c.ties.map((m) => tie(m, c.rn === "final")).join("")}</div>`).join("")}</div>`;
  if (third) h += `<div class="block"><h3>Bronsefinale</h3><div class="bracket"><div class="round" style="width:200px">${tie(third, false)}</div></div></div>`;
  return h;
}

function viewStats() {
  if (!state.spoiler) return `<div class="veil">📊 Statistikk røper resultater, tabeller og hvem som leder.<br/><button class="pill" id="revealStats">Vis statistikk likevel</button></div>`;
  let h = ""; const s = state.stats;
  if (s) {
    h += `<div class="statline"><div><div class="n">${s.matchesPlayed}</div><div class="k">kamper spilt</div></div><div><div class="n">${s.totalGoals}</div><div class="k">mål</div></div><div><div class="n">${s.avgGoals}</div><div class="k">snitt/kamp</div></div></div>`;
    if (s.topScorers?.length) h += `<div class="block"><h3>Toppscorere</h3><table><thead><tr><th class="l">Spiller</th><th>Mål</th><th>Mål.gi.</th></tr></thead><tbody>${s.topScorers.slice(0, 20).map((r, i) => `<tr><td class="l team">${r.teamLogo ? `<img src="${r.teamLogo}" alt=""/>` : ""}<span><span class="rk">${i + 1}</span>${esc(r.name)}</span></td><td class="pts">${r.goals}</td><td>${r.assists || ""}</td></tr>`).join("")}</tbody></table></div>`;
  }
  h += state.groups.length ? state.groups.map((g) => `<div class="block"><h3>${esc(g.name)}</h3><table><thead><tr><th class="l">Lag</th><th>K</th><th>S</th><th>U</th><th>T</th><th>MF</th><th>P</th></tr></thead><tbody>${g.entries.map((e, i) => `<tr class="${i < 2 ? "adv" : ""}"><td class="l team">${e.logo ? `<img src="${e.logo}" alt=""/>` : ""}${esc(e.team)}</td><td>${e.played ?? 0}</td><td>${e.wins ?? 0}</td><td>${e.ties ?? 0}</td><td>${e.losses ?? 0}</td><td>${e.gd ?? 0}</td><td class="pts">${e.points ?? 0}</td></tr>`).join("")}</tbody></table></div>`).join("") : `<div class="empty">Tabeller ikke tilgjengelig ennå.</div>`;
  return h;
}

function render() {
  const btn = document.getElementById("spoilerToggle");
  btn.classList.toggle("on", state.spoiler);
  btn.innerHTML = state.spoiler ? '👀 <span id="modeLabel">Spoiler på</span>' : '🙈 <span id="modeLabel">Spoilerfri</span>';
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  const body = { schedule: viewSchedule, bracket: viewBracket, stats: viewStats, plan: viewPlan }[state.view]();
  app.innerHTML = body;
}

// ---------- events ----------
document.getElementById("spoilerToggle").addEventListener("click", () => { state.spoiler = !state.spoiler; LS.set("spoiler", state.spoiler); render(); });
document.getElementById("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (!b) return; state.view = b.dataset.view; render(); });
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-reveal],[data-plan],[data-watched],[data-scope],#revealStats");
  if (!t) return;
  if (t.dataset.scope) { state.scope = t.dataset.scope; render(); return; }
  if (t.id === "revealStats") { state.spoiler = true; LS.set("spoiler", true); render(); return; }
  if (t.dataset.reveal) { state.revealed.add(t.dataset.reveal); LS.set("revealed", [...state.revealed]); render(); return; }
  if (t.dataset.plan) { toggle(state.plan, t.dataset.plan, "plan"); render(); return; }
  if (t.dataset.watched) { toggle(state.watched, t.dataset.watched, "watched"); state.revealed.add(t.dataset.watched); LS.set("revealed", [...state.revealed]); render(); }
});
function toggle(set, id, key) { set.has(id) ? set.delete(id) : set.add(id); LS.set(key, [...set]); }

load();
