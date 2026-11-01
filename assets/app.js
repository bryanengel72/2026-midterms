// 2026 Midterm Poll Checker
// Renders data/polls.json: a tile map, a per-state detail view with a poll
// trend chart and tables, and a table of every race. All text that comes from
// the data is inserted with textContent, never as HTML.

const ELECTION = "2026-11-03";
const DAY = 86400000;

// ---------------------------------------------------------------------------
// Motion. Everything here is skipped when the visitor's device asks for
// reduced motion; the page then renders its final state directly.
// ---------------------------------------------------------------------------

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const motionOK = () => !reducedMotion.matches;
const easeOut = (t) => 1 - (1 - t) ** 3;

/** Counts a number up from zero inside `el`, formatted by `fmt`. */
function countUp(el, to, fmt, { duration = 900, delay = 0 } = {}) {
  el.textContent = fmt(to);
  if (!motionOK()) return;
  const decimals = Number.isInteger(to) ? 0 : 1;
  el.textContent = fmt(0);
  const start = performance.now() + delay;
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    const v = to * easeOut(t);
    el.textContent = fmt(t === 1 ? to : Number(v.toFixed(decimals)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Draws a chart's average lines in and pops its poll dots. */
function animateChart(svg) {
  if (!motionOK()) return;
  svg.querySelectorAll("path.avg").forEach((path) => {
    const len = path.getTotalLength();
    path.style.setProperty("--len", len);
    path.classList.add("draw");
  });
  // Dots appear left to right, in step with the lines drawing.
  const width = svg.viewBox.baseVal?.width || 1;
  svg.querySelectorAll("circle.poll-dot").forEach((dot) => {
    dot.style.setProperty("--d", `${Math.round((Number(dot.getAttribute("cx")) / width) * 1200)}ms`);
  });
  svg.classList.add("animate");
}

let mapIntroDone = false;
let lastDetailState = null;
let detailEntering = false;

// 11 x 8 tile grid, roughly geographic. [column, row]
const TILES = {
  AK: [0, 0], ME: [10, 0],
  VT: [9, 1], NH: [10, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], WI: [6, 2], MI: [7, 2], NY: [8, 2], RI: [9, 2], MA: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  HI: [0, 7], TX: [3, 7], FL: [8, 7],
};

const ui = {
  data: null,
  office: "all",
  colorBy: "polls",
  closeOnly: false,
  sort: "close",
  selected: null,
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith("--")) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined) continue;
    el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function safeUrl(url) {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** White or near-black text, whichever reads on the given fill. */
function inkOn(fillVar) {
  const hex = cssVar(fillVar).replace("#", "");
  if (hex.length !== 6) return "var(--text)";
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return L > 0.36 ? "#0b0b0b" : "#ffffff";
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso, withYear = false) {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

function fmtRange(start, end) {
  if (!end) return "–";
  if (!start || start === end) return fmtDate(end);
  const [, m0, d0] = start.split("-").map(Number);
  const [, m1, d1] = end.split("-").map(Number);
  return m0 === m1 ? `${MONTHS[m0 - 1]} ${d0}–${d1}` : `${fmtDate(start)} – ${fmtDate(end)}`;
}

function fmtPct(v) {
  if (typeof v !== "number") return "–";
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
}

function fmtNum(v) {
  if (typeof v !== "number") return "–";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function fmtMargin(m) {
  if (m >= 10) return String(Math.round(m));
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

function surname(name) {
  const parts = name.replace(/\([^)]*\)/g, "").trim().split(/\s+/);
  let last = parts[parts.length - 1];
  if (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && parts.length > 1) last = parts[parts.length - 2];
  return last.replace(/,$/, "");
}

function partyLetter(p) {
  return p === "D" || p === "R" ? p : p === "I" ? "I" : p || "?";
}

const PARTY_NAMES = { D: "Democrat", R: "Republican", I: "Independent", L: "Libertarian", G: "Green", C: "Constitution" };

function partyTag(c) {
  if (c.party === "O" && c.partyName) return c.partyName;
  return partyLetter(c.party);
}

// ---------------------------------------------------------------------------
// Race helpers
// ---------------------------------------------------------------------------

function allRaces() {
  return ui.data.states.flatMap((st) => st.races.map((r) => ({ ...r, state: st })));
}

function inOffice(race) {
  return ui.office === "all" || race.office === ui.office;
}

function isClose(race) {
  return race.headline && race.headline.margin < 5;
}

function candidate(race, name) {
  return race.candidates.find((c) => c.name === name) || { name, party: null };
}

/**
 * Color follows the candidate, never their rank: Democrats blue,
 * Republicans red, the first other-party candidate green, everyone else gray.
 */
function candidateColors(race) {
  const used = new Set();
  const map = new Map();
  for (const c of race.candidates) {
    let v = c.party === "D" ? "--party-d" : c.party === "R" ? "--party-r" : "--party-i";
    if (used.has(v)) v = ["--party-x", "--party-x2"].find((f) => !used.has(f)) || "--party-x";
    used.add(v);
    map.set(c.name, v);
  }
  return map;
}

function leadLabel(race, { short = false } = {}) {
  const hl = race.headline;
  if (!hl) return null;
  if (!hl.leader) return "Tied";
  const c = candidate(race, hl.leader);
  return short ? `${partyLetter(c.party)}+${fmtMargin(hl.margin)}` : `${surname(c.name)} +${fmtMargin(hl.margin)}`;
}

function rampFor(party) {
  return party === "D" ? "d" : party === "R" ? "r" : "i";
}

const RATING_STEP = { Safe: 3, Likely: 2, Lean: 1, Tilt: 1, Tossup: 0 };

/** Map fill + label for a race under the current "color by" mode. */
function tileStyle(race) {
  if (!race) return null;
  if (ui.colorBy === "ratings") {
    const c = race.consensus;
    if (!c) return { fill: null, label: "–" };
    const step = RATING_STEP[c.strength] ?? 0;
    if (step === 0 || !c.lean) return { fill: "--neutral", label: "Toss-up" };
    const word = c.strength === "Likely" ? "Lkly" : c.strength;
    return { fill: `--${rampFor(c.lean)}-${step}`, label: `${word} ${c.lean}` };
  }
  const hl = race.headline;
  if (!hl) return { fill: null, label: "–" };
  if (!hl.leader || hl.margin < 2) return { fill: "--neutral", label: leadLabel(race, { short: true }) };
  const step = hl.margin >= 10 ? 3 : hl.margin >= 5 ? 2 : 1;
  const party = candidate(race, hl.leader).party;
  return { fill: `--${rampFor(party)}-${step}`, label: leadLabel(race, { short: true }) };
}

const BASIS_SHORT = {
  "aggregate-average": "Average of aggregators",
  aggregate: "Aggregator average",
  "simple-average": "Recent polls average",
  "latest-poll": "Latest poll only",
};

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

const tooltip = document.getElementById("tooltip");

function showTooltip(content, x, y) {
  tooltip.replaceChildren(...content);
  tooltip.hidden = false;
  const pad = 12;
  const r = tooltip.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function ttRow(colorVar, value, who) {
  return h(
    "div",
    { class: "tt-row" },
    h("span", { class: "line-key", style: { background: `var(${colorVar})` } }),
    h("strong", {}, value),
    h("span", { class: "who" }, who),
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderHeader() {
  const today = new Date();
  const local = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const eday = Date.parse(`${ELECTION}T00:00:00Z`);
  const days = Math.round((eday - local) / DAY);
  const countdown = document.getElementById("countdown");
  if (days > 0) {
    // Ticks down to midnight (local time) at the start of Election Day.
    const target = new Date(2026, 10, 3).getTime();
    const label = h("span", {}, "Election Day: Tuesday, November 3, 2026");
    const clock = h("span", { class: "clock", "aria-hidden": "true" });
    countdown.replaceChildren(label, " ", clock);
    countdown.setAttribute("aria-label", `Election Day: Tuesday, November 3, 2026, in ${days} day${days === 1 ? "" : "s"}`);
    const pad = (n) => String(n).padStart(2, "0");
    const tick = () => {
      const left = Math.max(0, target - Date.now());
      const d = Math.floor(left / DAY);
      const hh = Math.floor((left % DAY) / 3600000);
      const mm = Math.floor((left % 3600000) / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      clock.textContent = `${d}d ${pad(hh)}h ${pad(mm)}m ${pad(ss)}s to go`;
      if (left === 0) clearInterval(timer);
    };
    tick();
    const timer = setInterval(tick, 1000);
  } else {
    countdown.textContent = days === 0
      ? "Election Day is today, Tuesday, November 3, 2026"
      : "Election Day was Tuesday, November 3, 2026. These are the final pre-election polls";
  }

  const gen = new Date(ui.data.generatedAt);
  const stamp = gen.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const total = allRaces().reduce((n, r) => n + r.polls.length, 0);
  document.getElementById("updated").textContent =
    `${total.toLocaleString()} polls across ${allRaces().length} races · updated ${stamp}`;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function renderLegend() {
  const el = document.getElementById("map-legend");
  const sw = (v, label) =>
    h("span", { class: "legend-item" }, h("span", { class: "swatch", style: { background: `var(${v})` } }), label);
  const groups = [];
  if (ui.colorBy === "polls") {
    groups.push(
      h("div", { class: "legend-group" },
        h("span", { class: "label" }, "Democrat leads by"),
        sw("--d-3", "10+"), sw("--d-2", "5–10"), sw("--d-1", "2–5"),
      ),
      h("div", { class: "legend-group" }, sw("--neutral", "Under 2 points")),
      h("div", { class: "legend-group" },
        h("span", { class: "label" }, "Republican leads by"),
        sw("--r-1", "2–5"), sw("--r-2", "5–10"), sw("--r-3", "10+"),
      ),
    );
    const iLead = allRaces().some((r) => r.headline?.leader && !["D", "R"].includes(candidate(r, r.headline.leader).party));
    if (iLead) groups.push(h("div", { class: "legend-group" }, sw("--i-2", "Independent or third party leads")));
  } else {
    groups.push(
      h("div", { class: "legend-group" },
        h("span", { class: "label" }, "Democrat"),
        sw("--d-3", "Safe"), sw("--d-2", "Likely"), sw("--d-1", "Lean/Tilt"),
      ),
      h("div", { class: "legend-group" }, sw("--neutral", "Toss-up")),
      h("div", { class: "legend-group" },
        h("span", { class: "label" }, "Republican"),
        sw("--r-1", "Lean/Tilt"), sw("--r-2", "Likely"), sw("--r-3", "Safe"),
      ),
    );
  }
  groups.push(
    h("div", { class: "legend-group" },
      h("span", { class: "legend-item" }, h("span", { class: "swatch empty" }), ui.colorBy === "polls" ? "No race, or no polls" : "No race"),
    ),
  );
  el.replaceChildren(...groups);

  const hint = document.getElementById("map-hint");
  hint.textContent =
    ui.office === "all"
      ? "Each tile shows the Senate race on top and the governor race below. Select a state for its polls."
      : `Showing ${ui.office === "Senate" ? "Senate" : "governor"} races. Select a state for its polls.`;
}

function tileTooltip(st) {
  const rows = [h("div", { class: "tt-title" }, st.name)];
  const races = st.races.filter(inOffice);
  if (!races.length) rows.push(h("div", {}, ui.office === "all" ? "No Senate or governor race in 2026" : `No ${ui.office === "Senate" ? "Senate" : "governor"} race in 2026`));
  for (const r of races) {
    const colors = candidateColors(r);
    rows.push(h("div", { class: "tt-sub" }, r.label));
    if (r.headline) {
      const top = Object.entries(r.headline.values).sort((a, b) => b[1] - a[1]).slice(0, 3);
      for (const [name, v] of top) {
        const c = candidate(r, name);
        rows.push(ttRow(colors.get(name) || "--party-x", fmtPct(v), `${surname(name)} (${partyTag(c)})`));
      }
    } else {
      rows.push(h("div", {}, "No general election polls"));
    }
    if (r.consensus) rows.push(h("div", { class: "tt-sub" }, `Forecasters: ${r.consensus.rating}`));
  }
  return rows;
}

function renderMap() {
  const map = document.getElementById("tile-map");
  // Remember each band's current fill so a re-render can fade between colors.
  const previous = new Map();
  for (const tile of map.querySelectorAll(".tile[data-code]")) {
    previous.set(tile.dataset.code, [...tile.querySelectorAll(".band")].map((b) => b.dataset.fill || ""));
  }
  const tiles = [];
  const offices = ui.office === "all" ? ["Senate", "Governor"] : [ui.office];
  for (const st of ui.data.states) {
    const pos = TILES[st.code];
    if (!pos) continue;
    const bands = offices.map((office) => {
      const race = st.races.find((r) => r.office === office);
      const style = tileStyle(race);
      const officeName = office === "Senate" ? "Senate" : "Governor";
      if (!race || !style.fill) {
        return h("span", { class: "band none", "aria-hidden": "true", title: race ? `${officeName}: no polls` : `No ${officeName.toLowerCase()} race` }, race ? "–" : "");
      }
      return h(
        "span",
        { class: "band", "aria-hidden": "true", "data-fill": style.fill, style: { background: `var(${style.fill})`, color: inkOn(style.fill) } },
        style.label,
      );
    });
    const scoped = st.races.filter(inOffice);
    const relevant = scoped.length > 0 && (!ui.closeOnly || scoped.some(isClose));
    const summary = scoped.length
      ? scoped.map((r) => `${r.label}: ${r.headline ? leadLabel(r) : "no polls"}${r.consensus ? `, forecasters ${r.consensus.rating}` : ""}`).join("; ")
      : "no race";
    const tile = h(
      "button",
      {
        type: "button",
        "data-code": st.code,
        class: `tile${offices.length === 1 ? " single" : ""}${relevant ? "" : " dim"}${ui.selected === st.code ? " selected" : ""}`,
        style: { gridColumn: pos[0] + 1, gridRow: pos[1] + 1, "--i": pos[0] + pos[1] * 2 },
        "aria-label": `${st.name}. ${summary}`,
        "aria-pressed": ui.selected === st.code ? "true" : "false",
        onclick: () => selectState(st.code, true),
        onpointermove: (e) => showTooltip(tileTooltip(st), e.clientX, e.clientY),
        onpointerleave: hideTooltip,
        onfocus: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          showTooltip(tileTooltip(st), r.right, r.top);
        },
        onblur: hideTooltip,
      },
      h("span", { class: "code", "aria-hidden": "true" }, st.code),
      bands,
    );
    tiles.push(tile);
  }
  if (ui.office === "all") {
    const sample = h("div", { class: "tile", "aria-hidden": "true" },
      h("span", { class: "code" }, "ST"),
      h("span", { class: "band none" }, ""),
      h("span", { class: "band none" }, ""),
    );
    tiles.push(
      h("div", { class: "map-key", style: { gridColumn: "3 / 8", gridRow: "1 / 3" } },
        sample,
        h("ul", {}, h("li", {}, "Top: U.S. Senate"), h("li", {}, "Bottom: Governor")),
      ),
    );
  }
  // Start changed bands at their old color, then let CSS transition them.
  const pending = [];
  if (motionOK() && mapIntroDone) {
    for (const tile of tiles) {
      const old = previous.get(tile.dataset?.code);
      if (!old) continue;
      tile.querySelectorAll(".band").forEach((band, i) => {
        const from = old[i];
        const to = band.dataset.fill;
        if (from && to && from !== to) {
          band.style.background = `var(${from})`;
          pending.push([band, to]);
        }
      });
    }
  }
  map.classList.toggle("intro", motionOK() && !mapIntroDone);
  map.replaceChildren(...tiles);
  if (!mapIntroDone) {
    mapIntroDone = true;
    setTimeout(() => map.classList.remove("intro"), 1400);
  }
  if (pending.length) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const [band, to] of pending) band.style.background = `var(${to})`;
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Senate seat chart
// ---------------------------------------------------------------------------

/**
 * Where each 2026 Senate race stands, under the current "color by" mode:
 * the polling leader (toss-up if within 2 points; forecasters' lean when a
 * race has no polls) or the forecasters' consensus.
 */
function senateCall(race) {
  const byRating = () => {
    const c = race.consensus;
    if (!c || !c.lean || c.strength === "Tossup") return { side: "T", strength: 0, basis: c ? `Forecasters: ${c.rating}` : "No polls or ratings" };
    return { side: c.lean, strength: RATING_STEP[c.strength] ?? 1, basis: `Forecasters: ${c.rating}` };
  };
  if (ui.colorBy === "ratings") return byRating();
  const hl = race.headline;
  if (!hl) return { ...byRating(), basis: `No polls; forecasters: ${race.consensus?.rating || "none"}` };
  const leader = hl.leader ? candidate(race, hl.leader) : null;
  if (!leader || hl.margin < 2) return { side: "T", strength: 0, basis: `Polls: ${leadLabel(race)}`, lean: leader?.party };
  return { side: leader.party === "D" || leader.party === "R" ? leader.party : "I", strength: hl.margin, basis: `Polls: ${leadLabel(race)}` };
}

/** Seat centers for a 100-seat half circle, ordered left to right. */
function hemicycle(total, rows, width) {
  const R = width / 2;
  const r0 = R * 0.42;
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((R - r0) * i) / (rows - 1));
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.round((total * r) / sum));
  counts[rows - 1] += total - counts.reduce((a, b) => a + b, 0);
  const seats = [];
  radii.forEach((r, i) => {
    const n = counts[i];
    for (let j = 0; j < n; j++) {
      const a = Math.PI - (j * Math.PI) / (n - 1);
      seats.push({ a, x: R + r * Math.cos(a), y: R - r * Math.sin(a), row: i });
    }
  });
  seats.sort((p, q) => q.a - p.a || p.row - q.row);
  const dot = ((R - r0) / (rows - 1)) * 0.42;
  return { seats, dot, R };
}

let senateIntroDone = false;

function renderSenate() {
  const card = document.getElementById("senate-card");
  const makeup = ui.data.senate;
  if (!makeup || ui.office === "Governor") {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const races = allRaces().filter((r) => r.office === "Senate");
  const calls = races.map((r) => ({ race: r, ...senateCall(r) }));
  const pick = (side) => calls.filter((c) => c.side === side);
  // Left to right: Democrats not up, independents caucusing with them,
  // Democratic-leaning races (safest first), toss-ups, Republican-leaning
  // races (closest first), Republicans not up. Other independents sit
  // between the toss-ups and the Republicans.
  const order = [
    ...Array.from({ length: makeup.notUp.D }, () => ({ kind: "held", side: "D" })),
    ...Array.from({ length: makeup.notUp.I }, () => ({ kind: "held", side: "IC" })),
    ...pick("D").sort((a, b) => b.strength - a.strength).map((c) => ({ kind: "up", ...c })),
    ...pick("T").map((c) => ({ kind: "up", ...c })),
    ...pick("I").map((c) => ({ kind: "up", ...c })),
    ...pick("R").sort((a, b) => a.strength - b.strength).map((c) => ({ kind: "up", ...c })),
    ...Array.from({ length: makeup.notUp.R }, () => ({ kind: "held", side: "R" })),
  ];
  const width = 520;
  const { seats, dot, R } = hemicycle(order.length, 6, width);
  const fillFor = (o) =>
    o.side === "D" ? "--party-d" : o.side === "R" ? "--party-r" : o.side === "IC" || o.side === "I" ? "--party-i" : "--neutral";

  const svg = s("svg", {
    class: "senate-svg",
    viewBox: `${-dot * 2} ${-dot * 3} ${width + dot * 4} ${R + dot * 5}`,
    role: "img",
    "aria-label": "Senate seat chart. The counts beside it list every group of seats.",
  });
  const intro = motionOK() && !senateIntroDone;
  order.forEach((o, i) => {
    const p = seats[i];
    const c = s("circle", {
      class: `seat ${o.kind}${o.side === "T" ? " tossup" : ""}`,
      cx: p.x.toFixed(1),
      cy: p.y.toFixed(1),
      r: dot.toFixed(1),
      style: `fill: var(${fillFor(o)}); --d: ${Math.round((i / order.length) * 900)}ms`,
    });
    if (o.kind === "up") {
      c.setAttribute("tabindex", "0");
      const st = o.race.state;
      const tip = () => [
        h("div", { class: "tt-title" }, `${st.name}: ${o.race.label}`),
        h("div", {}, o.side === "T" ? "Toss-up" : `Leans ${PARTY_NAMES[o.side] || "Independent"}`),
        h("div", { class: "tt-sub" }, o.basis),
        h("div", { class: "tt-sub" }, `Held now by: ${o.race.incumbent ? `${o.race.incumbent.name} (${partyLetter(o.race.incumbent.party)})` : "unknown"}`),
      ];
      c.addEventListener("pointermove", (e) => showTooltip(tip(), e.clientX, e.clientY));
      c.addEventListener("pointerleave", hideTooltip);
      c.addEventListener("focus", () => {
        const b = c.getBoundingClientRect();
        showTooltip(tip(), b.right, b.top);
      });
      c.addEventListener("blur", hideTooltip);
      c.addEventListener("click", () => selectState(st.code, true));
      c.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectState(st.code, true);
        }
      });
    } else {
      const label = o.side === "IC" ? "Independent (caucuses with Democrats)" : PARTY_NAMES[o.side];
      c.addEventListener("pointermove", (e) =>
        showTooltip([h("div", { class: "tt-title" }, `${label}: not up in 2026`)], e.clientX, e.clientY),
      );
      c.addEventListener("pointerleave", hideTooltip);
    }
    svg.append(c);
  });
  // Majority line: the 51st seat from either side meets in the middle.
  svg.append(
    s("line", { class: "senate-mid", x1: R, x2: R, y1: -dot * 2.6, y2: -dot * 1.25 }),
    s("text", { class: "senate-mid-label", x: R, y: R + dot * 0.5, "text-anchor": "middle" }, "50 | 50"),
  );
  if (intro) svg.classList.add("intro");
  senateIntroDone = true;
  document.getElementById("senate-chart").replaceChildren(svg);

  // Counts
  const dLean = pick("D").length;
  const rLean = pick("R").length;
  const iLean = pick("I").length;
  const toss = pick("T").length;
  const dTotal = makeup.notUp.D + makeup.notUp.I + dLean;
  const rTotal = makeup.notUp.R + rLean;
  // If every toss-up went to whoever leads in it, however narrowly.
  let dIf = dTotal;
  let rIf = rTotal;
  let iIf = iLean;
  let tied = 0;
  for (const c of pick("T")) {
    if (c.lean === "D") dIf++;
    else if (c.lean === "R") rIf++;
    else if (c.lean) iIf++;
    else tied++;
  }
  const row = (fill, label, n, extra, held = false) =>
    h("div", { class: "seat-row" },
      h("span", { class: `swatch${held ? " held" : ""}${fill === "--neutral" ? " tossup" : ""}`, style: { background: `var(${fill})` } }),
      h("span", { class: "seat-label" }, label, extra ? h("small", {}, extra) : null),
      h("span", { class: "seat-n", "data-count": n }, String(n)),
    );
  const summary = document.getElementById("senate-summary");
  const parts = [
    h("div", { class: "seat-totals" },
      h("div", { class: "big d" }, h("span", { "data-count": dTotal }, String(dTotal)), h("small", {}, "Democrats + allies")),
      h("div", { class: "big t" }, h("span", { "data-count": toss }, String(toss)), h("small", {}, "Toss-ups")),
      h("div", { class: "big r" }, h("span", { "data-count": rTotal }, String(rTotal)), h("small", {}, "Republicans")),
    ),
    row("--party-d", "Democrats, not up", makeup.notUp.D, null, true),
    row("--party-i", "Independents who caucus with Democrats, not up", makeup.notUp.I, null, true),
    row("--party-d", ui.colorBy === "ratings" ? "Races leaning Democratic" : "Races where a Democrat leads", dLean, ui.colorBy === "ratings" ? null : " by 2+ points"),
    row("--neutral", "Toss-ups", toss, ui.colorBy === "ratings" ? " (rated Toss-up)" : " (lead under 2 points)"),
    iLean ? row("--party-i", "Races an independent leads", iLean) : null,
    row("--party-r", ui.colorBy === "ratings" ? "Races leaning Republican" : "Races where a Republican leads", rLean, ui.colorBy === "ratings" ? null : " by 2+ points"),
    row("--party-r", "Republicans, not up", makeup.notUp.R, null, true),
  ];
  if (ui.colorBy !== "ratings" && toss) {
    parts.push(h("p", { class: "seat-note" },
      `If every toss-up went to whoever is ahead, even slightly: `,
      h("strong", {}, `Democrats + allies ${dIf}, Republicans ${rIf}`),
      iIf ? `, independents ${iIf}` : "",
      tied ? `, with ${tied} race${tied === 1 ? "" : "s"} tied` : "",
      "."));
  }
  parts.push(h("p", { class: "seat-note" },
    "Control: 51 seats wins outright. At 50–50 the vice president, a Republican, breaks ties, so Democrats need 51 and Republicans 50."));
  summary.replaceChildren(...parts.filter(Boolean));
  if (intro) summary.querySelectorAll("[data-count]").forEach((el, i) => countUp(el, Number(el.dataset.count), String, { delay: 300 + i * 40, duration: 1000 }));

  document.getElementById("senate-hint").textContent =
    ui.colorBy === "ratings"
      ? "Each of the 35 seats on the ballot is shaded by forecasters' consensus rating; faded seats aren't up this year. Not a prediction."
      : "Each of the 35 seats on the ballot goes to whoever leads its polling average (forecasters' lean where there are no polls); faded seats aren't up this year. Not a prediction. Tap a seat for its race.";
}

// ---------------------------------------------------------------------------
// Trend chart
// ---------------------------------------------------------------------------

function rollingAverage(polls, names, windowDays = 30) {
  const dated = polls.filter((p) => p.end).slice().sort((a, b) => a.end.localeCompare(b.end));
  const dates = [...new Set(dated.map((p) => p.end))];
  const series = [];
  for (const d of dates) {
    const t = Date.parse(d);
    const inWindow = dated.filter((p) => {
      const pt = Date.parse(p.end);
      return pt <= t && pt > t - windowDays * DAY;
    });
    const newest = new Map();
    for (const p of inWindow) newest.set(p.pollster.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase(), p);
    const used = [...newest.values()];
    const values = {};
    for (const n of names) {
      const nums = used.map((p) => p.values[n]).filter((v) => typeof v === "number");
      if (nums.length) values[n] = nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    series.push({ date: d, t, values, count: used.length });
  }
  return series;
}

function niceStep(range) {
  return range > 40 ? 10 : 5;
}

function renderTrend(race, colors, mount) {
  const names = race.candidates
    .filter((c) => {
      const v = race.headline?.values[c.name];
      return typeof v === "number" ? v >= 5 : false;
    })
    .slice(0, 4)
    .map((c) => c.name);
  if (names.length < 2) return null;

  // Focus on the last six months when there is enough polling there;
  // otherwise reach back up to 18 months.
  const recentT = Date.parse(ELECTION) - 183 * DAY;
  const recent = race.polls.filter((p) => p.end && Date.parse(p.end) >= recentT);
  const minT = recent.length >= 6 ? recentT : Date.parse(ELECTION) - 540 * DAY;
  const polls = race.polls.filter((p) => p.end && Date.parse(p.end) >= minT);
  if (polls.length < 3) return null;

  const avg = rollingAverage(polls, names);
  const width = Math.max(300, Math.floor(mount.clientWidth || 520));
  const height = 230;
  const m = { top: 12, right: 92, bottom: 26, left: 34 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;

  const t0 = recent.length >= 6 ? recentT : Math.min(...polls.map((p) => Date.parse(p.end)));
  const t1 = Date.parse(ELECTION);
  const span = Math.max(t1 - t0, 30 * DAY);
  const x = (t) => m.left + ((t - t0) / span) * iw;

  const vals = polls.flatMap((p) => names.map((n) => p.values[n]).filter((v) => typeof v === "number"));
  const step = niceStep(Math.max(...vals) - Math.min(...vals));
  const y0 = Math.max(0, Math.floor((Math.min(...vals) - 2) / step) * step);
  const y1 = Math.min(100, Math.ceil((Math.max(...vals) + 2) / step) * step);
  const y = (v) => m.top + ih - ((v - y0) / (y1 - y0)) * ih;

  const svg = s("svg", {
    class: "trend",
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    tabindex: "0",
    "aria-label": `Poll trend for ${race.label}: each dot is one poll, lines are 30-day averages. Use the arrow keys to step through poll dates. The polls table below lists every value.`,
  });

  // Gridlines and y axis
  const grid = s("g", { class: "grid" });
  const axis = s("g", { class: "axis" });
  for (let v = y0; v <= y1; v += step) {
    grid.append(s("line", { x1: m.left, x2: m.left + iw, y1: y(v), y2: y(v) }));
    axis.append(s("text", { x: m.left - 6, y: y(v) + 4, "text-anchor": "end" }, `${v}%`));
  }
  // Month ticks
  const start = new Date(t0);
  let tick = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  const months = [];
  while (tick <= t1) {
    months.push(tick);
    const d = new Date(tick);
    tick = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const every = Math.ceil(months.length / Math.max(2, Math.floor(iw / 60)));
  const multiYear = new Date(t0).getUTCFullYear() !== new Date(t1).getUTCFullYear();
  months.forEach((mt, i) => {
    if (i % every !== 0) return;
    const d = new Date(mt);
    // Months only; add the year where it changes (or on the first tick) when
    // the chart spans more than one year.
    const label =
      multiYear && (d.getUTCMonth() === 0 || i === 0)
        ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
        : MONTHS[d.getUTCMonth()];
    axis.append(s("text", { x: x(mt), y: m.top + ih + 18, "text-anchor": "middle" }, label));
  });
  svg.append(grid, s("line", { class: "baseline", x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih }), axis);

  // Election day marker
  svg.append(
    s("line", { class: "eday", x1: x(t1), x2: x(t1), y1: m.top, y2: m.top + ih }),
    s("text", { class: "eday-label", x: x(t1) + 4, y: m.top + 10 }, "Nov 3"),
  );

  // Poll dots (behind), then average lines
  const dots = s("g");
  for (const p of polls) {
    for (const n of names) {
      const v = p.values[n];
      if (typeof v !== "number") continue;
      dots.append(s("circle", { class: "poll-dot", cx: x(Date.parse(p.end)), cy: y(v), r: 4, fill: `var(${colors.get(n)})` }));
    }
  }
  svg.append(dots);

  const lines = s("g");
  const ends = [];
  for (const n of names) {
    const pts = avg.filter((a) => typeof a.values[n] === "number");
    if (!pts.length) continue;
    const d = pts.map((a, i) => `${i ? "L" : "M"}${x(a.t).toFixed(1)},${y(a.values[n]).toFixed(1)}`).join("");
    lines.append(s("path", { class: "avg", d, stroke: `var(${colors.get(n)})` }));
    const last = pts[pts.length - 1];
    ends.push({ n, cx: x(last.t), cy: y(last.values[n]), v: last.values[n] });
  }
  svg.append(lines);
  for (const e of ends) {
    svg.append(s("circle", { class: "end-dot", cx: e.cx, cy: e.cy, r: 4, fill: `var(${colors.get(e.n)})` }));
  }
  // Direct end labels, only when they do not collide.
  const sorted = [...ends].sort((a, b) => a.cy - b.cy);
  const collide = sorted.some((e, i) => i > 0 && e.cy - sorted[i - 1].cy < 14);
  if (!collide) {
    for (const e of ends) {
      svg.append(s("text", { class: "end-label", x: e.cx + 8, y: e.cy + 4 }, `${surname(e.n)} ${Math.round(e.v)}`));
    }
  }

  // Hover / focus layer: the crosshair snaps to the nearest poll date.
  const cross = s("line", { class: "crosshair", y1: m.top, y2: m.top + ih, visibility: "hidden" });
  const hoverDots = names.map((n) => s("circle", { class: "hover-dot", r: 5, fill: `var(${colors.get(n)})`, visibility: "hidden" }));
  svg.append(cross, ...hoverDots);
  const hit = s("rect", { x: m.left, y: m.top, width: iw + 12, height: ih, fill: "transparent" });
  svg.append(hit);

  let index = -1;
  const show = (i, clientX, clientY) => {
    index = Math.max(0, Math.min(avg.length - 1, i));
    const a = avg[index];
    const cx = x(a.t);
    cross.setAttribute("x1", cx);
    cross.setAttribute("x2", cx);
    cross.setAttribute("visibility", "visible");
    names.forEach((n, k) => {
      const v = a.values[n];
      if (typeof v === "number") {
        hoverDots[k].setAttribute("cx", cx);
        hoverDots[k].setAttribute("cy", y(v));
        hoverDots[k].setAttribute("visibility", "visible");
      } else hoverDots[k].setAttribute("visibility", "hidden");
    });
    const rows = [h("div", { class: "tt-title" }, `${fmtDate(a.date, true)} · 30-day average of ${a.count} poll${a.count === 1 ? "" : "s"}`)];
    names
      .filter((n) => typeof a.values[n] === "number")
      .sort((p, q) => a.values[q] - a.values[p])
      .forEach((n) => rows.push(ttRow(colors.get(n), fmtPct(Math.round(a.values[n] * 10) / 10), surname(n))));
    const sameDay = polls.filter((p) => p.end === a.date);
    for (const p of sameDay.slice(0, 3)) {
      const parts = names.map((n) => fmtNum(p.values[n])).join("–");
      rows.push(h("div", { class: "tt-sub" }, `${p.pollster}: ${parts}`));
    }
    if (sameDay.length > 3) rows.push(h("div", { class: "tt-sub" }, `and ${sameDay.length - 3} more`));
    if (clientX === undefined) {
      const box = svg.getBoundingClientRect();
      clientX = box.left + (cx / width) * box.width;
      clientY = box.top + 10;
    }
    showTooltip(rows, clientX, clientY);
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    hoverDots.forEach((d) => d.setAttribute("visibility", "hidden"));
    hideTooltip();
  };
  svg.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    let bestD = Infinity;
    avg.forEach((a, i) => {
      const d = Math.abs(x(a.t) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    show(best, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("focus", () => show(avg.length - 1));
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { show(index - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { show(index + 1); e.preventDefault(); }
    else if (e.key === "Home") { show(0); e.preventDefault(); }
    else if (e.key === "End") { show(avg.length - 1); e.preventDefault(); }
    else if (e.key === "Escape") hide();
  });

  const legend = h(
    "div",
    { class: "chart-legend" },
    names.map((n) =>
      h("span", {}, h("span", { class: "line-key", style: { background: `var(${colors.get(n)})` } }), `${surname(n)} (${partyTag(candidate(race, n))}) 30-day average`),
    ),
    h("span", {}, h("span", { class: "dot-key", style: { background: "var(--text-2)" } }), "Individual polls"),
  );
  return h("div", { class: "chart-wrap" }, legend, svg);
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function polledNames(race, rows) {
  const seen = new Set(rows.flatMap((p) => Object.keys(p.values)));
  return race.candidates.filter((c) => seen.has(c.name)).map((c) => c.name);
}

function leadCell(race, values) {
  const ranked = Object.entries(values)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length < 2) return "–";
  const diff = Math.round((ranked[0][1] - ranked[1][1]) * 10) / 10;
  if (diff === 0) return "Tie";
  return `${surname(ranked[0][0])} +${fmtNum(diff)}`;
}

function candHeader(race, name) {
  const c = candidate(race, name);
  return h("th", { scope: "col", class: "num" }, `${surname(name)} (${partyTag(c)})`);
}

function pollsTable(race) {
  const names = polledNames(race, race.polls);
  const hasOther = race.polls.some((p) => typeof p.other === "number");
  const hasUnd = race.polls.some((p) => typeof p.undecided === "number");
  const LIMIT = 10;
  const tbody = h("tbody");
  const rowFor = (p) =>
    h(
      "tr",
      {},
      h("td", { class: "pollster" }, p.pollster),
      h("td", { class: "num" }, fmtRange(p.start, p.end)),
      h("td", { class: "num" }, p.sample ? `${p.sample.toLocaleString()}${p.population ? ` ${p.population}` : ""}` : p.population || "–"),
      h("td", { class: "num" }, typeof p.moe === "number" ? `±${p.moe}` : "–"),
      names.map((n) => h("td", { class: "num" }, fmtPct(p.values[n]))),
      hasOther ? h("td", { class: "num" }, fmtPct(p.other)) : null,
      hasUnd ? h("td", { class: "num" }, fmtPct(p.undecided)) : null,
      h("td", { class: "num lead-cell" }, leadCell(race, p.values)),
    );
  const fill = (all) => tbody.replaceChildren(...(all ? race.polls : race.polls.slice(0, LIMIT)).map(rowFor));
  fill(false);

  const table = h(
    "table",
    { class: "data" },
    h("caption", { class: "visually-hidden", style: { position: "absolute", left: "-9999px" } }, `General election polls, ${race.label}`),
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col" }, "Pollster"),
        h("th", { scope: "col", class: "num" }, "Dates"),
        h("th", { scope: "col", class: "num" }, "Sample"),
        h("th", { scope: "col", class: "num" }, "MoE"),
        names.map((n) => candHeader(race, n)),
        hasOther ? h("th", { scope: "col", class: "num" }, "Other") : null,
        hasUnd ? h("th", { scope: "col", class: "num" }, "Undecided") : null,
        h("th", { scope: "col", class: "num" }, "Lead"),
      ),
    ),
    tbody,
  );
  const wrap = h("div", {}, h("div", { class: "table-scroll" }, table));
  if (race.polls.length > LIMIT) {
    let open = false;
    const btn = h("button", { type: "button", class: "linkish" }, `Show all ${race.polls.length} polls`);
    btn.addEventListener("click", () => {
      open = !open;
      fill(open);
      btn.textContent = open ? `Show the latest ${LIMIT}` : `Show all ${race.polls.length} polls`;
    });
    wrap.append(h("div", { class: "table-actions" }, btn));
  }
  wrap.append(
    h("p", { class: "hint", style: { marginTop: "6px" } },
      "LV = likely voters, RV = registered voters, A = adults. (D) or (R) after a pollster's name marks a partisan pollster or a poll paid for by a partisan sponsor."),
  );
  return wrap;
}

function aggregatesTable(race) {
  const names = polledNames(race, race.aggregates);
  const hasOU = race.aggregates.some((a) => typeof a.otherUndecided === "number");
  const rows = race.aggregates.map((a) =>
    h(
      "tr",
      { class: a.isAverage ? "avg-row" : null },
      h("td", {}, a.isAverage ? "Average" : a.source),
      h("td", { class: "num" }, a.isAverage ? "" : a.dates.replace(/^through\s+/i, "through ").replace(/, 2026/g, "")),
      h("td", { class: "num" }, a.isAverage ? "" : fmtDate(a.updatedIso)),
      names.map((n) => h("td", { class: "num" }, fmtPct(a.values[n]))),
      hasOU ? h("td", { class: "num" }, fmtPct(a.otherUndecided)) : null,
      h("td", { class: "num lead-cell" }, leadCell(race, a.values)),
    ),
  );
  return h(
    "div",
    { class: "table-scroll" },
    h(
      "table",
      { class: "data" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { scope: "col" }, "Aggregator"),
          h("th", { scope: "col", class: "num" }, "Polls from"),
          h("th", { scope: "col", class: "num" }, "Updated"),
          names.map((n) => candHeader(race, n)),
          hasOU ? h("th", { scope: "col", class: "num" }, "Other / undecided") : null,
          h("th", { scope: "col", class: "num" }, "Lead"),
        ),
      ),
      h("tbody", {}, rows),
    ),
  );
}

// ---------------------------------------------------------------------------
// State detail
// ---------------------------------------------------------------------------

function ratingSwatch(r) {
  if (!r || !r.lean || r.strength === "Tossup") return "--neutral";
  return `--${rampFor(r.lean)}-${RATING_STEP[r.strength] ?? 1}`;
}

function raceCard(race) {
  const colors = candidateColors(race);
  const hl = race.headline;
  const card = h("article", { class: "card race", "aria-label": `${race.state.name} ${race.label}` });
  const url = safeUrl(race.url);
  card.append(
    h("div", { class: "race-title" },
      h("h3", {}, race.label),
      url ? h("a", { href: url, target: "_blank", rel: "noopener" }, "Wikipedia article") : null,
    ),
  );
  const bits = [];
  if (race.incumbent) bits.push(`Incumbent: ${race.incumbent.name} (${partyLetter(race.incumbent.party)})`);
  bits.push(`${race.polls.length} general election poll${race.polls.length === 1 ? "" : "s"}`);
  if (race.latestPoll) bits.push(`latest ended ${fmtDate(race.latestPoll)}`);
  if (race.stale) bits.push("could not refresh, showing last good data");
  card.append(h("p", { class: "race-sub" }, bits.join(" · ")));

  const summary = h("div", { class: "race-summary" });
  const chartCol = h("div", { class: "race-chart" });
  card.append(h("div", { class: "race-top" }, summary, chartCol));

  if (hl) {
    const ranked = Object.entries(hl.values).sort((a, b) => b[1] - a[1]);
    const standings = h("div", { class: "standings" });
    ranked.forEach(([name, v], i) => {
      const c = candidate(race, name);
      const isInc = race.incumbent && race.incumbent.name === name;
      standings.append(
        h("div", { class: `standing${i === 0 && hl.leader ? " lead" : ""}` },
          h("span", { class: "swatch", style: { background: `var(${colors.get(name)})` } }),
          h("span", { class: "name" },
            `${name} `,
            h("small", {}, `(${partyTag(c)})${isInc ? " · incumbent" : ""}${c.note ? ` · ${c.note}` : ""}`),
          ),
          h("span", { class: "value", "data-count": v }, fmtPct(v)),
        ),
      );
    });
    const sum = ranked.reduce((a, [, v]) => a + v, 0);
    const bar = h("div", {
      class: "split-bar",
      role: "img",
      "aria-label": ranked.map(([n, v]) => `${n} ${fmtPct(v)}`).join(", ") + (sum < 100 ? `, other or undecided ${fmtPct(Math.round((100 - sum) * 10) / 10)}` : ""),
    });
    for (const [name, v] of ranked) {
      bar.append(h("span", { style: { width: `${v}%`, background: `var(${colors.get(name)})` } }));
    }
    if (sum < 100) bar.append(h("span", { class: "rest", style: { width: `${100 - sum}%` } }));
    summary.append(
      standings,
      bar,
      h("p", { class: "headline-note" }, h("strong", {}, leadLabel(race)), ` · ${hl.detail}`),
    );
  } else {
    summary.append(
      h("div", { class: "no-polls" },
        "No public general election polls have been listed for this race.",
        race.consensus ? ` Forecasters rate it ${race.consensus.rating}.` : "",
      ),
    );
  }

  if (race.ratings.length) {
    const c = race.consensus;
    summary.append(
      h("h4", {}, "Forecasters"),
      h("div", { class: "rating-line" },
        h("span", { class: "chip" }, h("span", { class: "swatch", style: { background: `var(${ratingSwatch(c)})` } }), c.rating),
        h("span", { class: "hint" }, `${c.count} of ${c.of} forecasters`),
      ),
      h("details", {},
        h("summary", {}, "Every rating"),
        h("ul", { class: "ratings-list" },
          race.ratings.map((r) =>
            h("li", {},
              h("span", { class: "src" }, r.source),
              h("span", {}, `${r.rating}${r.flip ? " (flip)" : ""}`, r.asOf ? h("span", { class: "hint" }, ` · ${r.asOf.replace(/, 2026$/, "")}`) : null),
            ),
          ),
        ),
      ),
    );
  }

  if (race.polls.length >= 3) {
    const chartMount = h("div", {});
    chartCol.append(h("h4", {}, "Poll trend"), chartMount);
    // Size the chart once the card is in the document.
    requestAnimationFrame(() => {
      const chart = renderTrend(race, colors, chartMount);
      if (chart) {
        chartMount.replaceChildren(chart);
        if (detailEntering) animateChart(chart.querySelector("svg"));
      }
      else chartMount.previousSibling?.remove();
    });
  }

  if (race.aggregates.length) {
    card.append(h("h4", {}, "Polling averages"), aggregatesTable(race));
  }
  if (race.polls.length) {
    card.append(h("h4", {}, "Polls, newest first"), pollsTable(race));
  }
  return card;
}

function renderDetail({ scroll = false } = {}) {
  const el = document.getElementById("state-detail");
  const st = ui.data.states.find((x) => x.code === ui.selected);
  if (!st) {
    el.replaceChildren();
    lastDetailState = null;
    return;
  }
  const races = st.races.filter(inOffice).map((r) => ({ ...r, state: st }));
  const house = safeUrl(st.houseUrl);
  const head = h(
    "div",
    { class: "state-head" },
    h("h2", {}, st.name),
    h("p", { class: "hint" },
      `${st.races.length ? `${st.races.length} statewide race${st.races.length === 1 ? "" : "s"} · ` : ""}All U.S. House seats are also on the ballot: `,
      house ? h("a", { href: house, target: "_blank", rel: "noopener" }, "House races") : "House races",
      " · ",
      h("button", { type: "button", class: "linkish", onclick: () => selectState(null) }, "Close"),
    ),
  );
  let body;
  if (!st.races.length) {
    body = h("div", { class: "card no-polls" }, `${st.name} has no U.S. Senate or governor election in 2026.`);
  } else if (!races.length) {
    body = h("div", { class: "card no-polls" },
      `${st.name} has no ${ui.office === "Senate" ? "Senate" : "governor"} race in 2026. Switch the office filter to Both to see its other race.`);
  } else {
    body = h("div", { class: "race-grid" }, races.map((r, i) => {
      const card = raceCard(r);
      card.style.setProperty("--i", i);
      return card;
    }));
  }
  // Animate only when a different state opens, not on filter or resize redraws.
  detailEntering = motionOK() && st.code !== lastDetailState;
  lastDetailState = st.code;
  el.classList.remove("enter");
  el.replaceChildren(head, body);
  if (detailEntering) {
    void el.offsetWidth; // restart the CSS entrance animations
    el.classList.add("enter");
    el.querySelectorAll(".race").forEach((card, i) => {
      card.querySelectorAll("[data-count]").forEach((v) =>
        countUp(v, Number(v.dataset.count), fmtPct, { delay: 150 + i * 120 }),
      );
    });
  }
  if (scroll) {
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }
}

// ---------------------------------------------------------------------------
// All races table
// ---------------------------------------------------------------------------

function renderRacesTable() {
  let races = allRaces().filter(inOffice);
  if (ui.closeOnly) races = races.filter(isClose);
  const byState = (a, b) => a.state.name.localeCompare(b.state.name) || a.office.localeCompare(b.office);
  if (ui.sort === "state") races.sort(byState);
  else if (ui.sort === "recent") races.sort((a, b) => (b.latestPoll || "").localeCompare(a.latestPoll || "") || byState(a, b));
  else {
    races.sort((a, b) => {
      const ma = a.headline ? a.headline.margin : Infinity;
      const mb = b.headline ? b.headline.margin : Infinity;
      return ma - mb || byState(a, b);
    });
  }
  const rows = races.map((r) => {
    const colors = candidateColors(r);
    const leader = r.headline?.leader ? candidate(r, r.headline.leader) : null;
    const go = () => selectState(r.state.code, true);
    return h(
      "tr",
      { onclick: go },
      h("td", {}, h("a", { href: `#${r.state.code}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); go(); } }, r.state.name)),
      h("td", {}, r.label),
      h("td", { class: "avg-cell" },
        r.headline
          ? Object.entries(r.headline.values)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([name, v]) => {
                const c = candidate(r, name);
                return h("span", { class: `leader${name === leader?.name ? " is-lead" : ""}` },
                  h("span", { class: "swatch", style: { background: `var(${colors.get(name)})` } }),
                  h("span", { class: "pct" }, fmtPct(v)),
                  h("span", { class: "who" }, `${surname(name)} (${partyTag(c)})`),
                );
              })
          : h("span", { class: "sub" }, "No polls"),
      ),
      h("td", { class: "num lead-cell" }, r.headline ? (r.headline.leader ? `+${fmtMargin(r.headline.margin)}` : "0") : "–"),
      h("td", {}, r.headline ? BASIS_SHORT[r.headline.basis] || "" : "–"),
      h("td", {}, r.consensus ? `${r.consensus.rating} (${r.consensus.count}/${r.consensus.of})` : "–"),
      h("td", { class: "num" }, fmtDate(r.latestPoll)),
    );
  });
  rows.forEach((row, i) => row.style.setProperty("--i", Math.min(i, 24)));
  const tbody = document.querySelector("#races-table tbody");
  tbody.classList.remove("fresh");
  tbody.replaceChildren(...rows);
  if (motionOK()) {
    void tbody.offsetWidth;
    tbody.classList.add("fresh");
  }
  const close = allRaces().filter(inOffice).filter(isClose).length;
  document.getElementById("races-count").textContent =
    `${races.length} race${races.length === 1 ? "" : "s"} shown. ${close} ${close === 1 ? "is" : "are"} within 5 points in the polls.`;
}

// ---------------------------------------------------------------------------
// State, routing, controls
// ---------------------------------------------------------------------------

function renderAll() {
  renderSenate();
  renderLegend();
  renderMap();
  renderDetail();
  renderRacesTable();
}

function selectState(code, scroll = false) {
  ui.selected = code || null;
  const sel = document.getElementById("state-select");
  sel.value = ui.selected || "";
  const hash = ui.selected ? `#${ui.selected}` : " ";
  if ((location.hash || " ") !== hash) history.replaceState(null, "", ui.selected ? hash : location.pathname + location.search);
  renderMap();
  renderDetail({ scroll });
}

function readHash() {
  const code = location.hash.replace("#", "").toUpperCase();
  return ui.data.states.some((st) => st.code === code) ? code : null;
}

function setupControls() {
  const sel = document.getElementById("state-select");
  for (const st of ui.data.states) {
    const n = st.races.length;
    sel.append(h("option", { value: st.code }, `${st.name}${n ? "" : " (no statewide race)"}`));
  }
  sel.addEventListener("change", () => selectState(sel.value, true));

  for (const input of document.querySelectorAll('input[name="office"]')) {
    input.addEventListener("change", () => {
      ui.office = input.value;
      renderAll();
    });
  }
  for (const input of document.querySelectorAll('input[name="colorby"]')) {
    input.addEventListener("change", () => {
      ui.colorBy = input.value;
      renderSenate();
      renderLegend();
      renderMap();
    });
  }
  document.getElementById("close-only").addEventListener("change", (e) => {
    ui.closeOnly = e.target.checked;
    renderMap();
    renderRacesTable();
  });
  document.getElementById("sort-select").addEventListener("change", (e) => {
    ui.sort = e.target.value;
    renderRacesTable();
  });
  window.addEventListener("hashchange", () => selectState(readHash(), true));

  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(window.innerWidth - lastWidth) > 40) {
        lastWidth = window.innerWidth;
        renderDetail();
      }
    }, 200);
  });
}

const THEMES = ["auto", "light", "dark"];
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  const btn = document.getElementById("theme-toggle");
  const label = theme === "auto" ? "Auto" : theme === "light" ? "Light" : "Dark";
  btn.textContent = `Theme: ${label}`;
  btn.setAttribute("aria-label", `Color theme: ${theme === "auto" ? "follow system" : label}. Activate to change.`);
}

function setupTheme() {
  let theme = "auto";
  try {
    theme = localStorage.getItem("theme") || "auto";
  } catch {}
  if (!THEMES.includes(theme)) theme = "auto";
  applyTheme(theme);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    applyTheme(theme);
    if (ui.data) renderAll();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (ui.data && theme === "auto") renderAll();
  });
}

async function main() {
  setupTheme();
  try {
    const res = await fetch("data/polls.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ui.data = await res.json();
  } catch (err) {
    document.getElementById("updated").textContent = `Could not load poll data (${err.message}).`;
    return;
  }
  renderHeader();
  setupControls();
  ui.selected = readHash();
  document.getElementById("state-select").value = ui.selected || "";
  renderAll();
  if (ui.selected) renderDetail({ scroll: true });
}

main();
