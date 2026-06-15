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
  groupsShown: false, // session-only: group tables reveal who's advancing (spoiler)
  statsTab: "players", // stats section: players | teams
  sheet: null, // id of the match whose detail sheet is open (null = closed)
  venue: null, // venue whose stadium sheet is open
  filter: "all", // schedule filter: all | no (Norway) | plan
  hintSeen: LS.get("hintSeen", false),
  theme: LS.get("theme", "auto"), // auto (device) | light | dark
  justRevealed: null, justStarred: null, // last-touched match id → one-shot pop animation
};
// migrate the legacy permanent "revealed" array (pre-toggle model) into overrides
{
  const legacy = LS.get("revealed", null);
  if (Array.isArray(legacy)) { legacy.forEach((id) => (state.reveal[id] = true)); LS.set("reveal", state.reveal); localStorage.removeItem("wc26:revealed"); }
}
const app = document.getElementById("app");
// Chromium renders url() refraction in backdrop-filter; gate the lens to it so Safari/
// Firefox keep the frost fallback. Pause the drifting aurora when the tab is hidden.
if (window.chrome || /\bEdg\//.test(navigator.userAgent)) document.documentElement.classList.add("refract");
document.addEventListener("visibilitychange", () => document.documentElement.classList.toggle("anim-paused", document.hidden));
const _osloFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }); // reused, not rebuilt per call
const todayOslo = () => _osloFmt.format(new Date());

// ---------- theme: Auto (device) / Lys / Mørk ----------
const _darkMq = matchMedia("(prefers-color-scheme: dark)");
function renderTheme() {
  const el = document.getElementById("themeseg");
  if (!el) return;
  const opts = [["auto", ICON.auto, "Auto"], ["light", ICON.sun, "Lys"], ["dark", ICON.moon, "Mørk"]];
  el.innerHTML = opts.map(([k, ic, l]) => `<button data-settheme="${k}" class="${state.theme === k ? "on" : ""}" aria-label="${l}" aria-pressed="${state.theme === k}" title="${l}">${ic}</button>`).join("");
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme === "auto" ? (_darkMq.matches ? "dark" : "light") : state.theme;
  renderTheme();
}
_darkMq.addEventListener("change", () => { if (state.theme === "auto") applyTheme(); });

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
// Live status from the data only refreshes on the 2-hourly build, so infer it from
// the clock too: a match whose kickoff has passed but isn't completed yet is treated
// as live until a plausible end (group ~2.5h; knockouts run to ET + penalties ~3.5h).
// This keeps "spilles nå" correct the moment anyone opens the site. No score to spoil
// during play (results aren't in the data yet), so this never affects spoiler-gating.
const liveWindowMs = (m) => (/group/i.test(m.roundNote || "") ? 2.5 : 3.5) * 3600 * 1000;
const isLive = (m) => {
  if (m.completed) return false;
  if (m.state === "in") return true;
  if (m.state !== "pre" || !m.date) return false;
  const start = Date.parse(m.date);
  return Date.now() >= start && Date.now() < start + liveWindowMs(m);
};
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
  chart: SVG('<path d="M5 20.5V10.5M12 20.5V4.5M19 20.5v-7"/>', { sw: 1.9 }),
  grid: SVG('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.7h17M9.2 9.7v9.8"/>'),
  pin: SVG('<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
  close: SVG('<path d="M5 5l14 14M19 5L5 19"/>', { sw: 2 }),
  temp: SVG('<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v6"/>'),
  sun: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>'),
  auto: SVG('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>'),
};
const ROUND = { "group-stage": "Gruppespill","round-of-32":"16-delsfinale","round-of-16":"8-delsfinale",quarterfinals:"Kvartfinale",semifinals:"Semifinale","3rd-place-match":"Bronsefinale",final:"Finale" };
const roundName = (n) => ROUND[n] || "Kamp";
const isPH = (n) => /winner|loser|place|group [a-l]\b|quarterfinal|semifinal|round of/i.test(n || "");
const short = (n) => isPH(n) ? String(n).replace(/Third Place/i,"3.pl").replace(/2nd Place/i,"2.pl").replace(/Group /i,"gr.").replace(/Round of 32/i,"16-del").replace(/Quarterfinal/i,"KF").replace(/Semifinal/i,"SF").replace(/Winner/i,"vinner").replace(/Loser/i,"taper").trim() : n;
const fmtDay = (iso) => { const [, mo, d] = iso.split("-").map(Number); const wd = new Date(iso + "T12:00:00Z").getUTCDay(); return { wd: WD[wd], d, label: `${["Søndag","Mandag","Tirsdag","Onsdag","Torsdag","Fredag","Lørdag"][wd]} ${d}. ${MONTHS[mo - 1]}` }; };

// NRK publishes its catalog ~2 weeks ahead; until a match has its own episode we
// land the user on the official World Cup hub (where it'll appear), not a broken
// English-name search — NRK titles matches in Norwegian.
const NRK_HUB = "https://tv.nrk.no/serie/fifa-fotball-vm-2026";
const TV2_HUB = "https://play.tv2.no/fotball-vm";

// Open in the native app on mobile via Universal Links (iOS) / App Links (Android).
// NRK's links already qualify (its app claims /se, /serie/*, /sok …). TV 2's app only
// claims URLs carrying a `partner` query param (per its apple-app-site-association),
// so we append one — any value triggers the app, and the website ignores it.
const tv2App = (href) => href + (href.includes("?") ? "&" : "?") + "partner=worldcupsync";
// On an episode link the NRK app otherwise lands on the season list with the match
// highlighted; the share-link template advertises an `autoplay` param ({&autoplay,t})
// that takes it straight into the player. Only the /se?v= match links carry it.
const nrkApp = (href) => /\/se\?/.test(href) ? href + "&autoplay=true" : href;

function primaryLinks(m) {
  const s = m.streams || {}; const out = [];
  if (s.nrk) out.push({ cls: "nrk", label: "NRK TV", short: "NRK", href: nrkApp(s.nrk), ico: ICON.play });
  else if (m.nrkFree) out.push({ cls: "ghost", label: "NRK – VM-oversikt", short: "NRK", href: NRK_HUB, ico: ICON.play });
  if (s.tv2) out.push({ cls: "tv2", label: "TV 2 Play", short: "TV 2", href: tv2App(s.tv2), ico: ICON.play });
  else if (!m.nrkFree || !s.nrk) out.push({ cls: "ghost", label: "TV 2 – VM-oversikt", short: "TV 2", href: tv2App(TV2_HUB), ico: ICON.play });
  return out;
}

// ---------- match row (compact, one line — scannable week overview) ----------
function matchRow(m, opts = {}) {
  const live = isLive(m), post = m.completed, reveal = isRevealed(m);
  const onPlan = state.plan.has(m.id), watched = state.watched.has(m.id);
  const lt = live
    ? `<span class="live" title="spilles nå"></span><span class="when na">Nå</span>`
    : `<span class="when">${m.osloTime}</span>`;
  const score = `${m.home?.score ?? "-"}–${m.away?.score ?? "-"}`;
  let md;
  if (!(post || live)) md = `<span class="md vs">–</span>`;
  else if (reveal) {
    // a revealed result — tap to hide again. Fresh ones (not old history) show a hide hint.
    const fresh = !isStale(m);
    md = `<button class="md shown${m.id === state.justRevealed ? " pop" : ""}" data-hide="${m.id}" title="Skjul resultat" aria-label="Skjul resultat">${score}${fresh ? `<span class="eyeoff">${ICON.eyeOff}</span>` : ""}</button>`;
  } else {
    // hidden — an explicit, obvious tap target: tap to reveal just this match
    md = `<button class="md reveal" data-show="${m.id}" title="Vis resultat" aria-label="Vis resultat">${ICON.eye}<span class="lbl">Vis</span></button>`;
  }
  let act = "";
  { const l = primaryLinks(m)[0]; if (l) { const verb = post ? "Se reprise" : live ? "Se direkte" : "Se på"; act += `<a class="go ${l.cls}" href="${l.href}" target="_blank" rel="noopener" title="${verb} — ${l.label}" aria-label="${verb} på ${l.label}">${l.ico}<span class="golbl">${l.short}</span></a>`; } }
  if (opts.plan && post) act += `<button class="wch ${watched ? "on" : ""}" data-watched="${m.id}" title="Marker sett" aria-label="${watched ? "Fjern sett-markering" : "Marker som sett"}" aria-pressed="${watched}">${ICON.check}</button>`;
  act += `<button class="star ${onPlan ? "on" : ""}${onPlan && m.id === state.justStarred ? " pop" : ""}" data-plan="${m.id}" title="Min plan" aria-label="${onPlan ? "Fjern fra min plan" : "Legg i min plan"}" aria-pressed="${onPlan}">${onPlan ? ICON.starOn : ICON.starOff}</button>`;
  const place = [m.venue, m.city].filter(Boolean).join(", ");
  return `<div class="m${isNO(m) ? " no" : ""}" data-open="${m.id}"${place ? ` title="${esc(place)}"` : ""}>
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
const resetBar = () => (Object.values(state.reveal).some((v) => v === true) ? `<div class="resetbar"><button class="reset" id="resetReveals" title="Tilbake til automatisk – skjuler alt du har vist">${ICON.reset} Skjul resultatene jeg har vist</button></div>` : "");
const filterChips = () => { const chip = (k, l, ico) => `<button class="chip ${state.filter === k ? "on" : ""}" data-filter="${k}">${ico || ""}${l}</button>`; return `<div class="filters">${chip("all", "Alle")}${chip("no", "Norge")}${chip("plan", "Min plan", ICON.starOn)}</div>`; };
const filterMatches = (list) => (state.filter === "no" ? list.filter(isNO) : state.filter === "plan" ? list.filter((m) => state.plan.has(m.id)) : list);
// compact hero: live next-match countdown + today's stadium map
function heroCard(today) {
  const hot = new Set(state.matches.filter((m) => programDate(m) === today).map((m) => m.venue));
  const nm = nextMatch();
  const cd = nm ? `<div class="countdown" data-kickoff="${nm.date}"><span class="cd-l">${isNO(nm) ? "Norge spiller" : "Neste kamp"}</span><span class="cd-m">${esc(nm.home?.name || "TBD")} – ${esc(nm.away?.name || "TBD")}</span><span class="cd-time">…</span></div>` : "";
  return `<section class="card hero">${cd}${naMapSVG(hot)}</section>`;
}

// Kamper — ONE continuous day-by-day list of every match (played + upcoming) on the
// same page. Finished matches carry their replay link inline; recent results stay
// hidden behind "Vis". A compact hero (countdown + today's map) sits with the day you
// land on; auto-scrolled to today so last night's replays sit just above.
function viewSchedule() {
  const today = todayOslo();
  const hint = state.hintSeen ? "" : `<div class="hint">${ICON.eye}<div><b>Spoilerfri av seg selv.</b> Nattens og gårsdagens resultater er skjult til du har sett dem; eldre vises automatisk. Trykk «Vis» for å avsløre, eller reprise-lenken for å se kampen.</div><button class="x" id="hintClose" aria-label="Lukk">×</button></div>`;
  const matches = filterMatches(state.matches);
  if (!matches.length) {
    const msg = state.filter === "plan" ? "Ingen kamper i planen ennå." : state.filter === "no" ? "Ingen Norge-kamper funnet." : "Ingen kamper.";
    return hint + filterChips() + `<div class="empty">${msg}</div>`;
  }
  const byDay = {}, order = [];
  for (const m of matches) { const p = programDate(m); if (!byDay[p]) { byDay[p] = []; order.push(p); } byDay[p].push(m); }
  order.sort();
  const anchor = order.find((p) => p >= today) || order[order.length - 1]; // land on today (or next)

  const days = order.map((p) => {
    const ms = byDay[p].sort((a, b) => new Date(a.date) - new Date(b.date));
    const f = fmtDay(p), rel = relLabel(p);
    const lbl = rel ? `<b>${rel}</b> · ${f.label.toLowerCase()}` : f.label;
    let rows = "", night = false;
    for (const m of ms) {
      if (!night && parseInt(m.osloTime.slice(0, 2), 10) < 6) { rows += `<div class="night">${ICON.moon} natt til ${WDFULL[new Date(m.osloDate + "T12:00:00Z").getUTCDay()]}</div>`; night = true; }
      rows += matchRow(m);
    }
    const isA = p === anchor;
    const head = `<div class="day-head"${isA ? ' id="anchor"' : ""}><span class="dl">${lbl}</span><span class="dcount">${ms.length} ${ms.length === 1 ? "kamp" : "kamper"}</span></div>`;
    return head + (isA ? heroCard(today) : "") + `<section class="card group">${rows}</section>`;
  }).join("");

  return hint + filterChips() + resetBar() + days;
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
  const tie = (m, fin) => { const [, mo, d] = m.osloDate.split("-").map(Number); const r = isRevealed(m); const place = m.city ? ` · ${esc(m.city)}` : ""; return `<div class="tie ${fin ? "final" : ""}">${team(m.home, r)}${team(m.away, r)}<div class="dt">${d}. ${MONTHS[mo - 1].slice(0, 3)} · ${m.osloTime}${place}</div></div>`; };
  const third = state.matches.find((m) => m.roundNote === "3rd-place-match");
  let h = `<div class="bracket">${cols.map((c) => `<div class="round"><h4>${roundName(c.rn)}</h4>${c.ties.map((m) => tie(m, c.rn === "final")).join("")}</div>`).join("")}</div>`;
  if (third) h += `<div class="block"><h3>Bronsefinale</h3><div class="bracket"><div class="round" style="width:200px">${tie(third, false)}</div></div></div>`;
  return h;
}

// reusable little tables/rows for the stats sections
const scorerRows = (rows, val) => rows.map((r, i) => `<tr><td class="l team"><span class="rk">${i + 1}</span>${r.teamLogo ? `<img src="${r.teamLogo}" alt=""/>` : ""}<span class="nm">${esc(r.name)}</span></td><td class="pts">${val(r)}</td></tr>`).join("");
const teamRows = (rows, cols) => rows.map((e, i) => `<tr><td class="l team"><span class="rk">${i + 1}</span>${e.logo ? `<img src="${e.logo}" alt=""/>` : ""}<span class="nm">${esc(e.team)}</span></td>${cols.map((c) => `<td class="${c.pts ? "pts" : ""}">${c.v(e)}</td>`).join("")}</tr>`).join("");

function viewStats() {
  if (!state.statsShown) return `<div class="veil"><span class="veilic">${ICON.chart}</span><br/>Statistikk røper hvem som topper toppscorer- og mållistene.<br/><button class="reveal-btn" id="revealStats">${ICON.eye} Vis statistikk</button></div>`;
  const s = state.stats;
  const fin = state.matches.filter((m) => m.completed && m.home?.score != null && m.away?.score != null);
  const playedTeams = state.groups.flatMap((g) => g.entries || []).filter((e) => (e.played || 0) > 0);

  // ---- overview numbers (always on top) ----
  let mostGoals = 0, cleanSheets = 0;
  for (const m of fin) {
    const tot = (m.home.score || 0) + (m.away.score || 0);
    if (tot > mostGoals) mostGoals = tot;
    if (m.home.score === 0) cleanSheets++;
    if (m.away.score === 0) cleanSheets++;
  }
  const played = s?.matchesPlayed ?? fin.length;
  const stat = (n, k) => `<div><div class="n">${n}</div><div class="k">${k}</div></div>`;
  const overview = `<div class="statline">${stat(played, "spilt")}${stat(s?.totalGoals ?? "–", "mål")}${stat(s?.avgGoals ?? "–", "snitt")}${stat(state.matches.length - played, "igjen")}${stat(mostGoals, "flest i kamp")}${stat(cleanSheets, "clean sheets")}</div>`;

  // ---- segmented control ----
  const tabs = [["players", "Spillere"], ["teams", "Lag"]];
  const seg = `<div class="seg" role="tablist">${tabs.map(([k, l]) => `<button class="${state.statsTab === k ? "on" : ""}" data-stab="${k}" aria-selected="${state.statsTab === k}">${l}</button>`).join("")}</div>`;

  let body = "";
  if (state.statsTab === "teams") {
    if (playedTeams.length) {
      const topScore = [...playedTeams].sort((a, b) => (b.gf || 0) - (a.gf || 0)).slice(0, 8);
      body += `<div class="block"><h3>Mestscorende lag</h3><table><thead><tr><th class="l">Lag</th><th>K</th><th>Mål</th></tr></thead><tbody>${teamRows(topScore, [{ v: (e) => e.played || 0 }, { pts: 1, v: (e) => e.gf || 0 }])}</tbody></table></div>`;
      const bestDef = [...playedTeams].sort((a, b) => (a.ga || 0) - (b.ga || 0) || (b.played || 0) - (a.played || 0)).slice(0, 8);
      body += `<div class="block"><h3>Beste forsvar</h3><table><thead><tr><th class="l">Lag</th><th>K</th><th>Bak.</th></tr></thead><tbody>${teamRows(bestDef, [{ v: (e) => e.played || 0 }, { pts: 1, v: (e) => e.ga || 0 }])}</tbody></table></div>`;
    }
    const wins = fin.map((m) => ({ m, d: Math.abs((m.home.score || 0) - (m.away.score || 0)) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 6);
    if (wins.length) body += `<div class="block"><h3>Største seire</h3>${wins.map(({ m }) => `<div class="winrow"><span class="wh"><span class="nm">${esc(m.home.name)}</span>${m.home.logo ? `<img src="${m.home.logo}" alt=""/>` : ""}</span><span class="sc">${m.home.score}–${m.away.score}</span><span class="wa">${m.away.logo ? `<img src="${m.away.logo}" alt=""/>` : ""}<span class="nm">${esc(m.away.name)}</span></span></div>`).join("")}</div>`;
    if (!body) body = `<div class="empty">Ingen lagstatistikk ennå.</div>`;
  } else {
    if (s?.topScorers?.length) body += `<div class="block"><h3>Toppscorere</h3><table><thead><tr><th class="l">Spiller</th><th>Mål</th></tr></thead><tbody>${scorerRows(s.topScorers.slice(0, 20), (r) => r.goals)}</tbody></table></div>`;
    const assist = (s?.topScorers || []).filter((r) => r.assists > 0).sort((a, b) => b.assists - a.assists).slice(0, 10);
    if (assist.length) body += `<div class="block"><h3>Målgivende</h3><table><thead><tr><th class="l">Spiller</th><th>M.gi.</th></tr></thead><tbody>${scorerRows(assist, (r) => r.assists)}</tbody></table></div>`;
    if (!body) body = `<div class="empty">Ingen spillerstatistikk ennå.</div>`;
  }
  return overview + seg + body;
}

// ---------- group standings (own tab; spoiler-gated like stats) ----------
function viewGroups() {
  if (!state.groups.length) return `<div class="empty">Gruppespillet er ikke satt opp ennå.</div>`;
  if (!state.groupsShown) return `<div class="veil"><span class="veilic">${ICON.grid}</span><br/>Gruppetabellene røper hvem som leder og hvem som ligger an til å gå videre.<br/><button class="reveal-btn" id="revealGroups">${ICON.eye} Vis tabeller</button></div>`;
  return state.groups.map((g) => `<div class="block"><h3>${esc(g.name)}</h3><table><thead><tr><th class="l">Lag</th><th>K</th><th>S</th><th>U</th><th>T</th><th>MF</th><th>P</th></tr></thead><tbody>${g.entries.map((e, i) => `<tr class="${i < 2 ? "adv" : ""}"><td class="l team">${e.logo ? `<img src="${e.logo}" alt=""/>` : ""}<span class="nm">${esc(e.team)}</span></td><td>${e.played ?? 0}</td><td>${e.wins ?? 0}</td><td>${e.ties ?? 0}</td><td>${e.losses ?? 0}</td><td>${e.gd ?? 0}</td><td class="pts">${e.points ?? 0}</td></tr>`).join("")}</tbody></table></div>`).join("");
}

// the 16 host stadiums → [lat, lon], for the detail-sheet map marker
const VENUES = {
  "AT&T Stadium": [32.7473, -97.0945],
  "BC Place": [49.2767, -123.1119],
  "BMO Field": [43.6332, -79.4185],
  "Estadio Akron": [20.6819, -103.4625],
  "Estadio BBVA": [25.6692, -100.2447],
  "Estadio Banorte": [19.3029, -99.1505],
  "GEHA Field at Arrowhead Stadium": [39.0489, -94.4839],
  "Gillette Stadium": [42.0909, -71.2643],
  "Hard Rock Stadium": [25.958, -80.2389],
  "Levi's Stadium": [37.403, -121.9697],
  "Lincoln Financial Field": [39.9008, -75.1675],
  "Lumen Field": [47.5952, -122.3316],
  "Mercedes-Benz Stadium": [33.7554, -84.4008],
  "MetLife Stadium": [40.8135, -74.0745],
  "NRG Stadium": [29.6847, -95.4107],
  "SoFi Stadium": [33.9535, -118.3392],
};
const venueCountry = (v) => (["BC Place", "BMO Field"].includes(v) ? "Canada" : ["Estadio Akron", "Estadio BBVA", "Estadio Banorte"].includes(v) ? "Mexico" : "USA");
// equirectangular projection matching the embedded silhouette (viewBox 240x134)
const naX = (lon) => ((lon + 170) / 120) * 240;
const naY = (lat) => ((73 - lat) / 67) * 134;
// Minimal inline silhouette of the host continent with an accent marker — integrated
// into the sheet (no framed widget), clean, no external map/tiles.
function mapBlock(m) {
  const place = [m.venue, m.city].filter(Boolean).join(", ");
  const co = VENUES[m.venue];
  const search = co ? `https://www.google.com/maps/search/?api=1&query=${co[0]},${co[1]}` : (place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null);
  const link = search ? `<a class="maplink" href="${search}" target="_blank" rel="noopener">Åpne i kart ↗</a>` : "";
  if (!co || !window.NA_PATH) return link;
  const x = naX(co[1]).toFixed(1), y = naY(co[0]).toFixed(1);
  return `<div class="venuemap">
    <svg viewBox="0 0 240 134" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Kart over Nord-Amerika med markør på ${esc(m.city || m.venue)}">
      <path class="na-land" d="${window.NA_PATH}"/>
      <circle class="na-halo" cx="${x}" cy="${y}" r="2.6"/>
      <circle class="na-dot" cx="${x}" cy="${y}" r="2.4"/>
    </svg>
    <span class="mapcountry">${venueCountry(m.venue)}</span>
  </div>${link}`;
}

// ---------- stadium map: the day's venues stand out; the rest are faint context ----------
function naMapSVG(hot) {
  // draw the faint context dots first, the highlighted ones on top
  const order = Object.entries(VENUES).sort((a, b) => (hot.has(a[0]) ? 1 : 0) - (hot.has(b[0]) ? 1 : 0));
  const markers = order.map(([v, co]) => {
    const x = naX(co[1]).toFixed(1), y = naY(co[0]).toFixed(1), on = hot.has(v);
    return `<g class="vmk${on ? " hot" : ""}" data-venue="${esc(v)}" role="button" aria-label="${esc(v)}">${on ? `<circle class="vhalo" cx="${x}" cy="${y}" r="3.4"/>` : ""}<circle class="vhit" cx="${x}" cy="${y}" r="8"/><circle class="vdot" cx="${x}" cy="${y}" r="${on ? 3.6 : 1.6}"/></g>`;
  }).join("");
  return `<svg viewBox="0 0 240 134" class="bigmap" role="img" aria-label="Kart over VM-stadioner"><path class="na-land" d="${window.NA_PATH || ""}"/>${markers}</svg>`;
}
// live countdown to the next match (Norway's if one is coming up)
function nextMatch() {
  const now = Date.now();
  const up = state.matches.filter((m) => m.date && Date.parse(m.date) > now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return up.find(isNO) || up[0] || null;
}
const fmtCountdown = (ms) => {
  if (ms <= 0) return "spilles nå";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return d > 0 ? `om ${d}d ${h}t` : h > 0 ? `om ${h}t ${m}m` : `om ${m}m ${String(sec).padStart(2, "0")}s`;
};
function tickCountdown() {
  const el = document.querySelector(".countdown");
  const t = el && el.querySelector(".cd-time");
  if (t) t.textContent = fmtCountdown(Date.parse(el.dataset.kickoff) - Date.now());
}
// ---------- stadium sheet: a venue + every match played there ----------
function venueSheetHTML(v) {
  const co = VENUES[v];
  const ms = state.matches.filter((m) => m.venue === v).sort((a, b) => new Date(a.date) - new Date(b.date));
  const city = ms[0]?.city || "";
  const map = co ? `<div class="venuemap"><svg viewBox="0 0 240 134" role="img" aria-label="Kart med markør på ${esc(v)}"><path class="na-land" d="${window.NA_PATH || ""}"/><circle class="na-halo" cx="${naX(co[1]).toFixed(1)}" cy="${naY(co[0]).toFixed(1)}" r="2.6"/><circle class="na-dot" cx="${naX(co[1]).toFixed(1)}" cy="${naY(co[0]).toFixed(1)}" r="2.4"/></svg><span class="mapcountry">${venueCountry(v)}</span></div>` : "";
  return `<div class="sheet-backdrop" data-close="1"></div>
    <div class="sheet-card venue" role="dialog" aria-modal="true" aria-label="Stadion">
      <button class="sheet-x" id="sheetClose" aria-label="Lukk">${ICON.close}</button>
      <div class="sheet-eyebrow">${esc(venueCountry(v))}${city ? " · " + esc(city) : ""}</div>
      <h2 class="sheet-title">${esc(v)}</h2>
      ${map}
      <div class="venue-matches">${ms.length ? ms.map((m) => matchRow(m)).join("") : `<div class="empty">Ingen kamper.</div>`}</div>
    </div>`;
}

// ---------- weather at kickoff (Open-Meteo, free, no key) ----------
const wxCache = {}; // matchId -> html string ("" = unavailable)
const wmo = (c) => (c === 0 ? "klart" : c <= 3 ? "lettskyet" : c <= 48 ? "tåke" : c <= 67 ? "regn" : c <= 77 ? "snø" : c <= 82 ? "regnbyger" : c <= 86 ? "snøbyger" : "torden");
function applyWeather(m) {
  const el = document.getElementById("sheetwx");
  if (!el) return;
  const co = VENUES[m.venue];
  if (!co || !m.date) { el.remove(); return; }
  if (m.id in wxCache) { wxCache[m.id] ? (el.innerHTML = wxCache[m.id]) : el.remove(); return; }
  el.innerHTML = `<span class="wx-load">Henter vær …</span>`;
  const d = m.date.slice(0, 10), hh = m.date.slice(11, 13);
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${co[0]}&longitude=${co[1]}&hourly=temperature_2m,weather_code&start_date=${d}&end_date=${d}&timezone=GMT`)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j) => {
      const t = j.hourly?.time || [], tm = j.hourly?.temperature_2m || [], cd = j.hourly?.weather_code || [];
      const i = t.indexOf(`${d}T${hh}:00`);
      wxCache[m.id] = i >= 0 && tm[i] != null ? `${ICON.temp}<span>${Math.round(tm[i])}° · ${wmo(cd[i])}</span>` : "";
    })
    .catch(() => { wxCache[m.id] = ""; })
    .finally(() => { if (state.sheet === m.id) { const e = document.getElementById("sheetwx"); if (e) (wxCache[m.id] ? (e.innerHTML = wxCache[m.id]) : e.remove()); } });
}

// ---------- match detail sheet (tap a row) ----------
function sheetHTML(m) {
  const live = isLive(m), post = m.completed, reveal = isRevealed(m);
  const onPlan = state.plan.has(m.id);
  const where = m.roundNote === "group-stage" ? (m.group || "Gruppespill") : roundName(m.roundNote);
  const f = fmtDay(m.osloDate);
  const place = [m.venue, m.city].filter(Boolean).join(" · ");
  const teamSide = (t, cls) => `<div class="sht ${cls}">${t?.logo ? `<img src="${t.logo}" alt=""/>` : ""}<span class="nm">${esc(t?.name || "TBD")}</span></div>`;
  const mid = (post || live)
    ? (reveal ? `<span class="shsc">${m.home?.score ?? "-"}–${m.away?.score ?? "-"}</span>` : `<button class="md reveal" data-show="${m.id}" aria-label="Vis resultat">${ICON.eye}<span class="lbl">Vis</span></button>`)
    : `<span class="shsc vs">${m.osloTime}</span>`;
  const links = primaryLinks(m).map((l) => `<a class="go ${l.cls} big" href="${l.href}" target="_blank" rel="noopener">${l.ico}<span>${l.label}</span></a>`).join("");
  return `<div class="sheet-backdrop" data-close="1"></div>
    <div class="sheet-card" role="dialog" aria-modal="true" aria-label="Kampdetaljer">
      <button class="sheet-x" id="sheetClose" aria-label="Lukk">${ICON.close}</button>
      <div class="sheet-eyebrow">${esc(where)}${live ? ' · <span class="liveword">spilles nå</span>' : ""}</div>
      <div class="sheet-h">${teamSide(m.home, "a")}<span class="shmid">${mid}</span>${teamSide(m.away, "b")}</div>
      <div class="sheet-meta">${f.label} · ${m.osloTime}</div>
      ${place ? `<div class="sheet-line">${ICON.pin}<span>${esc(place)}</span></div>` : ""}
      <div class="sheet-line wx" id="sheetwx"></div>
      ${mapBlock(m)}
      ${links ? `<div class="sheet-streams">${links}</div>` : ""}
      <button class="sheet-plan ${onPlan ? "on" : ""}" data-plan="${m.id}">${onPlan ? ICON.starOn : ICON.starOff}<span>${onPlan ? "I min plan" : "Legg i min plan"}</span></button>
    </div>`;
}
function renderSheet() {
  const el = document.getElementById("sheet");
  const m = state.sheet && state.matches.find((x) => x.id === state.sheet);
  if (m) { el.innerHTML = sheetHTML(m); el.hidden = false; applyWeather(m); return; }   // match detail (wins over venue → acts as "back")
  if (state.venue) { el.innerHTML = venueSheetHTML(state.venue); el.hidden = false; return; }
  el.hidden = true; el.innerHTML = "";
}

let didAnchor = false; // only auto-scroll to today once per visit to Kamper
function render() {
  document.querySelectorAll("#tabs button").forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle("active", on);
    on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
  });
  // remember focus so a full re-render doesn't strand keyboard / screen-reader users
  const ae = document.activeElement;
  let refocus = "";
  if (ae && app.contains(ae)) {
    const id = ae.dataset.show || ae.dataset.hide;
    if (ae.id) refocus = "#" + ae.id;
    else if (id) refocus = `[data-show="${id}"],[data-hide="${id}"]`;
    else if (ae.dataset.plan) refocus = `[data-plan="${ae.dataset.plan}"]`;
    else if (ae.dataset.watched) refocus = `[data-watched="${ae.dataset.watched}"]`;
    else if (ae.dataset.filter) refocus = `[data-filter="${ae.dataset.filter}"]`;
    else if (ae.dataset.stab) refocus = `[data-stab="${ae.dataset.stab}"]`;
  }
  const body = { schedule: viewSchedule, groups: viewGroups, bracket: viewBracket, stats: viewStats, plan: viewPlan }[state.view]();
  app.innerHTML = body;
  if (refocus) { const el = app.querySelector(refocus); if (el) el.focus(); }
  state.justRevealed = state.justStarred = null; // pops are one-shot
  tickCountdown();
  renderSheet();
  if (state.view === "schedule" && !didAnchor) {
    const a = document.getElementById("anchor");
    if (a) { a.scrollIntoView({ block: "start" }); didAnchor = true; }
  }
}

// ---------- events ----------
document.getElementById("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (!b) return; state.view = b.dataset.view; didAnchor = false; render(); });
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-show],[data-hide],[data-plan],[data-watched],[data-filter],[data-stab],[data-venue],[data-open],[data-close],[data-settheme],#revealStats,#revealGroups,#resetReveals,#hintClose,#sheetClose");
  if (!t) return;
  if (t.dataset.settheme) { state.theme = t.dataset.settheme; LS.set("theme", state.theme); applyTheme(); return; }
  if (t.id === "revealStats") { state.statsShown = true; render(); return; }
  if (t.id === "revealGroups") { state.groupsShown = true; render(); return; }
  if (t.dataset.stab) { state.statsTab = t.dataset.stab; render(); return; }
  if (t.id === "hintClose") { state.hintSeen = true; LS.set("hintSeen", true); render(); return; }
  if (t.id === "resetReveals") { for (const k in state.reveal) if (state.reveal[k]) delete state.reveal[k]; LS.set("reveal", state.reveal); render(); return; }
  if (t.id === "sheetClose" || t.dataset.close) { state.sheet ? (state.sheet = null) : (state.venue = null); render(); return; } // close (match → back to venue; else close)
  if (t.dataset.venue) { state.venue = t.dataset.venue; render(); return; }                 // tap a stadium on the map
  if (t.dataset.filter) { state.filter = t.dataset.filter; didAnchor = false; render(); return; } // re-anchor to today after filtering
  if (t.dataset.show) { state.justRevealed = t.dataset.show; setReveal(t.dataset.show, true); render(); return; } // tap "Vis" → reveal (with a pop)
  if (t.dataset.hide) { setReveal(t.dataset.hide, false); render(); return; }               // tap a shown score → hide again
  if (t.dataset.plan) { toggle(state.plan, t.dataset.plan, "plan"); if (state.plan.has(t.dataset.plan)) state.justStarred = t.dataset.plan; render(); return; }
  if (t.dataset.watched) { toggle(state.watched, t.dataset.watched, "watched"); setReveal(t.dataset.watched, state.watched.has(t.dataset.watched)); render(); return; } // marking watched reveals; un-marking re-hides
  if (t.dataset.open) { if (e.target.closest("a, button")) return; state.sheet = t.dataset.open; render(); }  // tap a row (off its controls) → open detail
});
addEventListener("keydown", (e) => { if (e.key === "Escape" && (state.sheet || state.venue)) { state.sheet ? (state.sheet = null) : (state.venue = null); render(); } });
function toggle(set, id, key) { set.has(id) ? set.delete(id) : set.add(id); LS.set(key, [...set]); }

applyTheme(); // render the theme switcher (ICON is defined by now)
setInterval(tickCountdown, 1000); // live next-match countdown
load();
