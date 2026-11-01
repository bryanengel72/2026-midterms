// Polymarket betting odds. Shared by the browser (live odds on a state's
// page) and by scripts/build-data.mjs (the snapshot in data/polls.json).
// Read-only use of Polymarket's public Gamma API; no key needed.

export const POLYMARKET_API = "https://gamma-api.polymarket.com";
export const THIN_MARKET_VOLUME = 50000;

const SLUG_RE = /^[a-z0-9-]+$/;

export function eventUrl(slug) {
  return SLUG_RE.test(slug) ? `https://polymarket.com/event/${slug}` : null;
}

/** Fetches events by slug, a batch per request. Returns Map slug -> event. */
export async function fetchEvents(slugs, { fetchImpl = fetch, batchSize = 15, headers } = {}) {
  const found = new Map();
  const clean = slugs.filter((s) => SLUG_RE.test(s));
  for (let i = 0; i < clean.length; i += batchSize) {
    const batch = clean.slice(i, i + batchSize);
    const qs = batch.map((s) => `slug=${encodeURIComponent(s)}`).join("&");
    const res = await fetchImpl(`${POLYMARKET_API}/events?${qs}`, headers ? { headers } : undefined);
    if (!res.ok) throw new Error(`Polymarket HTTP ${res.status}`);
    const events = await res.json();
    for (const e of Array.isArray(events) ? events : []) {
      if (e && typeof e.slug === "string") found.set(e.slug, e);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Matching Polymarket's outcome labels to the race's candidates
// ---------------------------------------------------------------------------

const PARTY_WORDS = { democrat: "D", democratic: "D", republican: "R", independent: "I", libertarian: "L", green: "G" };
const HONORIFICS = /^(sen|senator|gov|governor|rep|dr|mr|mrs|ms|lt)\.?\s+/i;
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

function tokens(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t && !SUFFIXES.has(t));
}

/** "Sen. Dan Sullivan" -> { name: "Dan Sullivan", party: null, honorific: true } */
export function parseLabel(label) {
  let text = String(label || "").replace(/[“”]/g, '"').replace(/[’]/g, "'").trim();
  const honorific = HONORIFICS.test(text);
  text = text.replace(HONORIFICS, "");
  const m = text.match(/\(\s*([A-Z]{1,3})\s*\)\s*$/);
  const party = m ? ({ D: "D", R: "R", I: "I", L: "L", G: "G" }[m[1]] || null) : null;
  const name = (m ? text.slice(0, m.index) : text).trim();
  const partyOnly = PARTY_WORDS[name.toLowerCase()] || null;
  return { name, party: party || partyOnly, partyOnly: Boolean(partyOnly), honorific };
}

function score(label, cand, incumbent) {
  if (label.party && cand.party && label.party !== cand.party) return -1;
  if (label.partyOnly) return 40;
  const lt = tokens(label.name);
  const ct = tokens(cand.name);
  if (!lt.length || !ct.length) return -1;
  if (lt.join(" ") === ct.join(" ")) return 100;
  const surname = ct[ct.length - 1];
  if (!lt.includes(surname)) return -1;
  let s = 50;
  if (label.party && label.party === cand.party) s += 20;
  if (lt[0][0] === ct[0][0]) s += 10;
  if (label.honorific && incumbent && incumbent.name === cand.name) s += 15;
  return s;
}

/**
 * Pairs each label with at most one candidate (best scores first). A
 * party-only label ("Independent") matches only when that party has exactly
 * one candidate.
 */
function matchLabels(labels, candidates, incumbent) {
  const pairs = [];
  labels.forEach((l, li) => {
    const sameParty = candidates.filter((c) => c.party === l.party);
    candidates.forEach((c, ci) => {
      if (l.partyOnly && sameParty.length !== 1) return;
      const s = score(l, c, incumbent);
      if (s > 0) pairs.push({ li, ci, s });
    });
  });
  pairs.sort((a, b) => b.s - a.s);
  const byLabel = new Map();
  const usedCand = new Set();
  for (const p of pairs) {
    if (byLabel.has(p.li) || usedCand.has(p.ci)) continue;
    byLabel.set(p.li, candidates[p.ci]);
    usedCand.add(p.ci);
  }
  return byLabel;
}

function yesPrice(market) {
  try {
    const prices = typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices;
    const p = Number(Array.isArray(prices) ? prices[0] : NaN);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Summarizes one Polymarket "<State> <Office> Election Winner" event:
 * each live outcome's implied chance of winning, matched to a candidate
 * where possible. Outcomes under 1% are folded into `otherProbability`.
 */
export function summarizeEvent(event, candidates = [], incumbent = null) {
  const live = (event.markets || [])
    .filter((m) => m && m.active && !m.closed)
    .map((m) => ({ label: String(m.groupItemTitle || m.question || "").trim(), p: yesPrice(m) }))
    .filter((m) => m.label && m.p !== null);
  const shown = live.filter((m) => m.p >= 0.01).sort((a, b) => b.p - a.p);
  const rest = live.filter((m) => m.p < 0.01).reduce((sum, m) => sum + m.p, 0);
  const parsed = shown.map((m) => parseLabel(m.label));
  const matches = matchLabels(parsed, candidates, incumbent);
  const outcomes = shown.map((m, i) => {
    const cand = matches.get(i);
    return {
      label: parsed[i].name || m.label,
      name: cand ? cand.name : null,
      party: cand ? cand.party : parsed[i].party,
      probability: Math.round(m.p * 1000) / 1000,
    };
  });
  const volume = Number(event.volume);
  return {
    source: "Polymarket",
    slug: event.slug,
    url: eventUrl(event.slug),
    volume: Number.isFinite(volume) ? Math.round(volume) : null,
    outcomes,
    otherProbability: Math.round(rest * 1000) / 1000,
  };
}
