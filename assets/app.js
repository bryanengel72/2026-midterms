// 2026 Midterm Poll Checker
// Renders data/polls.json: a tile map, a per-state detail view with a poll
// trend chart and tables, and a table of every race. All text that comes from
// the data is inserted with textContent, never as HTML.

import { polymarketUrl } from "./polymarket-links.js";
import { POLL_CLOSING_ET, closingTimes, etLabel } from "./poll-closing.js";

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

/** Whether the House sections (generic ballot, seat chart, districts) show. */
function showsHouse() {
  return ui.office === "all" || ui.office === "House";
}

function isClose(race) {
  const hl = headlineFor(race);
  return Boolean(hl && hl.margin < 5);
}

// ---------------------------------------------------------------------------
// Time machine: the polling picture as of an earlier date
// ---------------------------------------------------------------------------

const asOfCache = new Map();

/**
 * The race's polling picture: today's headline, or, when the time machine is
 * set to an earlier date, a 30-day average of the polls that had finished by
 * then (newest poll per pollster). Aggregator averages have no history, so
 * past dates always use this simple average.
 */
function headlineFor(race) {
  if (!ui.asOf) return race.headline;
  return averageAt(race, ui.asOf);
}

/** 30-day average (newest poll per pollster) of polls finished by `iso`. */
function averageAt(race, iso) {
  const key = `${race.id}|${iso}`;
  if (asOfCache.has(key)) return asOfCache.get(key);
  const t = Date.parse(iso);
  const newest = new Map();
  for (const p of race.polls) {
    if (!p.end) continue;
    const pt = Date.parse(p.end);
    if (pt > t || pt <= t - 30 * DAY) continue;
    const who = p.pollster.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase();
    if (!newest.has(who)) newest.set(who, p); // polls are newest first
  }
  let hl = null;
  if (newest.size) {
    const values = {};
    for (const c of race.candidates) {
      const nums = [...newest.values()].map((p) => p.values[c.name]).filter((v) => typeof v === "number");
      if (nums.length) values[c.name] = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
    }
    const ranked = Object.entries(values).sort((a, b) => b[1] - a[1]);
    if (ranked.length >= 2) {
      hl = {
        basis: "time-machine",
        detail: `30-day average of ${newest.size} poll${newest.size === 1 ? "" : "s"}`,
        values,
        leader: ranked[0][1] === ranked[1][1] ? null : ranked[0][0],
        margin: Math.round((ranked[0][1] - ranked[1][1]) * 10) / 10,
      };
    }
  }
  asOfCache.set(key, hl);
  return hl;
}

// ---------------------------------------------------------------------------
// Trend arrows: how the race moved over the last 7 days
// ---------------------------------------------------------------------------

/**
 * Change in the gap between the top two candidates over the last 7 days,
 * comparing 30-day poll averages a week apart (as of the time machine's
 * date, or today). Returns null without a new poll this week, or without
 * enough polls on both dates.
 */
function weekTrend(race) {
  const base = ui.asOf || ui.data.generatedAt.slice(0, 10);
  // Only when new polls arrived this week: otherwise any change would just
  // be old polls ageing out of the 30-day window.
  const t = Date.parse(base);
  const fresh = race.polls.some((p) => p.end && Date.parse(p.end) <= t && Date.parse(p.end) > t - 7 * DAY);
  if (!fresh) return null;
  const now = averageAt(race, base);
  const then = averageAt(race, new Date(Date.parse(base) - 7 * DAY).toISOString().slice(0, 10));
  if (!now || !then) return null;
  const [a, b] = Object.entries(now.values).sort((x, y) => y[1] - x[1]).map(([n]) => n);
  if (!b || typeof then.values[a] !== "number" || typeof then.values[b] !== "number") return null;
  const shift = Math.round(((now.values[a] - now.values[b]) - (then.values[a] - then.values[b])) * 10) / 10;
  if (Math.abs(shift) < 0.5) return { steady: true, shift: 0 };
  const towardName = shift > 0 ? a : b;
  return { steady: false, shift: Math.abs(shift), towardName, toward: candidate(race, towardName).party };
}

/** A small trend marker: party-colored arrow plus text. */
function trendChip(race, { long = false } = {}) {
  const t = weekTrend(race);
  if (!t) return null;
  if (t.steady) {
    return h("span", { class: "trend steady", title: "Little change in the last 7 days" }, "→ ", long ? "steady this week" : "steady");
  }
  const fill = t.toward === "D" ? "--party-d" : t.toward === "R" ? "--party-r" : "--party-i";
  const who = long ? `${fmtNum(t.shift)} toward ${surname(t.towardName)} this week` : `${partyLetter(t.toward)} +${fmtNum(t.shift)}`;
  return h("span", { class: "trend", title: `Moved ${fmtNum(t.shift)} points toward ${t.towardName} in the last 7 days (30-day poll averages)` },
    h("span", { class: "arrow", style: { color: `var(${fill})` }, "aria-hidden": "true" }, "▲"),
    " ", who);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function anyResults() {
  return allRaces().some((r) => r.results);
}

/** Matches a results name ("Jon Ossoff") to the race's candidate entry. */
function resultCandidate(race, name) {
  const last = surname(name).toLowerCase();
  return race.candidates.find((c) => surname(c.name).toLowerCase() === last) || null;
}

/** Leader, margin (points) and call status from a race's results. */
function resultSummary(race) {
  const res = race.results;
  if (!res || res.candidates.length < 1) return null;
  const [a, b] = res.candidates;
  const margin = b ? Math.round(((a.percentage || 0) - (b.percentage || 0)) * 10) / 10 : 100;
  return { leader: a, margin, called: Boolean(res.winner), winner: res.winner, runoff: res.runoff };
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

function leadLabel(race, { short = false, hl = headlineFor(race) } = {}) {
  if (!hl) return null;
  if (!hl.leader) return "Tied";
  const c = candidate(race, hl.leader);
  return short ? `${partyLetter(c.party)}+${fmtMargin(hl.margin)}` : `${surname(c.name)} +${fmtMargin(hl.margin)}`;
}

function rampFor(party) {
  return party === "D" ? "d" : party === "R" ? "r" : "i";
}

const RATING_STEP = { Safe: 3, Likely: 2, Lean: 1, Tilt: 1, Tossup: 0 };

// ---------------------------------------------------------------------------
// My picks: choose winners, see the totals, share a link
// ---------------------------------------------------------------------------

const picks = new Map(); // race or district id -> "D" | "R"
let picksBase = "ratings"; // unpicked races: "ratings" (forecasters' lean) or "toss"

function savePicks() {
  try {
    localStorage.setItem("picks", JSON.stringify(Object.fromEntries(picks)));
    localStorage.setItem("picksBase", picksBase);
  } catch {}
}

function validPickIds() {
  const ids = new Set(allRaces().map((r) => r.id));
  for (const d of ui.data.house?.districts || []) ids.add(d.id);
  return ids;
}

function setPicks(entries) {
  const ok = validPickIds();
  picks.clear();
  for (const [id, side] of entries) if (ok.has(id) && (side === "D" || side === "R")) picks.set(id, side);
}

/** Loads saved picks, or picks from a shared link (?picks=GA-SEN.D,PA-7.R). */
function loadPicks() {
  const params = new URLSearchParams(location.search);
  const shared = params.get("picks");
  if (shared !== null) {
    setPicks(shared.split(",").filter(Boolean).map((x) => { const i = x.lastIndexOf("."); return [x.slice(0, i), x.slice(i + 1)]; }));
    picksBase = params.get("base") === "toss" ? "toss" : "ratings";
    savePicks();
    params.delete("picks");
    params.delete("base");
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
    return true;
  }
  try {
    setPicks(Object.entries(JSON.parse(localStorage.getItem("picks") || "{}")));
    picksBase = localStorage.getItem("picksBase") === "toss" ? "toss" : "ratings";
  } catch {}
  return false;
}

/** The side a race shows in My picks mode, and whether the reader picked it. */
function pickCall(race) {
  const p = picks.get(race.id);
  if (p) return { side: p, picked: true };
  const c = race.consensus;
  if (picksBase === "ratings" && c?.lean && c.strength !== "Tossup") return { side: c.lean, picked: false, strength: c.strength };
  return { side: "T", picked: false };
}

/** Tap cycle: first the other side from what it shows unpicked, then the opposite, then back to unpicked. */
function cyclePick(race) {
  const cur = picks.get(race.id);
  const base = (() => { const was = picks.get(race.id); picks.delete(race.id); const b = pickCall(race).side; if (was) picks.set(race.id, was); return b; })();
  const first = base === "D" ? "R" : "D";
  if (!cur) picks.set(race.id, first);
  else if (cur === first) picks.set(race.id, first === "D" ? "R" : "D");
  else picks.delete(race.id);
  savePicks();
  renderAfterPick();
}

function renderAfterPick() {
  renderPicksBar();
  renderSenate();
  renderHouseSeats();
  renderLegend();
  renderMap();
  renderWatched();
  renderDistricts();
  renderDetail();
}

function renderPicksBar() {
  const bar = document.getElementById("picks-bar");
  bar.hidden = ui.colorBy !== "picks";
  if (bar.hidden) return;
  const n = picks.size;
  document.getElementById("picks-help").replaceChildren(
    h("strong", {}, n ? `${n} race${n === 1 ? "" : "s"} picked. ` : "Make your picks. "),
    "Tap seats on the Senate or House chart, map tile bands, or the pick buttons on races to choose winners. Taps cycle: other party, opposite party, unpicked. Saved in this browser.",
  );
  document.getElementById("picks-base").value = picksBase;
  document.getElementById("picks-clear").disabled = n === 0;
}

function picksLink() {
  const list = [...picks].map(([id, side]) => `${id}.${side}`).join(",");
  return `${location.origin}${location.pathname}?picks=${list}${picksBase === "toss" ? "&base=toss" : ""}`;
}

async function sharePicks() {
  const url = picksLink();
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: "My 2026 midterm picks", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast("Link copied. Anyone who opens it sees your picks.", () => {}, null, "Shared: ");
  } catch {
    window.prompt("Copy this link to share your picks:", url);
  }
}

function setupPicks() {
  document.getElementById("picks-base").addEventListener("change", (e) => {
    picksBase = e.target.value === "toss" ? "toss" : "ratings";
    savePicks();
    renderAfterPick();
  });
  document.getElementById("picks-share").addEventListener("click", sharePicks);
  document.getElementById("picks-clear").addEventListener("click", () => {
    if (!picks.size || !window.confirm(`Clear all ${picks.size} picks?`)) return;
    picks.clear();
    savePicks();
    renderAfterPick();
  });
}

/** Pick buttons for one race, shown on its card and district row in My picks mode. */
function pickButtons(race) {
  const cur = picks.get(race.id);
  const nameFor = (side) => race.candidates.find((c) => c.party === side)?.name;
  const btn = (side) => {
    const name = nameFor(side);
    return h("button", {
      type: "button",
      class: `pick-btn ${side.toLowerCase()}${cur === side ? " on" : ""}`,
      "aria-pressed": cur === side ? "true" : "false",
      onclick: (e) => {
        e.stopPropagation();
        if (cur === side) picks.delete(race.id);
        else picks.set(race.id, side);
        savePicks();
        renderAfterPick();
      },
    }, name ? `${surname(name)} (${side})` : side === "D" ? "Democrat" : "Republican");
  };
  return h("span", { class: "pick-btns", role: "group", "aria-label": "Your pick" }, btn("D"), btn("R"));
}

/** Map fill + label for a race under the current "color by" mode. */
function tileStyle(race) {
  if (!race) return null;
  if (ui.colorBy === "picks") {
    const c = pickCall(race);
    if (c.side === "T") return { fill: "--neutral", label: "Toss-up", race };
    if (c.picked) return { fill: `--${rampFor(c.side)}-3`, label: `${c.side} pick`, race };
    return { fill: `--${rampFor(c.side)}-1`, label: `${c.strength === "Likely" ? "Lkly" : c.strength} ${c.side}`, race };
  }
  if (ui.colorBy === "ratings") {
    const c = race.consensus;
    if (!c) return { fill: null, label: "–" };
    const step = RATING_STEP[c.strength] ?? 0;
    if (step === 0 || !c.lean) return { fill: "--neutral", label: "Toss-up" };
    const word = c.strength === "Likely" ? "Lkly" : c.strength;
    return { fill: `--${rampFor(c.lean)}-${step}`, label: `${word} ${c.lean}` };
  }
  if (ui.colorBy === "results") {
    const r = resultSummary(race);
    if (!r) return { fill: null, label: "–" };
    if (r.runoff) return { fill: "--neutral", label: "Runoff" };
    const party = r.leader.party;
    const label = `${partyLetter(party)}${r.called ? " ✓" : `+${fmtMargin(r.margin)}`}`;
    return { fill: `--${rampFor(party)}-${r.called ? 3 : 1}`, label };
  }
  const hl = headlineFor(race);
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
  "time-machine": "30-day poll average",
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

  renderUpdated();
}

function renderUpdated() {
  const gen = new Date(ui.data.generatedAt);
  const stamp = gen.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const total = allRaces().reduce((n, r) => n + r.polls.length, 0);
  document.getElementById("updated").textContent =
    `${total.toLocaleString()} polls across ${allRaces().length} races · updated ${stamp} · refreshes on its own`;
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
    const iLead = allRaces().some((r) => headlineFor(r)?.leader && !["D", "R"].includes(candidate(r, headlineFor(r).leader).party));
    if (iLead) groups.push(h("div", { class: "legend-group" }, sw("--i-2", "Independent or third party leads")));
  } else if (ui.colorBy === "picks") {
    groups.push(
      h("div", { class: "legend-group" }, h("span", { class: "label" }, "Democrat"), sw("--d-3", "Your pick"), sw("--d-1", picksBase === "ratings" ? "Forecasters' lean" : "")),
      h("div", { class: "legend-group" }, sw("--neutral", "Toss-up")),
      h("div", { class: "legend-group" }, h("span", { class: "label" }, "Republican"), sw("--r-1", picksBase === "ratings" ? "Forecasters' lean" : ""), sw("--r-3", "Your pick")),
    );
  } else if (ui.colorBy === "results") {
    groups.push(
      h("div", { class: "legend-group" }, h("span", { class: "label" }, "Democrat"), sw("--d-3", "Won"), sw("--d-1", "Leading")),
      h("div", { class: "legend-group" }, sw("--neutral", "Runoff")),
      h("div", { class: "legend-group" }, h("span", { class: "label" }, "Republican"), sw("--r-1", "Leading"), sw("--r-3", "Won")),
    );
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
      h("span", { class: "legend-item" }, h("span", { class: "swatch empty" }), ui.colorBy === "polls" ? "No race, or no polls" : ui.colorBy === "results" ? "No race, or no results yet" : "No race"),
    ),
  );
  el.replaceChildren(...groups);

  const hint = document.getElementById("map-hint");
  hint.textContent = ui.colorBy === "picks"
    ? "Tap a tile's Senate (top) or governor (bottom) band to pick its winner. Tap the state's name to open it."
    : ui.office === "all"
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
    const res = resultSummary(r);
    if (res && ui.colorBy === "results") {
      for (const c of r.results.candidates.slice(0, 3)) {
        rows.push(ttRow(c.party === "D" ? "--party-d" : c.party === "R" ? "--party-r" : "--party-i", fmtPct(c.percentage), `${surname(c.name)} (${partyLetter(c.party)})${r.results.winner === c.name ? " ✓ winner" : ""}`));
      }
      if (!res.called) rows.push(h("div", { class: "tt-sub" }, res.runoff ? "Headed to a runoff" : "Not called yet"));
    } else if (headlineFor(r)) {
      const top = Object.entries(headlineFor(r).values).sort((a, b) => b[1] - a[1]).slice(0, 3);
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
        {
          class: `band${ui.colorBy === "picks" ? " pickable" : ""}`,
          "aria-hidden": "true",
          "data-fill": style.fill,
          style: { background: `var(${style.fill})`, color: inkOn(style.fill) },
          onclick: ui.colorBy === "picks" ? (e) => { e.stopPropagation(); cyclePick(race); } : null,
        },
        style.label,
      );
    });
    const scoped = st.races.filter(inOffice);
    const relevant = scoped.length > 0 && (!ui.closeOnly || scoped.some(isClose));
    const summary = scoped.length
      ? scoped.map((r) => `${r.label}: ${headlineFor(r) ? leadLabel(r) : "no polls"}${r.consensus ? `, forecasters ${r.consensus.rating}` : ""}`).join("; ")
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
      h("span", { class: "code", "aria-hidden": "true" }, isWatched(st.code) ? h("span", { class: "star" }, "★") : null, st.code),
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
// Watched states (saved on this device)
// ---------------------------------------------------------------------------

const watched = (() => {
  try {
    const list = JSON.parse(localStorage.getItem("watchedStates") || "[]");
    return new Set(Array.isArray(list) ? list.filter((c) => /^[A-Z]{2}$/.test(c)) : []);
  } catch {
    return new Set();
  }
})();

function isWatched(code) {
  return watched.has(code);
}

function toggleWatch(code) {
  if (watched.has(code)) watched.delete(code);
  else watched.add(code);
  try {
    localStorage.setItem("watchedStates", JSON.stringify([...watched]));
  } catch {}
  renderWatched();
  renderMap();
  renderRacesTable();
  const btn = document.querySelector(`#state-detail .watch-btn[data-code="${code}"]`);
  if (btn) setWatchButton(btn, code);
}

function setWatchButton(btn, code) {
  const on = isWatched(code);
  btn.textContent = on ? "★ Watching" : "☆ Watch";
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.setAttribute("title", on ? "Stop watching this state" : "Pin this state to the top of the page");
}

/** One short line per race for a watched state's card. */
function watchSummary(race) {
  const res = resultSummary(race);
  if (res && ui.colorBy === "results") {
    if (res.runoff) return "Runoff";
    return `${surname(res.leader.name)} ${res.called ? "won" : `+${fmtMargin(res.margin)}, counting`}`;
  }
  const hl = headlineFor(race);
  if (hl) return leadLabel(race);
  return race.consensus ? race.consensus.rating : "No polls";
}

/** One line summing up a watched state's competitive House districts. */
function watchHouseLine(st) {
  const districts = (ui.data.house?.districts || []).filter((d) => d.state === st.code);
  if (!ui.data.house?.districts?.length) return null;
  if (!districts.length) {
    return h("span", { class: "watch-race muted" }, h("span", { class: "office" }, "House"), "All seats rated safe");
  }
  const n = { D: 0, T: 0, R: 0, I: 0 };
  for (const d of districts) n[senateCall(districtRace(d)).side] += 1;
  const total = districts.length;
  const word = ui.colorBy === "results" ? { T: "not called" } : { T: "toss-up" };
  const bits = [
    n.D ? `${n.D} D` : null,
    n.T ? `${n.T} ${word.T}` : null,
    n.I ? `${n.I} other` : null,
    n.R ? `${n.R} R` : null,
  ].filter(Boolean);
  const label = ui.colorBy === "results" ? "called or leading" : ui.colorBy === "ratings" ? "by forecasters" : "by polls";
  return h("span", { class: "watch-race watch-house", title: `${total} competitive House district${total === 1 ? "" : "s"}, ${label}. The rest are rated safe.` },
    h("span", { class: "mini-split", "aria-hidden": "true" },
      [["D", "--party-d"], ["T", "--neutral"], ["I", "--party-i"], ["R", "--party-r"]].filter(([k]) => n[k]).map(([k, fill]) =>
        h("span", { style: { flexGrow: String(n[k]), background: `var(${fill})` } }))),
    h("span", { class: "office" }, "House"),
    h("strong", { class: "watch-house-bits" }, bits.join(" · ")),
  );
}

function renderWatched() {
  renderAlertsButton();
  const section = document.getElementById("watched");
  const states = ui.data.states.filter((st) => watched.has(st.code));
  section.hidden = states.length === 0;
  if (!states.length) return;
  const cards = states.map((st) => {
    const closing = closingLine(st.code);
    return h("div", { class: "watch-card" },
      h("button", { type: "button", class: "watch-open", onclick: () => selectState(st.code, true), "aria-label": `Open ${st.name}` },
        h("span", { class: "watch-name" }, st.name),
        ui.office === "House" ? null : st.races.filter(inOffice).length
          ? st.races.filter(inOffice).map((r) => {
              const hl = headlineFor(r);
              const lead = hl?.leader ? candidate(r, hl.leader).party : null;
              const res = ui.colorBy === "results" ? resultSummary(r) : null;
              const party = res ? res.leader.party : lead;
              const fill = party === "D" ? "--party-d" : party === "R" ? "--party-r" : party ? "--party-i" : "--neutral";
              return h("span", { class: "watch-race" },
                h("span", { class: "swatch", style: { background: `var(${fill})` } }),
                h("span", { class: "office" }, r.office === "Senate" ? "Senate" : "Governor"),
                h("strong", {}, watchSummary(r)),
                ui.colorBy === "results" ? null : trendChip(r),
              );
            })
          : h("span", { class: "watch-race muted" }, st.races.length ? `No ${ui.office === "Senate" ? "Senate" : "governor"} race` : "No statewide race"),
        showsHouse() ? watchHouseLine(st) : null,
        closing ? h("span", { class: "watch-closing" }, closing.replace(/ \([^)]*your time\)/, "")) : null,
      ),
      h("button", {
        type: "button",
        class: "watch-remove",
        "aria-label": `Stop watching ${st.name}`,
        title: "Stop watching",
        onclick: () => toggleWatch(st.code),
      }, "×"),
    );
  });
  document.getElementById("watched-list").replaceChildren(...cards);
}

// ---------------------------------------------------------------------------
// Poll closing times
// ---------------------------------------------------------------------------

const viewerInET = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === "America/New_York";
  } catch {
    return false;
  }
})();

function localTime(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function untilText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  if (hrs < 24) return `${hrs}h ${String(m % 60).padStart(2, "0")}m`;
  const d = Math.floor(hrs / 24);
  return `${d} day${d === 1 ? "" : "s"} ${hrs % 24}h`;
}

/** One line for a state's page: when its polls close, and how long until. */
function closingLine(code) {
  const t = POLL_CLOSING_ET[code];
  const times = closingTimes(code);
  if (!t) return null;
  const now = Date.now();
  const local = viewerInET ? "" : ` (${localTime(times.first)} your time)`;
  const split = t.last ? `; last polls ${etLabel(t.last)}` : "";
  if (now >= times.last.getTime()) return `Polls closed at ${etLabel(t.last || t.first)}`;
  if (now >= times.first.getTime()) return `Most polls closed at ${etLabel(t.first)}${split}`;
  return `Polls close ${etLabel(t.first)}${local}${split} · in ${untilText(times.first.getTime() - now)}`;
}

function renderClosings() {
  const list = document.getElementById("closings");
  if (!list) return;
  const raceStates = new Set(allRaces().map((r) => r.state.code));
  const slots = new Map();
  for (const [code, t] of Object.entries(POLL_CLOSING_ET)) {
    if (!slots.has(t.first)) slots.set(t.first, []);
    slots.get(t.first).push(code);
  }
  const now = Date.now();
  const ordered = [...slots.keys()].sort();
  const nextKey = ordered.find((k) => closingTimes(slots.get(k)[0]).first.getTime() > now);
  const items = ordered.map((key) => {
    const when = closingTimes(slots.get(key)[0]).first;
    const closed = when.getTime() <= now;
    const isNext = key === nextKey;
    const codes = slots.get(key).sort();
    return h("li", { class: `slot${closed ? " closed" : ""}${isNext ? " next" : ""}` },
      h("div", { class: "slot-time" },
        h("strong", {}, etLabel(key).replace(/ ET.*$/, "")), h("span", {}, key >= "24:00" ? " ET, Nov 4" : " ET"),
        viewerInET ? null : h("small", {}, `${localTime(when)} your time`),
        isNext ? h("small", { class: "countdown" }, `in ${untilText(when.getTime() - now)}`) : null,
        closed ? h("small", {}, "closed") : null,
      ),
      h("div", { class: "slot-states" },
        codes.map((code) => {
          const st = ui.data.states.find((x) => x.code === code);
          const has = raceStates.has(code);
          return h("button", {
            type: "button",
            class: `chip state-chip${has ? "" : " quiet"}`,
            title: `${st?.name || code}${has ? "" : " (no Senate or governor race)"}`,
            onclick: () => selectState(code, true),
          }, code);
        }),
      ),
    );
  });
  list.replaceChildren(...items);
  const allClosed = !nextKey;
  document.getElementById("closings-hint").textContent = allClosed
    ? "All polls have closed. Times shown are when most polls in each state closed."
    : "Election night, Tuesday, November 3. Times are when most polls in each state close. Faded states have no Senate or governor race.";
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
  if (ui.colorBy === "picks") {
    const c = pickCall(race);
    const basis = c.picked ? "Your pick" : c.side === "T" ? "Not picked: toss-up" : `Not picked: forecasters say ${race.consensus?.rating}`;
    return { side: c.side, strength: c.picked ? 50 : RATING_STEP[c.strength] ?? 0, basis, picked: c.picked };
  }
  if (ui.colorBy === "results") {
    const r = resultSummary(race);
    if (!r) return { side: "T", strength: 0, basis: "No results yet", pending: true };
    if (r.runoff) return { side: "T", strength: 0, basis: "Headed to a runoff", pending: true };
    const party = r.leader.party === "D" || r.leader.party === "R" ? r.leader.party : "I";
    if (!r.called) return { side: "T", strength: 0, basis: `Counting: ${surname(r.leader.name)} +${fmtMargin(r.margin)}`, lean: r.leader.party, pending: true };
    return { side: party, strength: 100 + r.margin, basis: `Called for ${r.winner} (+${fmtMargin(r.margin)})` };
  }
  const hl = headlineFor(race);
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
const senateView = { svg: null, order: [] };

function renderSenate() {
  const card = document.getElementById("senate-card");
  const makeup = ui.data.senate;
  if (!makeup || ui.office === "Governor" || ui.office === "House") {
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

  // Build the 100 seats once; later renders recolor them in place so a mode
  // or date change fades each seat to its new color instead of redrawing.
  let svg = senateView.svg;
  const intro = motionOK() && !senateIntroDone;
  if (!svg || svg.querySelectorAll("circle.seat").length !== order.length) {
    svg = s("svg", {
      class: "senate-svg",
      viewBox: `${-dot * 2} ${-dot * 3} ${width + dot * 4} ${R + dot * 5}`,
      role: "img",
      "aria-label": "Senate seat chart. The counts beside it list every group of seats.",
    });
    order.forEach((_, i) => {
      const p = seats[i];
      svg.append(s("circle", {
        class: "seat",
        cx: p.x.toFixed(1),
        cy: p.y.toFixed(1),
        r: dot.toFixed(1),
        "data-i": i,
        style: `--d: ${Math.round((i / order.length) * 900)}ms`,
      }));
    });
    svg.append(
      s("line", { class: "senate-mid", x1: R, x2: R, y1: -dot * 2.6, y2: -dot * 1.25 }),
      s("text", { class: "senate-mid-label", x: R, y: R + dot * 0.5, "text-anchor": "middle" }, "50 | 50"),
    );
    const seatAt = (e) => {
      const i = e.target?.dataset?.i;
      return i === undefined ? null : senateView.order[Number(i)];
    };
    const tip = (o) => {
      if (o.kind !== "up") {
        const label = o.side === "IC" ? "Independent (caucuses with Democrats)" : PARTY_NAMES[o.side];
        return [h("div", { class: "tt-title" }, `${label}: not up in 2026`)];
      }
      const st = o.race.state;
      const status = o.side === "T"
        ? (o.pending ? "Not called yet" : "Toss-up")
        : ui.colorBy === "results" ? `Called for ${PARTY_NAMES[o.side] || "Independent"}s` : `Leans ${PARTY_NAMES[o.side] || "Independent"}`;
      return [
        h("div", { class: "tt-title" }, `${st.name}: ${o.race.label}`),
        h("div", {}, status),
        h("div", { class: "tt-sub" }, o.basis),
        h("div", { class: "tt-sub" }, `Held now by: ${o.race.incumbent ? `${o.race.incumbent.name} (${partyLetter(o.race.incumbent.party)})` : "unknown"}`),
      ];
    };
    svg.addEventListener("pointermove", (e) => {
      const o = seatAt(e);
      if (o) showTooltip(tip(o), e.clientX, e.clientY);
      else hideTooltip();
    });
    svg.addEventListener("pointerleave", hideTooltip);
    svg.addEventListener("click", (e) => {
      const o = seatAt(e);
      if (o?.kind !== "up") return;
      if (ui.colorBy === "picks") cyclePick(o.race);
      else selectState(o.race.state.code, true);
    });
    svg.addEventListener("focusin", (e) => {
      const o = seatAt(e);
      if (!o) return;
      const b = e.target.getBoundingClientRect();
      showTooltip(tip(o), b.right, b.top);
    });
    svg.addEventListener("focusout", hideTooltip);
    svg.addEventListener("keydown", (e) => {
      const o = seatAt(e);
      if (o?.kind === "up" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        if (ui.colorBy === "picks") cyclePick(o.race);
        else selectState(o.race.state.code, true);
      }
    });
    if (intro) svg.classList.add("intro");
    document.getElementById("senate-chart").replaceChildren(svg);
    senateView.svg = svg;
  }
  senateView.order = order;
  senateIntroDone = true;
  svg.querySelectorAll("circle.seat").forEach((c, i) => {
    const o = order[i];
    c.setAttribute("class", `seat ${o.kind}${o.side === "T" ? " tossup" : ""}${o.kind === "up" && ui.colorBy === "picks" && !o.picked ? " unpicked" : ""}`);
    c.style.fill = `var(${fillFor(o)})`;
    if (o.kind === "up") c.setAttribute("tabindex", "0");
    else c.removeAttribute("tabindex");
  });
  if (intro) svg.classList.add("intro");

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
  const mode = ui.colorBy;
  const L = {
    ratings: { d: "Races leaning Democratic", dx: null, t: "Toss-ups", tx: " (rated Toss-up)", i: "Races leaning independent", r: "Races leaning Republican", rx: null, big: "Toss-ups" },
    picks: { d: "Races going Democratic", dx: " (your picks + unpicked leans)", t: "Toss-ups", tx: " (not picked)", i: "Races going independent", r: "Races going Republican", rx: " (your picks + unpicked leans)", big: "Toss-ups" },
    results: { d: "Called for Democrats", dx: null, t: "Not called yet", tx: " (counting, runoff or no results)", i: "Called for independents", r: "Called for Republicans", rx: null, big: "Not called" },
    polls: { d: "Races where a Democrat leads", dx: " by 2+ points", t: "Toss-ups", tx: " (lead under 2 points)", i: "Races an independent leads", r: "Races where a Republican leads", rx: " by 2+ points", big: "Toss-ups" },
  }[mode] || {};
  const summary = document.getElementById("senate-summary");
  const parts = [
    h("div", { class: "seat-totals" },
      h("div", { class: "big d" }, h("span", { "data-count": dTotal }, String(dTotal)), h("small", {}, "Democrats + allies")),
      h("div", { class: "big t" }, h("span", { "data-count": toss }, String(toss)), h("small", {}, L.big)),
      h("div", { class: "big r" }, h("span", { "data-count": rTotal }, String(rTotal)), h("small", {}, "Republicans")),
    ),
    row("--party-d", "Democrats, not up", makeup.notUp.D, null, true),
    row("--party-i", "Independents who caucus with Democrats, not up", makeup.notUp.I, null, true),
    row("--party-d", L.d, dLean, L.dx),
    row("--neutral", L.t, toss, L.tx),
    iLean ? row("--party-i", L.i, iLean) : null,
    row("--party-r", L.r, rLean, L.rx),
    row("--party-r", "Republicans, not up", makeup.notUp.R, null, true),
  ];
  if (mode !== "ratings" && mode !== "picks" && toss) {
    parts.push(h("p", { class: "seat-note" },
      mode === "results" ? "If every uncalled race went to whoever is ahead in the count: " : "If every toss-up went to whoever is ahead, even slightly: ",
      h("strong", {}, `Democrats + allies ${dIf}, Republicans ${rIf}`),
      iIf ? `, independents ${iIf}` : "",
      tied ? `, with ${tied} race${tied === 1 ? "" : "s"} tied` : "",
      "."));
  }
  parts.push(h("p", { class: "seat-note" },
    "Control: 51 seats wins outright. At 50–50 the vice president, a Republican, breaks ties, so Democrats need 51 and Republicans 50."));
  summary.replaceChildren(...parts.filter(Boolean));
  if (intro) summary.querySelectorAll("[data-count]").forEach((el, i) => countUp(el, Number(el.dataset.count), String, { delay: 300 + i * 40, duration: 1000 }));

  const when = ui.asOf ? ` As of ${fmtDate(ui.asOf, true)} (time machine).` : "";
  document.getElementById("senate-hint").textContent = mode === "picks"
    ? "Your picks: tap any of the 35 seats on the ballot to pick its winner (faded seats aren't up this year). Bright seats are your picks; lighter ones follow your setting for unpicked races."
    : mode === "ratings"
      ? "Each of the 35 seats on the ballot is shaded by forecasters' consensus rating; faded seats aren't up this year. Not a prediction."
      : mode === "results"
        ? "Election results from Wikipedia: seats show a party once the race is called; faded seats weren't up this year. Tap a seat for its race."
        : `Each of the 35 seats on the ballot goes to whoever leads its polling average (forecasters' lean where there are no polls); faded seats aren't up this year. Not a prediction. Tap a seat for its race.${when}`;
}

// ---------------------------------------------------------------------------
// House generic ballot
// ---------------------------------------------------------------------------

let houseIntroDone = false;

function renderGenericBallot() {
  const card = document.getElementById("house-card");
  const gb = ui.data.genericBallot;
  if (!gb || !showsHouse()) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const race = { ...gb, state: { name: "National", code: "US" }, ratings: [], consensus: null };
  const colors = new Map([["Democrats", "--party-d"], ["Republicans", "--party-r"]]);
  const hl = headlineFor(race);
  const body = document.getElementById("house-body");
  const parts = [];
  const summary = h("div", { class: "race-summary" });
  const chartCol = h("div", { class: "race-chart" });
  if (hl) {
    const ranked = Object.entries(hl.values).sort((a, b) => b[1] - a[1]);
    const intro = motionOK() && !houseIntroDone;
    const standings = h("div", { class: "standings" },
      ranked.map(([name, v], i) =>
        h("div", { class: `standing${i === 0 && hl.leader ? " lead" : ""}` },
          h("span", { class: "swatch", style: { background: `var(${colors.get(name)})` } }),
          h("span", { class: "name" }, name),
          h("span", { class: "value", "data-count": v }, fmtPct(v)),
        ),
      ),
    );
    const sum = ranked.reduce((a, [, v]) => a + v, 0);
    const bar = h("div", {
      class: `split-bar${intro ? " grow" : ""}`,
      role: "img",
      "aria-label": ranked.map(([n, v]) => `${n} ${fmtPct(v)}`).join(", "),
    },
      ranked.map(([name, v]) => h("span", { style: { width: `${v}%`, background: `var(${colors.get(name)})` } })),
      sum < 100 ? h("span", { class: "rest", style: { width: `${100 - sum}%` } }) : null,
    );
    const lead = hl.leader ? `${hl.leader} +${fmtMargin(hl.margin)}` : "Tied";
    summary.append(
      standings,
      bar,
      h("p", { class: "headline-note" }, h("strong", {}, lead), ` · ${hl.detail}${ui.asOf ? ` (as of ${fmtDate(ui.asOf, true)})` : ""}`,
        (() => {
          const chip = trendChip(race, { long: true });
          return chip ? [" · ", chip] : null;
        })()),
      h("p", { class: "hint" },
        "A national lead doesn't translate seat for seat: district lines and where voters live matter, so a party can win the popular vote and still fall short of 218. ",
        safeUrl(gb.url) ? h("a", { href: gb.url, target: "_blank", rel: "noopener" }, "House races on Wikipedia") : null,
      ),
    );
    if (intro) {
      houseIntroDone = true;
      standings.querySelectorAll("[data-count]").forEach((el) => countUp(el, Number(el.dataset.count), fmtPct, { delay: 200 }));
    }
  } else {
    summary.append(h("div", { class: "no-polls" }, "No generic ballot polls for this date."));
  }
  parts.push(h("div", { class: "race-top" }, summary, chartCol));
  const details = h("details", { class: "house-details" },
    h("summary", {}, `Polling averages and all ${gb.polls.length} polls`),
    gb.aggregates.length ? [h("h4", {}, "Polling averages"), aggregatesTable(race)] : null,
    gb.polls.length ? [h("h4", {}, "Polls, newest first"), pollsTable(race)] : null,
  );
  parts.push(details);
  body.replaceChildren(...parts);
  if (gb.polls.length >= 3) {
    chartCol.append(h("h4", {}, "Poll trend"));
    const mount = h("div", {});
    chartCol.append(mount);
    requestAnimationFrame(() => {
      const chart = renderTrend(race, colors, mount);
      if (chart) {
        mount.replaceChildren(chart);
        if (motionOK() && !mount.dataset.drawn) animateChart(chart.querySelector("svg"));
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Race calls
// ---------------------------------------------------------------------------

const callsUi = { expanded: false, seen: null };
const CALLS_SHOWN = 8;

/** Every called race the office filter shows, newest call first. */
function calledRaces() {
  const items = [];
  const add = (race, kind, open, label) => {
    const res = race.results;
    if (!res?.winner) return;
    const w = res.candidates.find((c) => c.name === res.winner) || resultCandidate(race, res.winner) || { name: res.winner };
    const party = w.party || resultCandidate(race, res.winner)?.party || null;
    const held = race.incumbent?.party || null;
    items.push({
      id: race.id,
      kind,
      race,
      open,
      label,
      winner: res.winner,
      party,
      when: res.calledAt || ui.data.generatedAt,
      flip: Boolean(party && held && party !== held && (held === "D" || held === "R")),
      held,
    });
  };
  for (const r of allRaces().filter(inOffice)) {
    if (ui.office === "House") break;
    const office = r.office === "Senate" ? `Senate${/special/i.test(r.label) ? " (special)" : ""}` : "governor";
    add(r, "statewide", () => selectState(r.state.code, true), `${r.state.name} ${office}`);
  }
  if (showsHouse()) {
    for (const d of ui.data.house?.districts || []) {
      const race = districtRace(d);
      add(race, "house", () => openDistrict(d), districtLabel(d));
    }
  }
  items.sort((a, b) => b.when.localeCompare(a.when) || a.race.state.name.localeCompare(b.race.state.name));
  return items;
}

function renderCalls() {
  const card = document.getElementById("calls-card");
  const statewide = anyResults();
  const house = (ui.data.house?.districts || []).some((d) => d.results);
  if (!statewide && !house) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const items = calledRaces();
  const firstRender = callsUi.seen === null;
  if (firstRender) callsUi.seen = new Set(items.map((o) => o.id));
  const flips = items.filter((o) => o.flip);
  document.getElementById("calls-hint").textContent = items.length
    ? `${items.length} race${items.length === 1 ? "" : "s"} called${flips.length ? `, ${flips.length} changing parties` : ""}. Calls come from Wikipedia editors; times are when this page first saw them. Tap one for the race.`
    : "No races called yet. Calls appear here as Wikipedia editors mark winners; this page checks every couple of minutes.";
  const shown = callsUi.expanded ? items : items.slice(0, CALLS_SHOWN);
  const fill = (p) => p === "D" ? "--party-d" : p === "R" ? "--party-r" : p ? "--party-i" : "--neutral";
  const rows = shown.map((o) => {
    const fresh = !firstRender && !callsUi.seen.has(o.id);
    const t = new Date(o.when);
    const time = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const day = t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return h("li", { class: `call${fresh ? " new" : ""}${o.flip ? " flip" : ""}` },
      h("button", { type: "button", class: "call-btn", onclick: o.open },
        h("time", { datetime: o.when, title: `${day}, ${time}` }, time),
        h("span", { class: "swatch", style: { background: `var(${fill(o.party)})` } }),
        h("span", { class: "call-text" },
          h("strong", {}, `${surname(o.winner)}${o.party ? ` (${partyLetter(o.party)})` : ""}`),
          ` wins ${o.label}`),
        o.flip ? h("span", { class: "flip-badge" }, `${o.party} gain from ${o.held}`) : null,
        fresh ? h("span", { class: "new-badge" }, "New") : null,
      ));
  });
  document.getElementById("calls").replaceChildren(...rows);
  for (const o of items) callsUi.seen.add(o.id);
  const more = document.getElementById("calls-more");
  more.hidden = items.length <= CALLS_SHOWN;
  more.classList.toggle("open", callsUi.expanded);
  document.getElementById("calls-expand").textContent = callsUi.expanded ? "Show fewer" : `Show all ${items.length} calls`;
}

// ---------------------------------------------------------------------------
// Poll misses: final polling average against the result
// ---------------------------------------------------------------------------

const missesUi = { expanded: false };
const MISSES_SHOWN = 12;

/**
 * Called races with a polling average and both a Democrat and a Republican
 * in the polls and the results. Margins are Democrat minus Republican, so a
 * positive miss means Democrats did better than their polls.
 */
function pollMisses() {
  const out = [];
  const add = (race, label, open, short = label) => {
    const res = race.results;
    const hl = race.headline;
    if (!res?.winner || !hl?.values) return;
    const pollD = race.candidates.find((c) => c.party === "D" && typeof hl.values[c.name] === "number");
    const pollR = race.candidates.find((c) => c.party === "R" && typeof hl.values[c.name] === "number");
    const resD = res.candidates.find((c) => c.party === "D" && typeof c.percentage === "number");
    const resR = res.candidates.find((c) => c.party === "R" && typeof c.percentage === "number");
    if (!pollD || !pollR || !resD || !resR) return;
    const polled = hl.values[pollD.name] - hl.values[pollR.name];
    const actual = resD.percentage - resR.percentage;
    const winner = res.candidates.find((c) => c.name === res.winner);
    out.push({
      id: race.id, label, short, open, polled, actual,
      miss: Math.round((actual - polled) * 10) / 10,
      winnerParty: winner?.party || null,
      pollPicked: polled === 0 ? null : (polled > 0 ? "D" : "R") === winner?.party,
      basis: hl.detail,
    });
  };
  if (ui.office !== "House") {
    for (const r of allRaces().filter(inOffice)) {
      const office = r.office === "Senate" ? `Senate${/special/i.test(r.label) ? " (special)" : ""}` : "governor";
      const short = `${r.state.code} ${r.office === "Senate" ? (/special/i.test(r.label) ? "Sen (sp.)" : "Sen") : "Gov"}`;
      add(r, `${r.state.name} ${office}`, () => selectState(r.state.code, true), short);
    }
  }
  if (showsHouse()) {
    for (const d of ui.data.house?.districts || []) add(districtRace(d), districtLabel(d), () => openDistrict(d));
  }
  return out;
}

const fmtSide = (m) => (Math.abs(m) < 0.05 ? "Tie" : `${m > 0 ? "D" : "R"} +${fmtNum(Math.round(Math.abs(m) * 10) / 10)}`);

function renderMisses() {
  const card = document.getElementById("misses-card");
  const items = pollMisses();
  if (!items.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const n = items.length;
  const avg = items.reduce((a, o) => a + o.miss, 0) / n;
  const abs = items.reduce((a, o) => a + Math.abs(o.miss), 0) / n;
  const picked = items.filter((o) => o.pollPicked === true).length;
  const ties = items.filter((o) => o.pollPicked === null).length;
  const bias = Math.abs(avg) < 0.5
    ? "Average miss: no clear lean either way"
    : `Average miss: polls underrated ${avg > 0 ? "Democrats" : "Republicans"}`;
  const stat = (big, small, cls = "") => h("div", { class: `miss-stat ${cls}` }, h("strong", {}, big), h("small", {}, small));
  document.getElementById("miss-stats").replaceChildren(
    stat(Math.abs(avg) < 0.5 ? "Even" : fmtSide(avg), bias, avg > 0.5 ? "d" : avg < -0.5 ? "r" : ""),
    stat(`${fmtNum(Math.round(abs * 10) / 10)} pts`, "Typical miss, either direction"),
    stat(`${picked} of ${n - ties}`, `Polling leader won${ties ? ` (${ties} tied in polls)` : ""}`),
  );
  document.getElementById("misses-hint").textContent =
    `${n} called race${n === 1 ? "" : "s"} with polls, comparing the final polling average with the result (Democrat minus Republican margin). Hollow ring: polls. Dot: result. Biggest misses first. Tap a race to open it.`;

  const sorted = items.slice().sort((a, b) => Math.abs(b.miss) - Math.abs(a.miss) || a.label.localeCompare(b.label));
  const shown = missesUi.expanded ? sorted : sorted.slice(0, MISSES_SHOWN);
  // Democrats to the left, Republicans to the right, as on the seat charts.
  // The scale fits the widest margin shown, in steps of 10 (20 to 60).
  const widest = Math.max(...items.map((o) => Math.max(Math.abs(o.polled), Math.abs(o.actual))));
  const MISS_RANGE = Math.min(60, Math.max(20, Math.ceil(widest / 10) * 10));
  const pct = (m) => 50 - (Math.max(-MISS_RANGE, Math.min(MISS_RANGE, m)) / MISS_RANGE) * 48;
  const axis = h("div", { class: "miss-row miss-axis", "aria-hidden": "true" },
    h("span", {}, ""),
    h("span", { class: "miss-axis-labels" }, h("span", {}, `D +${MISS_RANGE}`), h("span", {}, "Tie"), h("span", {}, `R +${MISS_RANGE}`)),
    h("span", { class: "miss-val" }, "Miss"));
  const rows = shown.map((o) => {
    const dir = o.miss > 0 ? "--party-d" : o.miss < 0 ? "--party-r" : "--text-2";
    const won = o.winnerParty === "D" ? "--party-d" : o.winnerParty === "R" ? "--party-r" : "--party-i";
    const pa = pct(o.polled);
    const pb = pct(o.actual);
    const plot = h("span", { class: "miss-track", role: "img", "aria-label": `Polls ${fmtSide(o.polled)}, result ${fmtSide(o.actual)}` },
      h("span", { class: "miss-zero" }),
      h("span", { class: "miss-link", style: { left: `${Math.min(pa, pb)}%`, width: `${Math.abs(pa - pb)}%`, background: `var(${dir})` } }),
      h("span", { class: "miss-poll", style: { left: `${pa}%` } }),
      h("span", { class: "miss-result", style: { left: `${pb}%`, background: `var(${won})` } }),
    );
    return h("button", { type: "button", class: "miss-row", onclick: o.open, title: `${o.label}: polls ${fmtSide(o.polled)}, result ${fmtSide(o.actual)}. ${o.basis || ""}` },
      h("span", { class: "miss-label" }, h("span", { class: "long" }, o.label), h("span", { class: "short" }, o.short)),
      h("span", { class: "miss-plot" }, plot),
      h("span", { class: "miss-val", style: { color: `var(${dir})` } }, Math.abs(o.miss) < 0.05 ? "0" : `${o.miss > 0 ? "D" : "R"} +${fmtNum(Math.abs(o.miss))}`));
  });
  document.getElementById("miss-chart").replaceChildren(axis, ...rows);
  const more = document.getElementById("misses-more");
  more.hidden = sorted.length <= MISSES_SHOWN;
  more.classList.toggle("open", missesUi.expanded);
  document.getElementById("misses-expand").textContent = missesUi.expanded ? "Show fewer" : `Show all ${sorted.length} races`;
}

// ---------------------------------------------------------------------------
// Alerts for watched states
// ---------------------------------------------------------------------------

const alerts = { on: false, seen: null };
const canNotify = typeof window !== "undefined" && "Notification" in window;

function loadAlertsPref() {
  try {
    alerts.on = localStorage.getItem("callAlerts") === "1";
  } catch {}
  if (alerts.on && canNotify && Notification.permission === "denied") alerts.on = false;
}

/** Every called race (all offices), keyed by id, for spotting new calls. */
function allCallIds() {
  const ids = new Set();
  for (const r of allRaces()) if (r.results?.winner) ids.add(r.id);
  for (const d of ui.data.house?.districts || []) if (d.results?.winner) ids.add(d.id);
  return ids;
}

function renderAlertsButton() {
  const btn = document.getElementById("alerts-btn");
  btn.hidden = watched.size === 0;
  const perm = canNotify ? Notification.permission : "unsupported";
  if (perm === "denied") {
    btn.textContent = "🔕 Alerts blocked";
    btn.title = "Notifications are blocked for this site in your browser settings. Calls in your states still pop up on the page.";
  } else if (alerts.on && (perm === "granted" || perm === "unsupported")) {
    btn.textContent = "🔔 Alerts on";
    btn.title = perm === "granted"
      ? "You'll get a notification when a race in your states is called, while this page is open in a tab. Tap to turn off."
      : "Calls in your states pop up on this page while it's open. Tap to turn off.";
  } else {
    btn.textContent = "🔔 Alert me when races are called";
    btn.title = "Get a notification when a race in one of your states is called, while this page is open in a tab.";
  }
  btn.setAttribute("aria-pressed", alerts.on ? "true" : "false");
  btn.classList.toggle("on", alerts.on);
}

async function toggleAlerts() {
  if (alerts.on) {
    alerts.on = false;
  } else if (canNotify && Notification.permission !== "granted") {
    let perm = Notification.permission;
    try {
      if (perm === "default") perm = await Notification.requestPermission();
    } catch {}
    // Without permission (or support) alerts still pop up on the page.
    alerts.on = perm !== "denied";
  } else {
    alerts.on = true;
  }
  try {
    localStorage.setItem("callAlerts", alerts.on ? "1" : "0");
  } catch {}
  renderAlertsButton();
}

/** After new data: alert on calls in watched states that weren't called before. */
function alertNewCalls() {
  const now = allCallIds();
  const before = alerts.seen;
  alerts.seen = now;
  if (!before || !alerts.on) return;
  const fresh = [];
  for (const r of allRaces()) {
    if (!now.has(r.id) || before.has(r.id) || !watched.has(r.state.code)) continue;
    const office = r.office === "Senate" ? `Senate${/special/i.test(r.label) ? " (special)" : ""}` : "governor";
    fresh.push({ race: r, label: `${r.state.name} ${office}`, open: () => selectState(r.state.code, true) });
  }
  for (const d of ui.data.house?.districts || []) {
    if (!now.has(d.id) || before.has(d.id) || !watched.has(d.state)) continue;
    fresh.push({ race: districtRace(d), label: districtLabel(d), open: () => openDistrict(d) });
  }
  for (const f of fresh) {
    const res = f.race.results;
    const w = res.candidates.find((c) => c.name === res.winner);
    const party = w?.party || resultCandidate(f.race, res.winner)?.party;
    const held = f.race.incumbent?.party;
    const flip = party && held && party !== held && (held === "D" || held === "R");
    const text = `${res.winner}${party ? ` (${partyLetter(party)})` : ""} wins ${f.label}${flip ? `, a ${party} gain from ${held}` : ""}.`;
    showToast(text, f.open, party);
    if (canNotify && Notification.permission === "granted") {
      try {
        const n = new Notification(`Race called: ${f.label}`, { body: text, tag: `call-${f.race.id}` });
        n.onclick = () => {
          window.focus();
          f.open();
          n.close();
        };
      } catch {}
    }
  }
}

function showToast(text, onOpen, party, title = "Race called: ") {
  const fill = party === "D" ? "--party-d" : party === "R" ? "--party-r" : party ? "--party-i" : "--neutral";
  const toast = h("div", { class: "toast" },
    party ? h("span", { class: "swatch", style: { background: `var(${fill})` } }) : null,
    h("button", { type: "button", class: "toast-text", onclick: () => { onOpen(); toast.remove(); } }, h("strong", {}, title), text),
    h("button", { type: "button", class: "toast-close", "aria-label": "Dismiss", onclick: () => toast.remove() }, "×"),
  );
  document.getElementById("toasts").append(toast);
  setTimeout(() => toast.remove(), 15000);
}

// ---------------------------------------------------------------------------
// House seat chart
// ---------------------------------------------------------------------------

const FORECASTER_NAMES = {
  Cook: "Cook Political Report", IE: "Inside Elections", Sabato: "Sabato's Crystal Ball", "Econ.": "The Economist",
  ST: "Split Ticket", DDHQ: "Decision Desk HQ", FPO: "FiftyPlusOne", Fox: "Fox News", Silver: "Silver Bulletin", RCP: "RealClearPolitics",
};
const houseView = { svg: null, order: [] };
let houseSeatsIntroDone = false;

function openDistrict(d) {
  districtsUi.open.add(d.id);
  selectState(d.state, true);
}

function renderHouseSeats() {
  const card = document.getElementById("house-seats-card");
  const house = ui.data.house;
  if (!house?.districts?.length || !house.safe || !showsHouse()) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const calls = house.districts.map((d) => {
    const race = districtRace(d);
    return { d, race, ...senateCall(race) };
  });
  const pick = (side) => calls.filter((c) => c.side === side);
  // Left to right: seats every forecaster calls safe for Democrats, then the
  // competitive seats from safest Democratic to safest Republican.
  const order = [
    ...Array.from({ length: house.safe.D }, () => ({ kind: "held", side: "D" })),
    ...pick("D").sort((a, b) => b.strength - a.strength).map((c) => ({ kind: "up", ...c })),
    ...pick("T").sort((a, b) => (a.lean === "D" ? -1 : a.lean === "R" ? 1 : 0) - (b.lean === "D" ? -1 : b.lean === "R" ? 1 : 0)).map((c) => ({ kind: "up", ...c })),
    ...pick("I").map((c) => ({ kind: "up", ...c })),
    ...pick("R").sort((a, b) => a.strength - b.strength).map((c) => ({ kind: "up", ...c })),
    ...Array.from({ length: house.safe.R }, () => ({ kind: "held", side: "R" })),
  ];
  const fillFor = (o) => o.side === "D" ? "--party-d" : o.side === "R" ? "--party-r" : o.side === "I" ? "--party-i" : "--neutral";
  const width = 520;
  const { seats, dot, R } = hemicycle(order.length, 12, width);

  let svg = houseView.svg;
  const intro = motionOK() && !houseSeatsIntroDone;
  if (!svg || svg.querySelectorAll("circle.seat").length !== order.length) {
    svg = s("svg", {
      class: "senate-svg house-svg",
      viewBox: `${-dot * 2} ${-dot * 3} ${width + dot * 4} ${R + dot * 6}`,
      role: "img",
      "aria-label": "House seat chart. The counts beside it list every group of seats.",
    });
    order.forEach((_, i) => {
      const p = seats[i];
      svg.append(s("circle", {
        class: "seat", cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: dot.toFixed(1), "data-i": i,
        style: `--d: ${Math.round((i / order.length) * 900)}ms`,
      }));
    });
    svg.append(
      s("line", { class: "senate-mid", x1: R, x2: R, y1: -dot * 2.6, y2: -dot * 1.25 }),
      s("text", { class: "senate-mid-label", x: R, y: R + dot * 1.5, "text-anchor": "middle" }, "218 for a majority"),
    );
    const seatAt = (e) => {
      const i = e.target?.dataset?.i;
      return i === undefined ? null : houseView.order[Number(i)];
    };
    const tip = (o) => {
      if (o.kind !== "up") return [h("div", { class: "tt-title" }, `Safe ${o.side === "D" ? "Democratic" : "Republican"} seat`), h("div", { class: "tt-sub" }, "Every forecaster rates it safe")];
      const status = o.side === "T"
        ? (o.pending ? "Not called yet" : "Toss-up")
        : ui.colorBy === "results" ? `Called for ${PARTY_NAMES[o.side] || "Independent"}s` : `Leans ${PARTY_NAMES[o.side] || "Independent"}`;
      return [
        h("div", { class: "tt-title" }, `${o.race.label}`),
        h("div", {}, status),
        h("div", { class: "tt-sub" }, o.basis),
        h("div", { class: "tt-sub" }, `Incumbent: ${incumbentLabel(o.d)}`),
      ];
    };
    svg.addEventListener("pointermove", (e) => {
      const o = seatAt(e);
      if (o) showTooltip(tip(o), e.clientX, e.clientY);
      else hideTooltip();
    });
    svg.addEventListener("pointerleave", hideTooltip);
    svg.addEventListener("click", (e) => {
      const o = seatAt(e);
      if (o?.kind !== "up") return;
      if (ui.colorBy === "picks") cyclePick(o.race);
      else openDistrict(o.d);
    });
    svg.addEventListener("focusin", (e) => {
      const o = seatAt(e);
      if (!o) return;
      const b = e.target.getBoundingClientRect();
      showTooltip(tip(o), b.right, b.top);
    });
    svg.addEventListener("focusout", hideTooltip);
    svg.addEventListener("keydown", (e) => {
      const o = seatAt(e);
      if (o?.kind === "up" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        if (ui.colorBy === "picks") cyclePick(o.race);
        else openDistrict(o.d);
      }
    });
    document.getElementById("house-seats-chart").replaceChildren(svg);
    houseView.svg = svg;
  }
  houseView.order = order;
  houseSeatsIntroDone = true;
  svg.querySelectorAll("circle.seat").forEach((c, i) => {
    const o = order[i];
    c.setAttribute("class", `seat ${o.kind}${o.side === "T" ? " tossup" : ""}${o.kind === "up" && ui.colorBy === "picks" && !o.picked ? " unpicked" : ""}`);
    c.style.fill = `var(${fillFor(o)})`;
    if (o.kind === "up") c.setAttribute("tabindex", "0");
    else c.removeAttribute("tabindex");
  });
  if (intro) svg.classList.add("intro");

  const dLean = pick("D").length;
  const rLean = pick("R").length;
  const iLean = pick("I").length;
  const toss = pick("T").length;
  const dTotal = house.safe.D + dLean;
  const rTotal = house.safe.R + rLean;
  let dIf = dTotal, rIf = rTotal, tied = 0;
  for (const c of pick("T")) {
    if (c.lean === "D") dIf++;
    else if (c.lean === "R") rIf++;
    else tied++;
  }
  const row = (fill, label, n, extra, held = false) =>
    h("div", { class: "seat-row" },
      h("span", { class: `swatch${held ? " held" : ""}${fill === "--neutral" ? " tossup" : ""}`, style: { background: `var(${fill})` } }),
      h("span", { class: "seat-label" }, label, extra ? h("small", {}, extra) : null),
      h("span", { class: "seat-n", "data-count": n }, String(n)),
    );
  const mode = ui.colorBy;
  const L = {
    ratings: { d: "Competitive, leaning Democratic", dx: " (consensus rating)", t: "Toss-ups", tx: " (consensus Toss-up)", r: "Competitive, leaning Republican", rx: " (consensus rating)", big: "Toss-ups" },
    results: { d: "Called for Democrats", dx: null, t: "Not called yet", tx: null, r: "Called for Republicans", rx: null, big: "Not called" },
    picks: { d: "Competitive, going Democratic", dx: " (your picks + unpicked leans)", t: "Toss-ups", tx: " (not picked)", r: "Competitive, going Republican", rx: " (your picks + unpicked leans)", big: "Toss-ups" },
    polls: { d: "Competitive, Democrat leads", dx: " by 2+ in polls, or rated D if unpolled", t: "Toss-ups", tx: " (poll lead under 2, or rated Toss-up)", r: "Competitive, Republican leads", rx: " by 2+ in polls, or rated R if unpolled", big: "Toss-ups" },
  }[mode] || {};
  const parts = [
    h("div", { class: "seat-totals" },
      h("div", { class: "big d" }, h("span", { "data-count": dTotal }, String(dTotal)), h("small", {}, "Democrats")),
      h("div", { class: "big t" }, h("span", { "data-count": toss }, String(toss)), h("small", {}, L.big)),
      h("div", { class: "big r" }, h("span", { "data-count": rTotal }, String(rTotal)), h("small", {}, "Republicans")),
    ),
    row("--party-d", "Safe Democratic", house.safe.D, " (every forecaster)", true),
    row("--party-d", L.d, dLean, L.dx),
    row("--neutral", L.t, toss, L.tx),
    iLean ? row("--party-i", "Competitive, independent ahead", iLean) : null,
    row("--party-r", L.r, rLean, L.rx),
    row("--party-r", "Safe Republican", house.safe.R, " (every forecaster)", true),
  ];
  const leader = dTotal >= 218 ? "Democrats reach 218" : rTotal >= 218 ? "Republicans reach 218" : null;
  parts.push(h("p", { class: "seat-note" },
    leader ? h("strong", {}, `${leader} without the toss-ups. `) : `Neither party reaches 218 without the toss-ups (Democrats need ${218 - dTotal} more, Republicans ${218 - rTotal}). `,
    mode !== "ratings" && mode !== "picks" && toss
      ? [mode === "results" ? "If every uncalled race went to whoever is ahead: " : "If every toss-up went to whoever is ahead, even slightly: ",
         h("strong", {}, `Democrats ${dIf}, Republicans ${rIf}`), tied ? `, with ${tied} tied` : "", "."]
      : null));
  if (mode === "results") parts.push(h("p", { class: "seat-note" }, "Results are tracked for the competitive districts only; seats every forecaster rated safe are shown faded for their expected party."));
  const summary = document.getElementById("house-seats-summary");
  summary.replaceChildren(...parts.filter(Boolean));
  if (intro) summary.querySelectorAll("[data-count]").forEach((el, i) => countUp(el, Number(el.dataset.count), String, { delay: 300 + i * 40, duration: 1000 }));

  // Each forecaster's own published totals.
  const fc = house.forecasts || [];
  document.getElementById("house-forecasts").replaceChildren(fc.length
    ? h("details", { class: "forecasts" },
        h("summary", {}, `What each forecaster projects (${fc.length})`),
        h("div", { class: "table-scroll" },
          h("table", { class: "data forecasts-table" },
            h("thead", {}, h("tr", {},
              h("th", { scope: "col" }, "Forecaster"),
              h("th", { scope: "col", class: "num" }, "Dem."),
              h("th", { scope: "col", class: "num" }, "Toss-up"),
              h("th", { scope: "col", class: "num" }, "Rep."),
              h("th", { scope: "col", class: "split-cell" }, "Split"))),
            h("tbody", {}, fc.map((f) => h("tr", {},
              h("td", {}, FORECASTER_NAMES[f.source] || f.source),
              h("td", { class: "num" }, String(f.D)),
              h("td", { class: "num" }, String(f.tossup)),
              h("td", { class: "num" }, String(f.R)),
              h("td", { class: "split-cell" },
                h("div", { class: "split-bar", role: "img", "aria-label": `${f.D} Democratic, ${f.tossup} toss-up, ${f.R} Republican` },
                  h("span", { style: { width: `${(f.D / 435) * 100}%`, background: "var(--party-d)" } }),
                  h("span", { style: { width: `${(f.tossup / 435) * 100}%`, background: "var(--neutral)" } }),
                  h("span", { style: { width: `${(f.R / 435) * 100}%`, background: "var(--party-r)" } }),
                  h("i", { class: "majority-tick", "aria-hidden": "true" })))))),
          ),
        ),
        h("p", { class: "hint" }, "Seats each forecaster rates Safe, Likely, Lean or Tilt for a party, as Wikipedia totals them. 218 is a majority."),
      )
    : "");

  const when = ui.asOf ? ` As of ${fmtDate(ui.asOf, true)} (time machine).` : "";
  document.getElementById("house-seats-hint").textContent =
    `All 435 seats. The ${house.safe.D + house.safe.R} faded seats are ones every forecaster calls safe. ` +
    (mode === "picks"
      ? "Tap any of the other " + house.districts.length + " to pick its winner; bright seats are your picks."
      : mode === "ratings"
      ? "The other " + house.districts.length + " are shaded by forecasters' consensus rating."
      : mode === "results"
        ? "The other " + house.districts.length + " show a party once Wikipedia reports the race called."
        : "The other " + house.districts.length + " go to whoever leads the district's polls, or the forecasters' lean where there are none.") +
    ` Not a prediction. Tap a seat for its district.${when}`;
}

// ---------------------------------------------------------------------------
// Competitive House districts
// ---------------------------------------------------------------------------

const RATING_ORDER = { Tossup: 0, Tilt: 1, Lean: 2, Likely: 3, Safe: 4 };
const districtsUi = { filter: "close", sort: "rating", expanded: false, open: new Set() };

function districtLabel(d) {
  return d.district === "AL" ? `${d.state} at-large` : `${d.state}-${d.district}`;
}

function districtRace(d) {
  const st = ui.data.states.find((x) => x.code === d.state);
  return { ...d, label: `${st?.name || d.state} ${d.district === "AL" ? "at-large" : `district ${d.district}`}`, state: st || { name: d.state, code: d.state } };
}

/** "Ashley Hinson (retiring)" → "Ashley Hinson (R), retiring". */
function incumbentLabel(d) {
  const inc = d.incumbent;
  if (!inc || !inc.name) return "Open seat";
  if (/^new seat/i.test(inc.name)) return "New seat";
  const m = inc.name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const name = m ? m[1] : inc.name;
  const tag = inc.party ? ` (${partyLetter(inc.party)})` : "";
  return m ? `${name}${tag}, ${m[2]}` : `${name}${tag}`;
}

function districtPollCell(d, colors) {
  if (ui.colorBy === "picks") return pickButtons(d);
  if (ui.colorBy === "results" && d.results) {
    const r = resultSummary(d);
    if (r.runoff) return "Runoff";
    return h("span", { class: "leader" },
      h("span", { class: "swatch", style: { background: `var(${r.leader.party === "D" ? "--party-d" : r.leader.party === "R" ? "--party-r" : "--party-i"})` } }),
      `${surname(r.leader.name)} ${r.called ? "won" : `+${fmtMargin(r.margin)}`}`);
  }
  const hl = headlineFor(d);
  if (!hl) return h("span", { class: "sub" }, "No polls");
  if (!hl.leader) return "Tied";
  const c = candidate(d, hl.leader);
  return h("span", { class: "leader" },
    h("span", { class: "swatch", style: { background: `var(${colors.get(c.name) || "--party-x"})` } }),
    `${surname(c.name)} (${partyTag(c)}) +${fmtMargin(hl.margin)}`);
}

function districtDetail(d) {
  const race = districtRace(d);
  const colors = candidateColors(race);
  const hl = headlineFor(race);
  const box = h("div", { class: "district-detail" });
  if (race.results) box.append(resultsBlock(race, colors));
  const ranked = hl ? Object.entries(hl.values).sort((a, b) => b[1] - a[1]) : [];
  box.append(
    h("div", { class: "district-cands" },
      race.candidates.map((c) => {
        const v = hl?.values[c.name];
        return h("span", { class: "leader" },
          h("span", { class: "swatch", style: { background: `var(${colors.get(c.name)})` } }),
          `${c.name} (${partyTag(c)})`,
          typeof v === "number" ? h("strong", {}, ` ${fmtPct(v)}`) : null);
      }),
    ),
    hl ? h("p", { class: "hint" }, `${hl.detail}.`, (() => { const t = trendChip(race, { long: true }); return t ? [" ", t] : null; })()) : null,
    h("ul", { class: "ratings-list" },
      race.ratings.map((r) => h("li", {}, h("span", { class: "src" }, r.source), h("span", {}, `${r.rating}${r.flip ? " (flip)" : ""}`))),
    ),
  );
  if (race.polls.length) box.append(h("div", { class: "table-scroll" }, pollsTable(race)));
  const url = safeUrl(race.url);
  box.append(h("p", { class: "hint" },
    `Incumbent: ${incumbentLabel(d)}. `,
    race.pvi ? `Partisan lean: ${race.pvi}. ` : "",
    race.lastResult ? `2024 result: ${race.lastResult}. ` : "",
    url ? h("a", { href: url, target: "_blank", rel: "noopener" }, "District on Wikipedia") : null));
  return box;
}

/** Rows for a list of districts; clicking a row opens its details inline. */
function districtRows(list) {
  const rows = [];
  for (const d of list) {
    const race = districtRace(d);
    const colors = candidateColors(race);
    const c = d.consensus;
    const open = districtsUi.open.has(d.id);
    const toggle = () => {
      if (districtsUi.open.has(d.id)) districtsUi.open.delete(d.id);
      else districtsUi.open.add(d.id);
      renderDistricts();
      renderDetail();
    };
    rows.push(h("tr", { class: `district-row${open ? " open" : ""}`, onclick: toggle },
      h("td", {},
        h("button", { type: "button", class: "linkish disclose", "aria-expanded": open ? "true" : "false", onclick: (e) => { e.stopPropagation(); toggle(); } },
          `${open ? "▾" : "▸"} ${districtLabel(d)}`)),
      h("td", {}, incumbentLabel(d)),
      h("td", { class: "num" }, d.pvi || "–"),
      h("td", {}, c ? h("span", { class: "chip small" }, h("span", { class: "swatch", style: { background: `var(${ratingSwatch(c)})` } }), `${c.rating}${c.of ? ` ${c.count}/${c.of}` : ""}`) : "–"),
      h("td", {}, districtPollCell(race, colors)),
      h("td", { class: "num" }, trendChip(race) || "–"),
      h("td", { class: "num" }, fmtDate(d.latestPoll)),
    ));
    if (open) rows.push(h("tr", { class: "detail-row" }, h("td", { colspan: 7 }, districtDetail(d))));
  }
  return rows;
}

function districtScore(d) {
  const c = d.consensus;
  return c ? (RATING_ORDER[c.strength] ?? 4) : 5;
}

function renderDistricts() {
  const card = document.getElementById("districts-card");
  const house = ui.data.house;
  if (!house?.districts?.length || !showsHouse()) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const all = house.districts;

  // Summary: how forecasters' consensus splits the competitive seats.
  const groups = [
    ["Safe D", "--d-3", (c) => c.lean === "D" && c.strength === "Safe"],
    ["Likely D", "--d-2", (c) => c.lean === "D" && c.strength === "Likely"],
    ["Lean D", "--d-1", (c) => c.lean === "D" && (c.strength === "Lean" || c.strength === "Tilt")],
    ["Toss-up", "--neutral", (c) => c.strength === "Tossup" || !c.lean],
    ["Lean R", "--r-1", (c) => c.lean === "R" && (c.strength === "Lean" || c.strength === "Tilt")],
    ["Likely R", "--r-2", (c) => c.lean === "R" && c.strength === "Likely"],
    ["Safe R", "--r-3", (c) => c.lean === "R" && c.strength === "Safe"],
  ].map(([label, fill, test]) => ({ label, fill, n: all.filter((d) => d.consensus && test(d.consensus)).length }));
  const total = groups.reduce((a, g) => a + g.n, 0) || 1;
  document.getElementById("district-summary").replaceChildren(
    h("div", { class: "split-bar tall", role: "img", "aria-label": groups.map((g) => `${g.label} ${g.n}`).join(", ") },
      groups.filter((g) => g.n).map((g) =>
        h("span", { style: { width: `${(g.n / total) * 100}%`, background: `var(${g.fill})`, color: inkOn(g.fill) }, title: `${g.label}: ${g.n}` },
          (g.n / total) > 0.05 ? String(g.n) : ""))),
    h("div", { class: "map-legend" }, groups.map((g) =>
      h("span", { class: "legend-item" }, h("span", { class: "swatch", style: { background: `var(${g.fill})` } }), `${g.label} ${g.n}`))),
  );
  document.getElementById("districts-hint").textContent =
    `${all.length} districts that at least one of ten forecasters doesn't call safe; the other ${435 - all.length} seats are rated safe by all of them. "Safe" below means most forecasters call it safe. Tap a district for its candidates, polls and every rating.`;

  let list = all.slice();
  if (districtsUi.filter === "close") list = list.filter((d) => districtScore(d) <= 2);
  else if (districtsUi.filter === "polled") list = list.filter((d) => d.polls.length);
  const byState = (a, b) => a.state.localeCompare(b.state) || (parseInt(a.district, 10) || 0) - (parseInt(b.district, 10) || 0);
  if (districtsUi.sort === "state") list.sort(byState);
  else if (districtsUi.sort === "polls") {
    const m = (d) => headlineFor(d)?.margin ?? Infinity;
    list.sort((a, b) => m(a) - m(b) || byState(a, b));
  } else list.sort((a, b) => districtScore(a) - districtScore(b) || byState(a, b));

  const LIMIT = 12;
  const collapsed = !districtsUi.expanded && list.length > LIMIT;
  const shown = collapsed ? list.slice(0, LIMIT) : list;
  document.getElementById("districts-polls-col").textContent = ui.colorBy === "results" ? "Results" : ui.colorBy === "picks" ? "Your pick" : "Polls";
  document.querySelector("#districts-table tbody").replaceChildren(...districtRows(shown));
  const more = document.getElementById("districts-more");
  more.hidden = !collapsed && !(districtsUi.expanded && list.length > LIMIT);
  more.classList.toggle("open", !collapsed);
  document.getElementById("districts-expand").textContent = collapsed ? `Show all ${list.length} districts` : "Show fewer";
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

/** Election-night results, and how they compare with the final polls. */
function resultsBlock(race, colors) {
  const res = race.results;
  const sum = resultSummary(race);
  const status = sum.called
    ? `Called for ${sum.winner}`
    : sum.runoff
      ? "Headed to a runoff"
      : "Votes still being counted";
  const rows = res.candidates.filter((c) => c.votes).slice(0, 4).map((c) => {
    const cand = resultCandidate(race, c.name);
    const color = (cand && colors.get(cand.name)) || (c.party === "D" ? "--party-d" : c.party === "R" ? "--party-r" : "--party-x");
    return h("div", { class: "result-row" },
      h("span", { class: "swatch", style: { background: `var(${color})` } }),
      h("span", { class: "name" }, `${c.name} `, h("small", {}, `(${partyLetter(c.party)})`),
        res.winner === c.name ? h("span", { class: "won" }, "✓ Winner") : null),
      h("span", { class: "votes" }, c.votes.toLocaleString()),
      h("span", { class: "value", "data-count": c.percentage }, fmtPct(c.percentage)),
    );
  });
  // Polls vs result: the final pre-election polling margin against the
  // actual margin between the same two candidates.
  let compare = null;
  const hl = race.headline;
  const [a, b] = res.candidates;
  const ca = a && resultCandidate(race, a.name);
  const cb = b && resultCandidate(race, b.name);
  if (hl && ca && cb && typeof hl.values[ca.name] === "number" && typeof hl.values[cb.name] === "number") {
    const polled = hl.values[ca.name] - hl.values[cb.name];
    const actual = (a.percentage || 0) - (b.percentage || 0);
    const miss = Math.round((actual - polled) * 10) / 10;
    const fmtM = (m) => (m >= 0 ? `${surname(a.name)} +${fmtNum(Math.round(m * 10) / 10)}` : `${surname(b.name)} +${fmtNum(Math.round(-m * 10) / 10)}`);
    compare = h("p", { class: "headline-note" },
      h("strong", {}, `Polls: ${fmtM(polled)} · Result${sum.called ? "" : " so far"}: ${fmtM(actual)}`),
      Math.abs(miss) < 0.5
        ? " · the polls were right on"
        : ` · ${surname(miss > 0 ? a.name : b.name)} did ${fmtNum(Math.abs(miss))} points better than the polls`,
    );
  }
  return h("div", { class: `results-block${sum.called ? " called" : ""}` },
    h("h4", {}, "Results ", h("span", { class: "status" }, status)),
    h("div", { class: "result-rows" }, rows),
    h("p", { class: "hint" }, `${res.totalVotes.toLocaleString()} votes counted, per Wikipedia.`),
    compare,
  );
}

function raceCard(race) {
  const colors = candidateColors(race);
  const hl = race.headline;
  const card = h("article", { class: "card race", "aria-label": `${race.state.name} ${race.label}` });
  const url = safeUrl(race.url);
  const odds = polymarketUrl(race.id);
  card.append(
    h("div", { class: "race-title" },
      h("h3", {}, race.label),
      h("span", { class: "race-links" },
        url ? h("a", { href: url, target: "_blank", rel: "noopener" }, "Wikipedia article") : null,
        odds ? h("a", { href: odds, target: "_blank", rel: "noopener noreferrer", title: "Opens Polymarket, a betting market. Odds are bettors' prices, not polls." }, "Betting odds on Polymarket ↗") : null,
      ),
    ),
  );
  const bits = [];
  if (race.incumbent) bits.push(`Incumbent: ${race.incumbent.name} (${partyLetter(race.incumbent.party)})`);
  bits.push(`${race.polls.length} general election poll${race.polls.length === 1 ? "" : "s"}`);
  if (race.latestPoll) bits.push(`latest ended ${fmtDate(race.latestPoll)}`);
  if (race.stale) bits.push("could not refresh, showing last good data");
  card.append(h("p", { class: "race-sub" }, bits.join(" · ")));
  if (ui.colorBy === "picks") card.append(h("div", { class: "pick-row" }, h("span", { class: "label" }, "Your pick:"), pickButtons(race)));

  const summary = h("div", { class: "race-summary" });
  const chartCol = h("div", { class: "race-chart" });
  card.append(h("div", { class: "race-top" }, summary, chartCol));
  if (race.results) summary.append(resultsBlock(race, colors), race.headline ? h("h4", {}, "Final polling average") : null);

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
      h("p", { class: "headline-note" }, h("strong", {}, leadLabel(race, { hl })), ` · ${hl.detail}`,
        (() => {
          const chip = trendChip(race, { long: true });
          return chip ? [" · ", chip] : null;
        })()),
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
  const closing = closingLine(st.code);
  const head = h(
    "div",
    { class: "state-head" },
    h("div", {}, h("h2", {}, st.name), closing ? h("p", { class: "closing-line" }, "🗳 ", closing) : null),
    h("p", { class: "hint" },
      `${st.races.length ? `${st.races.length} statewide race${st.races.length === 1 ? "" : "s"} · ` : ""}All U.S. House seats are also on the ballot: `,
      house ? h("a", { href: house, target: "_blank", rel: "noopener" }, "House races") : "House races",
      " · ",
      (() => {
        const btn = h("button", { type: "button", class: "linkish watch-btn", "data-code": st.code, onclick: () => toggleWatch(st.code) });
        setWatchButton(btn, st.code);
        return btn;
      })(),
      " ",
      h("button", { type: "button", class: "linkish", onclick: () => selectState(null) }, "Close"),
    ),
  );
  const stateDistricts = (ui.data.house?.districts || []).filter((d) => d.state === st.code)
    .sort((a, b) => districtScore(a) - districtScore(b) || (parseInt(a.district, 10) || 0) - (parseInt(b.district, 10) || 0));
  let body;
  if (ui.office === "House") {
    body = stateDistricts.length
      ? null
      : h("div", { class: "card no-polls" }, `None of ${st.name}'s House seats is on the competitive list: every forecaster rates them all safe.`);
  } else if (!st.races.length) {
    body = h("div", { class: "card no-polls" }, `${st.name} has no U.S. Senate or governor election in 2026.`);
  } else if (!races.length) {
    body = h("div", { class: "card no-polls" },
      `${st.name} has no ${ui.office === "Senate" ? "Senate" : "governor"} race in 2026. Switch the office filter to All to see its other race.`);
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
  const districtsBlock = stateDistricts.length && showsHouse()
    ? h("section", { class: "card state-districts" },
        h("h3", {}, `Competitive House districts in ${st.name} (${stateDistricts.length})`),
        h("div", { class: "table-scroll" },
          h("table", { class: "data districts-table" },
            h("thead", {}, h("tr", {},
              ["District", "Incumbent", "Lean", "Forecasters", ui.colorBy === "results" ? "Results" : ui.colorBy === "picks" ? "Your pick" : "Polls", "7-day trend", "Latest poll"].map((t, i) =>
                h("th", { scope: "col", class: i === 2 || i >= 5 ? "num" : null }, t)))),
            h("tbody", {}, districtRows(stateDistricts)),
          ),
        ),
      )
    : null;
  el.replaceChildren(head, body || "", districtsBlock || "");
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
      const ma = headlineFor(a) ? headlineFor(a).margin : Infinity;
      const mb = headlineFor(b) ? headlineFor(b).margin : Infinity;
      return ma - mb || byState(a, b);
    });
  }
  const rows = races.map((r) => {
    const colors = candidateColors(r);
    const rh = headlineFor(r);
    const leader = rh?.leader ? candidate(r, rh.leader) : null;
    const go = () => selectState(r.state.code, true);
    return h(
      "tr",
      { onclick: go },
      h("td", {},
        isWatched(r.state.code) ? h("span", { class: "star", title: "Watching" }, "★ ") : null,
        h("a", { href: `#${r.state.code}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); go(); } }, r.state.name)),
      h("td", {}, r.label),
      h("td", { class: "avg-cell" },
        rh
          ? Object.entries(rh.values)
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
      h("td", { class: "num lead-cell" }, rh ? (rh.leader ? `+${fmtMargin(rh.margin)}` : "0") : "–"),
      h("td", { class: "num trend-cell" }, trendChip(r) || "–"),
      h("td", {}, rh ? BASIS_SHORT[rh.basis] || "" : "–"),
      h("td", {}, r.consensus ? `${r.consensus.rating} (${r.consensus.count}/${r.consensus.of})` : "–"),
      h("td", { class: "num" }, fmtDate(r.latestPoll)),
    );
  });
  // Collapsed: show only the first few races (the closest, by default).
  const COLLAPSED_ROWS = 8;
  const collapsed = ui.racesCollapsed && rows.length > COLLAPSED_ROWS;
  rows.forEach((row, i) => {
    if (collapsed && i >= COLLAPSED_ROWS) row.hidden = true;
  });
  const toggle = document.getElementById("races-toggle");
  toggle.textContent = ui.racesCollapsed ? "Expand" : "Collapse";
  toggle.setAttribute("aria-expanded", ui.racesCollapsed ? "false" : "true");
  toggle.hidden = rows.length <= COLLAPSED_ROWS;
  document.getElementById("races-more").hidden = !collapsed;
  document.getElementById("races-expand").textContent = `Show all ${rows.length} races`;
  document.getElementById("races-table").classList.toggle("collapsed", collapsed);
  rows.forEach((row, i) => row.style.setProperty("--i", Math.min(i, 24)));
  const tbody = document.querySelector("#races-table tbody");
  tbody.classList.remove("fresh");
  tbody.replaceChildren(...rows);
  if (motionOK() && !tm.playing) {
    void tbody.offsetWidth;
    tbody.classList.add("fresh");
  }
  const close = allRaces().filter(inOffice).filter(isClose).length;
  document.getElementById("races-count").textContent =
    `${collapsed ? `Showing ${COLLAPSED_ROWS} of ${races.length} races` : `${races.length} race${races.length === 1 ? "" : "s"} shown`}. ${close} ${close === 1 ? "is" : "are"} within 5 points in the polls.`;
}

// ---------------------------------------------------------------------------
// Time machine controls
// ---------------------------------------------------------------------------

const TM_START = "2026-08-01";
const tm = { playing: false, timer: 0, days: 0 };

function isoPlusDays(iso, n) {
  return new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
}

/** Moves the time machine to `index` days after TM_START (the end is today). */
function setTimeMachine(index) {
  const range = document.getElementById("tm-range");
  const i = Math.max(0, Math.min(tm.days, index));
  range.value = String(i);
  const atToday = i >= tm.days;
  ui.asOf = atToday ? null : isoPlusDays(TM_START, i);
  if (ui.asOf && ui.colorBy !== "polls") {
    ui.colorBy = "polls";
    const radio = document.querySelector('input[name="colorby"][value="polls"]');
    if (radio) radio.checked = true;
  }
  document.getElementById("tm-label").textContent = atToday
    ? "Today"
    : `${fmtDate(ui.asOf, true)} · 30-day poll averages`;
  document.getElementById("tm-reset").hidden = atToday;
  document.getElementById("time-machine").classList.toggle("active", !atToday);
  renderWatched();
  renderSenate();
  renderGenericBallot();
  renderHouseSeats();
  renderDistricts();
  renderLegend();
  renderMap();
  renderRacesTable();
}

function stopPlaying() {
  tm.playing = false;
  clearInterval(tm.timer);
  const btn = document.getElementById("tm-play");
  btn.textContent = "▶ Play";
  btn.setAttribute("aria-label", "Play the polls forward from August");
}

function setupTimeMachine() {
  const range = document.getElementById("tm-range");
  const today = ui.data.generatedAt.slice(0, 10);
  tm.days = Math.max(1, Math.round((Date.parse(today) - Date.parse(TM_START)) / DAY));
  range.max = String(tm.days);
  range.value = String(tm.days);
  range.addEventListener("input", () => {
    stopPlaying();
    setTimeMachine(Number(range.value));
  });
  document.getElementById("tm-reset").addEventListener("click", () => {
    stopPlaying();
    setTimeMachine(tm.days);
  });
  document.getElementById("tm-play").addEventListener("click", () => {
    if (tm.playing) {
      stopPlaying();
      return;
    }
    let i = Number(range.value);
    if (i >= tm.days) i = 0;
    tm.playing = true;
    const btn = document.getElementById("tm-play");
    btn.textContent = "❚❚ Pause";
    btn.setAttribute("aria-label", "Pause");
    setTimeMachine(i);
    const step = motionOK() ? 2 : 7;
    tm.timer = setInterval(() => {
      i += step;
      setTimeMachine(i);
      if (i >= tm.days) stopPlaying();
    }, motionOK() ? 260 : 900);
  });
}

// ---------------------------------------------------------------------------
// State, routing, controls
// ---------------------------------------------------------------------------

/** The map and all-races table cover statewide races only; House view hides them. */
function applyOfficeLayout() {
  const house = ui.office === "House";
  document.getElementById("map-card").hidden = house;
  document.getElementById("races-card").hidden = house;
  document.getElementById("close-only-field").hidden = house;
}

function renderAll() {
  applyOfficeLayout();
  renderPicksBar();
  renderCalls();
  renderMisses();
  renderWatched();
  renderSenate();
  renderGenericBallot();
  renderHouseSeats();
  renderDistricts();
  renderClosings();
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
      // The time machine lives on the map, which the House view hides.
      if (ui.office === "House" && ui.asOf) {
        stopPlaying();
        setTimeMachine(tm.days);
      }
      renderAll();
    });
  }
  ensureResultsOption();
  setupTimeMachine();
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    renderClosings();
    renderWatched();
    const line = document.querySelector("#state-detail .closing-line");
    if (line && ui.selected) line.textContent = `🗳 ${closingLine(ui.selected) || ""}`;
  }, 30000);
  for (const input of document.querySelectorAll('input[name="colorby"]')) wireColorBy(input);
  document.getElementById("misses-expand").addEventListener("click", () => {
    missesUi.expanded = !missesUi.expanded;
    renderMisses();
  });
  document.getElementById("calls-expand").addEventListener("click", () => {
    callsUi.expanded = !callsUi.expanded;
    renderCalls();
  });
  document.getElementById("close-only").addEventListener("change", (e) => {
    ui.closeOnly = e.target.checked;
    renderMap();
    renderRacesTable();
  });
  setupControlsRest();
}

/** Election night: offer the Results view, and switch to it unless the reader picked a view. */
function ensureResultsOption() {
  if (!anyResults() || document.querySelector('input[name="colorby"][value="results"]')) return;
  const label = h("label", {}, h("input", { type: "radio", name: "colorby", value: "results" }), h("span", {}, "Results"));
  document.getElementById("color-filter").append(label);
  if (document.querySelector('input[name="colorby"][value="polls"]')?.dataset.wired) wireColorBy(label.querySelector("input"));
  if (!ui.colorByChosen) {
    ui.colorBy = "results";
    label.querySelector("input").checked = true;
    if (ui.asOf) {
      stopPlaying();
      ui.asOf = null;
      document.getElementById("tm-range").value = String(tm.days);
      document.getElementById("tm-label").textContent = "Today";
      document.getElementById("tm-reset").hidden = true;
      document.getElementById("time-machine").classList.remove("active");
    }
    document.getElementById("time-machine").classList.add("off");
  }
}

function wireColorBy(input) {
    if (input.dataset.wired) return;
    input.dataset.wired = "1";
    input.addEventListener("change", () => {
      ui.colorBy = input.value;
      ui.colorByChosen = true;
      renderPicksBar();
      if (ui.colorBy !== "polls" && ui.asOf) {
        stopPlaying();
        ui.asOf = null;
        document.getElementById("tm-range").value = String(tm.days);
        document.getElementById("tm-label").textContent = "Today";
        document.getElementById("tm-reset").hidden = true;
        document.getElementById("time-machine").classList.remove("active");
        renderRacesTable();
      }
      document.getElementById("time-machine").classList.toggle("off", ui.colorBy !== "polls");
      renderWatched();
      renderDistricts();
      renderHouseSeats();
      renderSenate();
      renderLegend();
      renderMap();
      renderCalls();
      renderDetail();
    });
}

function setupControlsRest() {
  // Races table collapse: remembered; starts collapsed on phones.
  try {
    const saved = localStorage.getItem("racesCollapsed");
    ui.racesCollapsed = saved === null ? matchMedia("(max-width: 640px)").matches : saved === "1";
  } catch {
    ui.racesCollapsed = false;
  }
  const setCollapsed = (v, scrollBack = false) => {
    ui.racesCollapsed = v;
    try {
      localStorage.setItem("racesCollapsed", v ? "1" : "0");
    } catch {}
    renderRacesTable();
    if (scrollBack) {
      document.getElementById("races-title").scrollIntoView({ behavior: motionOK() ? "smooth" : "auto", block: "start" });
    }
  };
  document.getElementById("districts-filter").addEventListener("change", (e) => {
    districtsUi.filter = e.target.value;
    renderDistricts();
  });
  document.getElementById("districts-sort").addEventListener("change", (e) => {
    districtsUi.sort = e.target.value;
    renderDistricts();
  });
  document.getElementById("districts-expand").addEventListener("click", () => {
    districtsUi.expanded = !districtsUi.expanded;
    renderDistricts();
  });
  document.getElementById("races-toggle").addEventListener("click", () => setCollapsed(!ui.racesCollapsed, !ui.racesCollapsed));
  document.getElementById("races-expand").addEventListener("click", () => setCollapsed(false));
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
  const sharedPicks = loadPicks();
  if (sharedPicks) {
    ui.colorBy = "picks";
    ui.colorByChosen = true;
    document.querySelector('input[name="colorby"][value="picks"]').checked = true;
  }
  setupControls();
  setupPicks();
  if (sharedPicks) document.getElementById("time-machine").classList.add("off");
  ui.selected = readHash();
  document.getElementById("state-select").value = ui.selected || "";
  loadAlertsPref();
  alerts.seen = allCallIds();
  document.getElementById("alerts-btn").addEventListener("click", toggleAlerts);
  renderAll();
  if (ui.selected) renderDetail({ scroll: true });
  startLiveUpdates();
  if (sharedPicks) showToast(`Showing ${picks.size} shared pick${picks.size === 1 ? "" : "s"}. Change any of them by tapping.`, () => {}, null, "My picks: ");
}

// ---------------------------------------------------------------------------
// Live updates: pick up new data without a reload
// ---------------------------------------------------------------------------

const LIVE_EVERY = 2 * 60 * 1000;
let lastCheck = Date.now();

function startLiveUpdates() {
  setInterval(() => {
    // In a background tab, keep checking only when alerts are on for watched states.
    if (document.visibilityState === "visible" || (alerts.on && watched.size)) refreshData();
  }, LIVE_EVERY);
  // Coming back to the tab after a while: check right away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > 60 * 1000) refreshData();
  });
}

async function refreshData() {
  lastCheck = Date.now();
  let next;
  try {
    const res = await fetch("data/polls.json", { cache: "no-cache" });
    if (!res.ok) return;
    next = await res.json();
  } catch {
    return; // offline or mid-deploy: try again next time
  }
  if (!next?.generatedAt || next.generatedAt === ui.data.generatedAt) return;
  applyNewData(next);
}

function applyNewData(next) {
  ui.data = next;
  asOfCache.clear();
  // A new day moves the time machine's end.
  const today = ui.data.generatedAt.slice(0, 10);
  const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(TM_START)) / DAY));
  if (days !== tm.days) {
    tm.days = days;
    const range = document.getElementById("tm-range");
    range.max = String(days);
    if (!ui.asOf) range.value = String(days);
  }
  ensureResultsOption();
  renderUpdated();
  renderAll();
  alertNewCalls();
  const el = document.getElementById("updated");
  el.classList.remove("flash");
  void el.offsetWidth;
  if (motionOK()) el.classList.add("flash");
}

main();
