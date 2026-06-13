// VM 2026 — spoiler-free replay planner.
// Core rule: results (scores, standings) are HIDDEN by default. The user reveals
// per-match or flips global spoiler mode. Fixtures, times, groups and replay links
// are always safe to show.

const MONTHS = ["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"];
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("wc26:" + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem("wc26:" + k, JSON.stringify(v)); },
};

const state = {
  matches: [],
  groups: [],
  view: "schedule",
  filter: "upcoming",
  spoiler: LS.get("spoiler", false),
  revealed: new Set(LS.get("revealed", [])),
  watched: new Set(LS.get("watched", [])),
  plan: new Set(LS.get("plan", [])),
};

const app = document.getElementById("app");

// ---------- data ----------
async function load() {
  try {
    const [m, s] = await Promise.all([
      fetch("data/matches.json").then((r) => r.json()),
      fetch("data/standings.json").then((r) => r.json()).catch(() => ({ groups: [] })),
    ]);
    state.matches = m.matches || [];
    state.groups = s.groups || [];
    render();
  } catch (e) {
    app.innerHTML = `<div class="empty">Kunne ikke laste data.<br/><small>${e.message}</small></div>`;
  }
}

// ---------- helpers ----------
const isRevealed = (m) => state.spoiler || state.revealed.has(m.id);
const dayLabel = (m) => {
  const [, mo, d] = m.osloDate.split("-").map(Number);
  const wd = m.osloWeekday.charAt(0).toUpperCase() + m.osloWeekday.slice(1);
  return `${wd} ${d}. ${MONTHS[mo - 1]}`;
};

function replayLinks(m) {
  // Resolved deep links take priority; otherwise a spoiler-light search on the
  // service that holds the match.
  const q = encodeURIComponent(`${m.home?.name || ""} ${m.away?.name || ""}`.trim());
  const links = [];
  const s = m.streams || {};
  if (s.nrk) links.push({ cls: "nrk", label: "NRK TV", href: s.nrk, direct: true });
  else if (m.nrkFree) links.push({ cls: "nrk", label: "Søk NRK", href: `https://tv.nrk.no/sok?q=${q}`, direct: false });
  if (s.tv2) links.push({ cls: "tv2", label: "TV 2 Play", href: s.tv2, direct: true });
  else if (!m.nrkFree || !s.nrk) links.push({ cls: "tv2", label: "Søk TV 2", href: `https://play.tv2.no/sok?q=${q}`, direct: false });
  return links;
}

// ---------- match card ----------
function matchCard(m) {
  const live = m.state === "in";
  const post = m.completed;
  const reveal = isRevealed(m);
  const onPlan = state.plan.has(m.id);
  const watched = state.watched.has(m.id);

  const scoreHtml = (post || live)
    ? (reveal
        ? `<div class="score">${m.home?.score ?? "-"} – ${m.away?.score ?? "-"}</div>`
        : `<div class="score hidden" data-reveal="${m.id}" title="Trykk for å vise resultat">– – –</div>`)
    : `<div class="score" style="font-size:12px;color:var(--muted)">${m.osloTime}</div>`;

  const status = live
    ? `<span class="live-dot"></span> Spilles nå`
    : post
      ? (watched ? "✓ Sett" : "▶ Klar for reprise")
      : m.osloTime;

  const links = (post || live) ? replayLinks(m).map((l) =>
    `<a class="btn ${l.cls}" href="${l.href}" target="_blank" rel="noopener">${l.direct ? "▶ " : "🔎 "}${l.label}</a>`
  ).join("") : "";

  return `
    <div class="match ${live ? "live" : ""}" data-id="${m.id}">
      <div class="match-top">
        <span class="grp">${m.group || roundName(m.roundNote)}</span>
        <span>· ${m.venue ? m.venue : ""}${m.city ? ", " + m.city : ""}</span>
        <span class="time">${status}</span>
      </div>
      <div class="teams">
        <div class="team home">
          ${m.home?.logo ? `<img src="${m.home.logo}" alt="" loading="lazy"/>` : ""}
          <span>${m.home?.name || "TBD"}</span>
        </div>
        ${scoreHtml}
        <div class="team away">
          ${m.away?.logo ? `<img src="${m.away.logo}" alt="" loading="lazy"/>` : ""}
          <span>${m.away?.name || "TBD"}</span>
        </div>
      </div>
      <div class="match-bottom">
        ${links}
        <span class="spacer"></span>
        ${post ? `<button class="btn watched ${watched ? "on" : ""}" data-watched="${m.id}">${watched ? "✓ Sett" : "Marker sett"}</button>` : ""}
        <button class="btn star ${onPlan ? "on" : ""}" data-plan="${m.id}" title="Legg til i min plan">${onPlan ? "★" : "☆"}</button>
      </div>
    </div>`;
}

function roundName(note) {
  const map = {
    "group-stage": "Gruppespill",
    "round-of-32": "16-delsfinale",
    "round-of-16": "Åttedelsfinale",
    "quarterfinals": "Kvartfinale",
    "semifinals": "Semifinale",
    "third-place": "Bronsefinale",
    "final": "Finale",
  };
  return map[note] || "Kamp";
}

// ---------- views ----------
function renderSchedule() {
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
  return Object.keys(byDay).sort().map((day) => `
    <div class="daygroup">
      <h2>${dayLabel(byDay[day][0])}</h2>
      ${byDay[day].map(matchCard).join("")}
    </div>`).join("");
}

function renderPlan() {
  const planned = state.matches
    .filter((m) => state.plan.has(m.id))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!planned.length) {
    return `<div class="empty">Ingen kamper i planen ennå.<br/>Trykk ☆ på en kamp for å legge den til.</div>`;
  }
  const queue = planned.filter((m) => m.completed && !state.watched.has(m.id));
  const rest = planned.filter((m) => !(m.completed && !state.watched.has(m.id)));
  let html = "";
  if (queue.length) {
    html += `<div class="daygroup"><h2>▶ Klar for reprise (${queue.length})</h2>${queue.map(matchCard).join("")}</div>`;
  }
  if (rest.length) {
    html += `<div class="daygroup"><h2>Resten av planen</h2>${rest.map(matchCard).join("")}</div>`;
  }
  return html;
}

function renderStandings() {
  if (!state.spoiler) {
    return `<div class="reveal-veil">📊 Tabeller røper resultater og hvem som er videre.<br/>
      <button class="btn" id="revealStandings">Vis tabeller likevel</button></div>`;
  }
  if (!state.groups.length) return `<div class="empty">Ingen tabeller tilgjengelig ennå.</div>`;
  return state.groups.map((g) => `
    <div class="stand-group">
      <h3>${g.name}</h3>
      <table class="stand">
        <thead><tr><th style="text-align:left">Lag</th><th>K</th><th>S</th><th>U</th><th>T</th><th>MF</th><th>P</th></tr></thead>
        <tbody>
          ${g.entries.map((e, i) => `
            <tr class="${i < 2 ? "adv" : ""}">
              <td class="team-cell">${e.logo ? `<img src="${e.logo}" alt=""/>` : ""}${e.team}</td>
              <td>${e.played ?? 0}</td><td>${e.wins ?? 0}</td><td>${e.ties ?? 0}</td><td>${e.losses ?? 0}</td>
              <td>${e.gd ?? 0}</td><td><b>${e.points ?? 0}</b></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`).join("");
}

function renderFilters() {
  if (state.view !== "schedule") return "";
  const groups = [...new Set(state.matches.map((m) => m.group).filter(Boolean))].sort();
  const btns = [
    ["upcoming", "Kommende"],
    ["today", "I dag"],
    ["replay", "▶ Repriser"],
    ["all", "Alle"],
    ...groups.map((g) => ["grp:" + g, g.replace("Group ", "Gr. ")]),
  ];
  return `<div class="filters">${btns.map(([k, label]) =>
    `<button class="${state.filter === k ? "active" : ""}" data-filter="${k}">${label}</button>`).join("")}</div>`;
}

function render() {
  // sync controls
  document.getElementById("spoilerToggle").checked = state.spoiler;
  const bar = document.getElementById("spoilerBar");
  bar.classList.toggle("on", state.spoiler);
  document.getElementById("spoilerLabel").textContent = state.spoiler
    ? "👀 Spoilermodus PÅ — resultater vises"
    : "🙈 Spoilerfri modus — resultater er skjult";
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === state.view));

  const body =
    state.view === "schedule" ? renderSchedule() :
    state.view === "plan" ? renderPlan() :
    renderStandings();
  app.innerHTML = renderFilters() + body;
}

// ---------- events ----------
document.getElementById("spoilerToggle").addEventListener("change", (e) => {
  state.spoiler = e.target.checked;
  LS.set("spoiler", state.spoiler);
  render();
});
document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  state.view = b.dataset.view;
  render();
});
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-reveal],[data-plan],[data-watched],[data-filter],#revealStandings");
  if (!t) return;
  if (t.dataset.filter != null) { state.filter = t.dataset.filter; render(); return; }
  if (t.id === "revealStandings") { state.spoiler = true; LS.set("spoiler", true); render(); return; }
  if (t.dataset.reveal) { state.revealed.add(t.dataset.reveal); LS.set("revealed", [...state.revealed]); render(); return; }
  if (t.dataset.plan) { toggle(state.plan, t.dataset.plan, "plan"); render(); return; }
  if (t.dataset.watched) {
    toggle(state.watched, t.dataset.watched, "watched");
    state.revealed.add(t.dataset.watched); LS.set("revealed", [...state.revealed]);
    render();
  }
});
function toggle(set, id, key) {
  set.has(id) ? set.delete(id) : set.add(id);
  LS.set(key, [...set]);
}

load();
