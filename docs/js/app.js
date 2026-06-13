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
  view: "schedule", scope: "upcoming", day: null,
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

// ---------- schedule with day navigator ----------
function dayMeta() {
  const map = {};
  for (const m of state.matches) (map[m.osloDate] ||= []).push(m);
  const today = todayOslo();
  return Object.keys(map).sort().map((date) => {
    const ms = map[date];
    return { date, ms, count: ms.length, anyPlayed: ms.some((x) => x.completed), allPlayed: ms.every((x) => x.completed), hasNO: ms.some(isNO), isToday: date === today, isPast: date < today };
  });
}
function scopeDays(days) {
  const today = todayOslo();
  if (state.scope === "upcoming") return days.filter((d) => d.date >= today);
  if (state.scope === "played") return days.filter((d) => d.date < today || (d.date === today && d.anyPlayed));
  return days;
}

function viewSchedule() {
  const all = dayMeta();
  let days = scopeDays(all);
  if (!days.length) days = all;
  // pick a sensible selected day for the current scope
  if (!state.day || !days.some((d) => d.date === state.day)) {
    state.day = state.scope === "played" ? days[days.length - 1]?.date : (days.find((d) => d.isToday) || days[0])?.date;
  }
  const idx = days.findIndex((d) => d.date === state.day);
  const sel = days[idx];
  const seg = (k, l) => `<button class="${state.scope === k ? "on" : ""}" data-scope="${k}">${l}</button>`;
  const rail = days.map((d) => {
    const f = fmtDay(d.date);
    const cls = ["dchip", d.date === state.day ? "sel" : "", d.isToday ? "today" : "", d.isPast && d.allPlayed ? "played" : ""].filter(Boolean).join(" ");
    return `<button class="${cls}" data-day="${d.date}">${d.hasNO ? '<span class="nob"></span>' : ""}<div class="wd">${d.isToday ? "i dag" : f.wd}</div><div class="dd">${f.d}</div><div class="cnt">${d.count} k</div></button>`;
  }).join("");
  const nav = `<div class="daynav">
      <button class="arw" data-step="-1" ${idx <= 0 ? "disabled" : ""}>‹</button>
      <button class="arw" data-step="1" ${idx >= days.length - 1 ? "disabled" : ""}>›</button>
      <div class="seg">${seg("upcoming", "Kommende")}${seg("played", "Spilte")}${seg("all", "Alle")}</div>
    </div>
    <div class="rail">${rail}</div>`;
  if (!sel) return nav + `<div class="empty">Ingen kamper.</div>`;
  const played = sel.ms.filter((m) => m.completed).length, up = sel.count - played;
  const sum = `<div class="daysum">${fmtDay(sel.date).label} — <b>${sel.count} kamper</b>${played ? ` · ${played} spilt` : ""}${up ? ` · ${up} kommende` : ""}</div>`;
  const rows = sel.ms.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).map(matchRow).join("");
  return nav + sum + rows;
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
  if (state.view === "schedule") { const c = app.querySelector(".dchip.sel"); if (c) c.scrollIntoView({ inline: "center", block: "nearest" }); }
}

// ---------- events ----------
document.getElementById("spoilerToggle").addEventListener("click", () => { state.spoiler = !state.spoiler; LS.set("spoiler", state.spoiler); render(); });
document.getElementById("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (!b) return; state.view = b.dataset.view; render(); });
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-reveal],[data-plan],[data-watched],[data-scope],[data-day],[data-step],#revealStats");
  if (!t) return;
  if (t.dataset.scope) { state.scope = t.dataset.scope; state.day = null; render(); return; }
  if (t.dataset.day) { state.day = t.dataset.day; render(); return; }
  if (t.dataset.step) {
    const days = scopeDays(dayMeta()); const i = days.findIndex((d) => d.date === state.day) + Number(t.dataset.step);
    if (days[i]) { state.day = days[i].date; render(); } return;
  }
  if (t.id === "revealStats") { state.spoiler = true; LS.set("spoiler", true); render(); return; }
  if (t.dataset.reveal) { state.revealed.add(t.dataset.reveal); LS.set("revealed", [...state.revealed]); render(); return; }
  if (t.dataset.plan) { toggle(state.plan, t.dataset.plan, "plan"); render(); return; }
  if (t.dataset.watched) { toggle(state.watched, t.dataset.watched, "watched"); state.revealed.add(t.dataset.watched); LS.set("revealed", [...state.revealed]); render(); }
});
function toggle(set, id, key) { set.has(id) ? set.delete(id) : set.add(id); LS.set(key, [...set]); }

load();
