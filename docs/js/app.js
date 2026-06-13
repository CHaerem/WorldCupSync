// VM 2026 — follow & catch up on the World Cup.
// Spoiler rule: results (scores, standings, scorers, bracket winners) are HIDDEN by
// default. The user reveals per-match or flips global spoiler mode ("catch up").
// Fixtures, times, replay links and the bracket *structure* are always safe to show.

const MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("wc26:" + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem("wc26:" + k, JSON.stringify(v)); },
};
const state = {
  matches: [], groups: [], stats: null,
  view: "schedule", filter: "upcoming",
  spoiler: LS.get("spoiler", false),
  revealed: new Set(LS.get("revealed", [])),
  watched: new Set(LS.get("watched", [])),
  plan: new Set(LS.get("plan", [])),
};
const app = document.getElementById("app");

// ---------- data ----------
async function load() {
  try {
    const [m, s, st] = await Promise.all([
      fetch("data/matches.json").then((r) => r.json()),
      fetch("data/standings.json").then((r) => r.json()).catch(() => ({ groups: [] })),
      fetch("data/stats.json").then((r) => r.json()).catch(() => null),
    ]);
    state.matches = m.matches || [];
    state.groups = s.groups || [];
    state.stats = st;
    render();
  } catch (e) {
    app.innerHTML = `<div class="empty">Kunne ikke laste data.<br/><small>${e.message}</small></div>`;
  }
}

// ---------- helpers ----------
const isRevealed = (m) => state.spoiler || state.revealed.has(m.id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dayLabel = (m) => {
  const [, mo, d] = m.osloDate.split("-").map(Number);
  const wd = m.osloWeekday.charAt(0).toUpperCase() + m.osloWeekday.slice(1);
  return `${wd} ${d}. ${MONTHS[mo - 1]}`;
};
const ROUND = {
  "group-stage": "Gruppespill", "round-of-32": "16-delsfinale", "round-of-16": "8-delsfinale",
  "quarterfinals": "Kvartfinale", "semifinals": "Semifinale", "3rd-place-match": "Bronsefinale", "final": "Finale",
};
const roundName = (n) => ROUND[n] || "Kamp";
const isPlaceholder = (n) => /winner|loser|place|group [a-l]\b|quarterfinal|semifinal|round of/i.test(n || "");
const shortName = (n) => isPlaceholder(n)
  ? String(n).replace(/Third Place/i, "3.plass").replace(/2nd Place/i, "2.-plass").replace(/Group /i, "gr. ")
     .replace(/Round of 32/i, "16-del").replace(/Quarterfinal/i, "KF").replace(/Semifinal/i, "SF")
     .replace(/Winner/i, "vinner").replace(/Loser/i, "taper").trim()
  : n;

function replayLinks(m) {
  const q = encodeURIComponent(`${m.home?.name || ""} ${m.away?.name || ""}`.trim());
  const s = m.streams || {};
  const out = [];
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

  let mid;
  if (post || live) {
    mid = reveal
      ? `<span class="sc">${m.home?.score ?? "-"}–${m.away?.score ?? "-"}</span>`
      : `<span class="sc hide" data-reveal="${m.id}" title="Vis resultat">–&nbsp;–</span>`;
  } else {
    mid = `<span class="tm">${m.osloTime}</span>`;
  }

  const links = (post || live)
    ? replayLinks(m).map((l) => `<a class="pill ${l.cls}" href="${l.href}" target="_blank" rel="noopener">${l.ico} ${l.label}</a>`).join("")
    : "";
  const metaLeft = [
    // mid already shows the kickoff time for upcoming matches — only add a time/status
    // here when mid is showing a score instead
    live ? `<span class="live"></span> spilles nå` : (post ? m.osloTime : null),
    m.group || roundName(m.roundNote),
    m.venue,
  ].filter(Boolean).join(' <span class="dot">·</span> ');

  return `
    <div class="m">
      <div class="m-row">
        <div class="side">${m.home?.logo ? `<img src="${m.home.logo}" alt="" loading="lazy"/>` : ""}<span class="nm">${esc(m.home?.name || "TBD")}</span></div>
        <div class="mid">${mid}</div>
        <div class="side away">${m.away?.logo ? `<img src="${m.away.logo}" alt="" loading="lazy"/>` : ""}<span class="nm">${esc(m.away?.name || "TBD")}</span></div>
      </div>
      <div class="m-meta">
        <span>${metaLeft}</span>
        <span class="grow"></span>
        ${links}
        ${post ? `<button class="watched ${watched ? "on" : ""}" data-watched="${m.id}">${watched ? "✓ sett" : "marker sett"}</button>` : ""}
        <button class="star ${onPlan ? "on" : ""}" data-plan="${m.id}" title="Min plan">${onPlan ? "★" : "☆"}</button>
      </div>
    </div>`;
}

// ---------- views ----------
function viewSchedule() {
  const now = Date.now();
  let list = state.matches;
  if (state.filter === "today") {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date());
    list = list.filter((m) => m.osloDate === today);
  } else if (state.filter === "upcoming") {
    list = list.filter((m) => new Date(m.date).getTime() > now - 3 * 3600e3);
  } else if (state.filter === "replay") {
    list = list.filter((m) => m.completed && !state.watched.has(m.id));
  } else if (state.filter.startsWith("grp:")) {
    list = list.filter((m) => m.group === state.filter.slice(4));
  }
  if (!list.length) return `<div class="empty">Ingen kamper her.</div>`;
  const byDay = {};
  for (const m of list) (byDay[m.osloDate] ||= []).push(m);
  return Object.keys(byDay).sort().map((d) =>
    `<div class="day">${dayLabel(byDay[d][0])}</div>${byDay[d].map(matchRow).join("")}`).join("");
}

function viewPlan() {
  const planned = state.matches.filter((m) => state.plan.has(m.id)).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!planned.length) return `<div class="empty">Ingen kamper i planen ennå.<br/>Trykk ☆ på en kamp for å legge den til.</div>`;
  const queue = planned.filter((m) => m.completed && !state.watched.has(m.id));
  const rest = planned.filter((m) => !(m.completed && !state.watched.has(m.id)));
  let h = "";
  if (queue.length) h += `<div class="day">▶ Klar for reprise (${queue.length})</div>${queue.map(matchRow).join("")}`;
  if (rest.length) h += `<div class="day">Resten av planen</div>${rest.map(matchRow).join("")}`;
  return h;
}

// bracket: structure always visible; winners/scores only when revealed
function viewBracket() {
  const order = ["round-of-32", "round-of-16", "quarterfinals", "semifinals", "final"];
  const cols = order.map((rn) => ({ rn, ties: state.matches.filter((m) => m.roundNote === rn).sort((a, b) => new Date(a.date) - new Date(b.date)) }))
    .filter((c) => c.ties.length);
  if (!cols.length) return `<div class="empty">Sluttspillet er ikke satt opp ennå.</div>`;

  const team = (t, post) => {
    const known = t?.name && !isPlaceholder(t.name);
    const cls = ["t", known ? "known" : "", state.spoiler && post && t?.winner ? "win" : ""].filter(Boolean).join(" ");
    const g = state.spoiler && post && t?.score != null ? `<span class="g">${t.score}</span>` : "";
    return `<div class="${cls}">${known && t.logo ? `<img src="${t.logo}" alt=""/>` : ""}<span class="nm">${esc(shortName(t?.name) || "—")}</span>${g}</div>`;
  };
  const tie = (m, final) => {
    const [, mo, d] = m.osloDate.split("-").map(Number);
    return `<div class="tie ${final ? "final" : ""}">${team(m.home, m.completed)}${team(m.away, m.completed)}<div class="dt">${d}. ${MONTHS[mo - 1].slice(0, 3)} · ${m.osloTime}</div></div>`;
  };

  const third = state.matches.find((m) => m.roundNote === "3rd-place-match");
  const bracket = cols.map((c) =>
    `<div class="round"><h4>${roundName(c.rn)}</h4><div class="round-body">${c.ties.map((m) => tie(m, c.rn === "final")).join("")}</div></div>`).join("");
  const thirdBlock = third
    ? `<div class="block"><h3>Bronsefinale</h3><div class="tie">${(() => {
        const t = (x) => `<div class="t ${x?.name && !isPlaceholder(x.name) ? "known" : ""} ${state.spoiler && third.completed && x?.winner ? "win" : ""}">${x?.logo && !isPlaceholder(x?.name) ? `<img src="${x.logo}" alt=""/>` : ""}<span class="nm">${esc(shortName(x?.name) || "—")}</span>${state.spoiler && third.completed && x?.score != null ? `<span class="g">${x.score}</span>` : ""}</div>`;
        return t(third.home) + t(third.away);
      })()}<div class="dt">${third.osloDate} · ${third.osloTime}</div></div></div>`
    : "";
  return `<div class="bracket">${bracket}</div>${thirdBlock}`;
}

function viewStats() {
  if (!state.spoiler) {
    return `<div class="veil">📊 Statistikk røper resultater, tabeller og hvem som leder.<br/>
      <button class="pill" id="revealStats">Vis statistikk likevel</button></div>`;
  }
  let h = "";
  const s = state.stats;
  if (s) {
    h += `<div class="statline">
      <div><div class="n">${s.matchesPlayed}</div><div class="k">kamper spilt</div></div>
      <div><div class="n">${s.totalGoals}</div><div class="k">mål</div></div>
      <div><div class="n">${s.avgGoals}</div><div class="k">snitt/kamp</div></div></div>`;
    if (s.topScorers?.length) {
      h += `<div class="block"><h3>Toppscorere</h3><table>
        <thead><tr><th class="l">Spiller</th><th>Mål</th><th>Mål.gi.</th></tr></thead><tbody>
        ${s.topScorers.slice(0, 20).map((r, i) => `<tr>
          <td class="l team">${r.teamLogo ? `<img src="${r.teamLogo}" alt=""/>` : ""}<span><span class="rk">${i + 1}</span>${esc(r.name)}</span></td>
          <td class="pts">${r.goals}</td><td>${r.assists || ""}</td></tr>`).join("")}
        </tbody></table></div>`;
    }
  }
  h += state.groups.length
    ? state.groups.map((g) => `<div class="block"><h3>${esc(g.name)}</h3><table>
        <thead><tr><th class="l">Lag</th><th>K</th><th>S</th><th>U</th><th>T</th><th>MF</th><th>P</th></tr></thead><tbody>
        ${g.entries.map((e, i) => `<tr class="${i < 2 ? "adv" : ""}">
          <td class="l team">${e.logo ? `<img src="${e.logo}" alt=""/>` : ""}${esc(e.team)}</td>
          <td>${e.played ?? 0}</td><td>${e.wins ?? 0}</td><td>${e.ties ?? 0}</td><td>${e.losses ?? 0}</td>
          <td>${e.gd ?? 0}</td><td class="pts">${e.points ?? 0}</td></tr>`).join("")}
        </tbody></table></div>`).join("")
    : `<div class="empty">Tabeller ikke tilgjengelig ennå.</div>`;
  return h;
}

function renderFilters() {
  if (state.view !== "schedule") return "";
  const groups = [...new Set(state.matches.map((m) => m.group).filter(Boolean))].sort();
  const btns = [["upcoming", "Kommende"], ["today", "I dag"], ["replay", "▶ Repriser"], ["all", "Alle"],
    ...groups.map((g) => ["grp:" + g, g.replace("Group ", "Gr. ")])];
  return `<div class="filters">${btns.map(([k, l]) =>
    `<button class="${state.filter === k ? "active" : ""}" data-filter="${k}">${l}</button>`).join("")}</div>`;
}

function render() {
  document.getElementById("spoilerToggle").checked = state.spoiler;
  document.getElementById("modeLabel").innerHTML = state.spoiler
    ? "👀 Spoilermodus på — tar igjen resultater"
    : "🙈 Spoilerfri — resultater skjult";
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  const body = { schedule: viewSchedule, bracket: viewBracket, stats: viewStats, plan: viewPlan }[state.view]();
  app.innerHTML = renderFilters() + body;
}

// ---------- events ----------
document.getElementById("spoilerToggle").addEventListener("change", (e) => {
  state.spoiler = e.target.checked; LS.set("spoiler", state.spoiler); render();
});
document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]"); if (!b) return;
  state.view = b.dataset.view; render();
});
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-reveal],[data-plan],[data-watched],[data-filter],#revealStats");
  if (!t) return;
  if (t.dataset.filter != null) { state.filter = t.dataset.filter; render(); return; }
  if (t.id === "revealStats") { state.spoiler = true; LS.set("spoiler", true); render(); return; }
  if (t.dataset.reveal) { state.revealed.add(t.dataset.reveal); LS.set("revealed", [...state.revealed]); render(); return; }
  if (t.dataset.plan) { toggle(state.plan, t.dataset.plan, "plan"); render(); return; }
  if (t.dataset.watched) { toggle(state.watched, t.dataset.watched, "watched"); state.revealed.add(t.dataset.watched); LS.set("revealed", [...state.revealed]); render(); }
});
function toggle(set, id, key) { set.has(id) ? set.delete(id) : set.add(id); LS.set(key, [...set]); }

load();
