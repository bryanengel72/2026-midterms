// Turns one Wikipedia race article into structured poll data.

import {
  listTemplates,
  findTables,
  listSections,
  parseInfobox,
  parseTable,
  stripNoise,
  toPlainText,
} from "./wikitext.mjs";

// ---------------------------------------------------------------------------
// Parties and names
// ---------------------------------------------------------------------------

export function partyCode(text) {
  const t = toPlainText(text || "").toLowerCase();
  if (!t) return null;
  if (/democratic.farmer.labor|\bdfl\b/.test(t)) return "D";
  if (/democrat/.test(t)) return "D";
  if (/republican|\bgop\b/.test(t)) return "R";
  if (/libertarian/.test(t)) return "L";
  if (/green/.test(t)) return "G";
  if (/independen|nonpartisan|no party|unaffiliated|forward|alliance/.test(t)) return "I";
  if (/constitution|taxpayers/.test(t)) return "C";
  return "O";
}

const PARTY_SUFFIX = /\(\s*([A-Z][A-Za-z.\-–]{0,6})\s*\)\s*$/;

function suffixToParty(s) {
  const u = s.toUpperCase().replace(/[.\s]/g, "");
  if (u === "D" || u === "DFL" || u === "DEM") return "D";
  if (u === "R" || u === "REP" || u === "GOP") return "R";
  if (u === "L" || u === "LIB") return "L";
  if (u === "G" || u === "GRN") return "G";
  if (u === "I" || u === "IND" || u === "NPA" || u === "U") return "I";
  if (u === "C" || u === "CON" || u === "UST") return "C";
  return "O";
}

/** "Jon Ossoff (D)" -> { name: "Jon Ossoff", party: "D" } */
export function splitNameParty(header) {
  const m = header.match(PARTY_SUFFIX);
  if (!m) return { name: header.trim(), party: null };
  return { name: header.slice(0, m.index).trim(), party: suffixToParty(m[1]) };
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

export function surname(name) {
  const tokens = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !SUFFIXES.has(t));
  return tokens[tokens.length - 1] || "";
}

function firstInitial(name) {
  const t = name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /^[a-z]/.test(t) ? t[0] : "";
}

/**
 * Same surname, compatible party, and (when both names have one) the same
 * first initial, so "Lindsey Graham" and "Darline Graham" stay distinct.
 */
function sameCandidate(a, b) {
  if (surname(a.name) !== surname(b.name)) return false;
  if (a.party && b.party && a.party !== b.party) return false;
  const ia = firstInitial(a.name);
  const ib = firstInitial(b.name);
  const multiWord = (n) => n.trim().split(/\s+/).length > 1;
  if (multiWord(a.name) && multiWord(b.name) && ia && ib && ia !== ib) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Numbers and dates
// ---------------------------------------------------------------------------

/** "'''52.0%'''" -> 52, "<1%" -> 0.5, "–" -> null */
export function parsePercent(text) {
  if (!text) return null;
  const t = text.replace(/,/g, "");
  if (/^\s*<\s*1\s*%/.test(t)) return 0.5;
  const m = t.match(/(-?\d+(?:\.\d+)?)\s*%/) || t.match(/^\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m ? Number(m[1]) : null;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9,
  sept: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Parses date ranges as Wikipedia writes them:
 *   "October 16–23, 2026", "September 29 – October 2, 2026",
 *   "December 28, 2025 – January 3, 2026", "through October 20, 2026",
 *   "October 2026".
 * Returns { start, end } as ISO dates (either may be null).
 */
export function parseDateRange(text, fallbackYear = 2026) {
  if (!text) return { start: null, end: null };
  const t = text.replace(/[–—−]/g, "-");
  const tokens = [...t.matchAll(/([A-Za-z]{3,9})\.?|(\d{4})|(\d{1,2})(?:st|nd|rd|th)?/g)];
  const parts = [];
  for (const m of tokens) {
    if (m[1]) {
      const mon = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
      if (mon) parts.push({ type: "month", value: mon });
    } else if (m[2]) {
      parts.push({ type: "year", value: Number(m[2]) });
    } else if (m[3]) {
      parts.push({ type: "day", value: Number(m[3]) });
    }
  }
  const months = parts.filter((p) => p.type === "month");
  if (months.length === 0) return { start: null, end: null };
  const years = parts.filter((p) => p.type === "year").map((p) => p.value);
  const endYear = years.length ? years[years.length - 1] : fallbackYear;

  // Walk the tokens, tracking the month in effect for each day number.
  let month = null;
  let year = null;
  const dates = [];
  for (const p of parts) {
    if (p.type === "month") month = p.value;
    else if (p.type === "year") {
      year = p.value;
      for (const d of dates) if (d.y === null) d.y = year;
    } else if (p.type === "day" && month) dates.push({ m: month, d: p.value, y: null });
  }
  if (dates.length === 0) {
    // Month-only, e.g. "October 2026": treat as the whole month.
    const m0 = months[0].value;
    const m1 = months[months.length - 1].value;
    const y0 = years[0] ?? endYear;
    const lastDay = new Date(Date.UTC(endYear, m1, 0)).getUTCDate();
    return { start: iso(y0, m0, 1), end: iso(endYear, m1, lastDay) };
  }
  for (const d of dates) if (d.y === null) d.y = year ?? endYear;
  const first = dates[0];
  const last = dates[dates.length - 1];
  // "December 28 – January 3, 2026": start belongs to the previous year.
  if (first.y === last.y && first.m > last.m && years.length <= 1) first.y = last.y - 1;
  return { start: iso(first.y, first.m, first.d), end: iso(last.y, last.m, last.d) };
}

// ---------------------------------------------------------------------------
// Column classification
// ---------------------------------------------------------------------------

function classifyHeader(h) {
  const t = h.toLowerCase();
  if (/source of poll|aggregat/.test(t)) return "aggregator";
  if (/poll source|pollster|^source$|^poll$/.test(t)) return "pollster";
  if (/updated/.test(t)) return "updated";
  if (/date/.test(t)) return "dates";
  if (/sample/.test(t)) return "sample";
  if (/margin.*error|^moe$/.test(t)) return "moe";
  if (/^margin$|^lead$|^spread$/.test(t)) return "margin";
  if (/^(rcv\b|round\b|ranked)|\brcv round\b/.test(t)) return "round";
  if (/^other\s*\/\s*undecided|^undecided\s*\/\s*other/.test(t)) return "otherUndecided";
  if (/undecided|not ranked|don.t know|unsure|refused/.test(t)) return "undecided";
  if (/^others?\b|^someone else|^another/.test(t)) return "other";
  if (/^(ranking|rating|as of)$/.test(t)) return "meta";
  return "candidate";
}

function headerRowCount(grid) {
  let n = 0;
  for (const row of grid) {
    const fresh = row.filter((g) => g && !g.carried);
    if (fresh.length && fresh.every((g) => g.cell.header)) n++;
    else break;
  }
  return n;
}

function columnHeaders(grid, nHeader) {
  const width = Math.max(...grid.map((r) => r.length));
  const headers = [];
  for (let c = 0; c < width; c++) {
    const seen = [];
    for (let r = 0; r < nHeader; r++) {
      const g = grid[r][c];
      if (g && g.cell.text && !seen.includes(g.cell.text)) seen.push(g.cell.text);
    }
    headers.push(seen.join(" ").trim());
  }
  return headers;
}

/**
 * Interprets a parsed table grid. Returns null for tables that are not
 * polling tables, otherwise { kind: "polls" | "aggregate", columns, rows }.
 */
export function interpretPollTable(grid) {
  if (grid.length < 2) return null;
  const nHeader = headerRowCount(grid);
  if (nHeader === 0) return null;
  const headers = columnHeaders(grid, nHeader);
  const columns = headers.map((h, i) => {
    const role = classifyHeader(h);
    const col = { index: i, header: h, role };
    if (role === "candidate") Object.assign(col, splitNameParty(h));
    return col;
  });
  const roles = new Set(columns.map((c) => c.role));
  if (roles.has("round")) return null; // ranked-choice round tables
  const kind = roles.has("aggregator") ? "aggregate" : roles.has("pollster") ? "polls" : null;
  if (!kind) return null;
  const candidates = columns.filter((c) => c.role === "candidate" && c.name);
  if (candidates.length < 2) return null;
  return { kind, columns, candidates, rows: grid.slice(nHeader) };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function cellAt(row, col) {
  return col ? row[col.index] : undefined;
}

function textAt(row, col) {
  const g = cellAt(row, col);
  return g ? g.cell.text : "";
}

function readValues(row, candidates) {
  const values = {};
  let any = false;
  for (const c of candidates) {
    const v = parsePercent(textAt(row, c));
    values[c.name] = v;
    if (v !== null) any = true;
  }
  return any ? values : null;
}

function cleanPollster(text) {
  return text.replace(/\s+/g, " ").trim();
}

function parseSample(text) {
  const m = text.replace(/,/g, "").match(/(\d+)\s*(?:\(\s*([A-Za-z]+)\s*\))?/);
  return {
    sample: m ? Number(m[1]) : null,
    population: m && m[2] ? m[2].toUpperCase() : (text.match(/\b(LV|RV|A|V)\b/) || [])[1] || null,
  };
}

function parseMoe(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

export function readPollRows(table) {
  const col = (role) => table.columns.find((c) => c.role === role);
  const pollsterCol = col("pollster");
  const datesCol = col("dates");
  const sampleCol = col("sample");
  const moeCol = col("moe");
  const otherCol = col("other");
  const undecidedCol = col("undecided");
  const otherUndecidedCol = col("otherUndecided");
  const polls = [];
  const seenGroups = new Set();
  for (const row of table.rows) {
    const p = cellAt(row, pollsterCol);
    if (!p || !p.cell.text) continue;
    if (p.cell.colspan > 2) continue; // separator / note rows
    // Rows sharing one rowspanned pollster cell are variants of a single poll
    // (leaners pushed, head-to-head versions, other populations). The first
    // row with numbers is the headline result.
    if (seenGroups.has(p.cell)) continue;
    const values = readValues(row, table.candidates);
    if (!values) continue;
    seenGroups.add(p.cell);
    const dates = textAt(row, datesCol);
    const { start, end } = parseDateRange(dates);
    const { sample, population } = parseSample(textAt(row, sampleCol));
    let other = otherCol ? parsePercent(textAt(row, otherCol)) : null;
    let undecided = undecidedCol
      ? parsePercent(textAt(row, undecidedCol))
      : parsePercent(textAt(row, otherUndecidedCol));
    // One cell spanning both "Other" and "Undecided" is a combined figure.
    if (otherCol && undecidedCol && cellAt(row, otherCol)?.cell === cellAt(row, undecidedCol)?.cell) {
      other = null;
    }
    polls.push({
      pollster: cleanPollster(p.cell.text),
      dates,
      start,
      end,
      sample,
      population,
      moe: parseMoe(textAt(row, moeCol)),
      values,
      other,
      undecided,
    });
  }
  return polls;
}

export function readAggregateRows(table) {
  const col = (role) => table.columns.find((c) => c.role === role);
  const sourceCol = col("aggregator");
  const datesCol = col("dates");
  const updatedCol = col("updated");
  const otherCol = col("otherUndecided") || col("other") || col("undecided");
  const rows = [];
  for (const row of table.rows) {
    const s = cellAt(row, sourceCol);
    if (!s || !s.cell.text) continue;
    const values = readValues(row, table.candidates);
    if (!values) continue;
    const isAverage = /^average$/i.test(s.cell.text.trim());
    rows.push({
      source: s.cell.text.trim(),
      isAverage,
      dates: isAverage ? "" : textAt(row, datesCol),
      updated: isAverage ? "" : textAt(row, updatedCol),
      updatedIso: isAverage ? null : parseDateRange(textAt(row, updatedCol)).end,
      values,
      otherUndecided: otherCol ? parsePercent(textAt(row, otherCol)) : null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

const STRENGTHS = ["Safe", "Solid", "Likely", "Lean", "Tilt", "Tossup"];

export function normalizeRating(text) {
  const flip = /\bflip\b/i.test(text);
  const t = text
    .replace(/\(?\s*\bflip\b\s*\)?/gi, "")
    .replace(/toss[\s-]*up/i, "Tossup")
    .replace(/\s+/g, " ")
    .trim();
  if (/tossup/i.test(t)) return { rating: "Tossup", strength: "Tossup", lean: null, flip: false };
  const strength = STRENGTHS.find((s) => new RegExp(`\\b${s}\\b`, "i").test(t)) || null;
  const m = t.match(/\b(D|R|I|DFL|Dem|Rep|Democratic|Republican|Independent)\b\s*$/i);
  let lean = null;
  if (m) {
    const v = m[1].toLowerCase();
    lean = v.startsWith("d") ? "D" : v.startsWith("r") ? "R" : "I";
  }
  const s = strength === "Solid" ? "Safe" : strength;
  return {
    rating: s && lean ? `${s} ${lean}` : t,
    strength: s,
    lean,
    flip,
  };
}

function readRatings(sectionText) {
  for (const t of findTables(sectionText)) {
    const grid = parseTable(t.text);
    const nHeader = headerRowCount(grid);
    if (!nHeader) continue;
    const headers = columnHeaders(grid, nHeader).map((h) => h.toLowerCase());
    const srcIdx = headers.findIndex((h) => /^source/.test(h));
    const rankIdx = headers.findIndex((h) => /ranking|rating/.test(h));
    const asOfIdx = headers.findIndex((h) => /as of/.test(h));
    if (srcIdx === -1 || rankIdx === -1) continue;
    const ratings = [];
    for (const row of grid.slice(nHeader)) {
      const src = row[srcIdx]?.cell.text;
      const rank = row[rankIdx]?.cell.text;
      if (!src || !rank) continue;
      ratings.push({
        source: src.replace(/^The\s+/, ""),
        ...normalizeRating(rank),
        asOf: asOfIdx === -1 ? "" : row[asOfIdx]?.cell.text || "",
      });
    }
    if (ratings.length) return ratings;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Infobox
// ---------------------------------------------------------------------------

function readNominees(info) {
  const nominees = [];
  for (let i = 1; i <= 8; i++) {
    const raw = info[`nominee${i}`] ?? info[`candidate${i}`];
    if (!raw) continue;
    const full = toPlainText(raw);
    if (!full) continue;
    // "Troy Jackson (replacing Graham Platner)" -> name + note
    const m = full.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const name = m ? m[1] : full;
    const partyName = toPlainText(info[`party${i}`] || "").replace(/\s*\(United States\)$/, "");
    const nominee = { name, party: partyCode(info[`party${i}`]), partyName };
    if (m) nominee.note = m[2];
    nominees.push(nominee);
  }
  return nominees;
}

function readIncumbent(info) {
  const name = toPlainText(info.before_election || "");
  if (!name) return null;
  return { name, party: partyCode(info.before_party) };
}

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

function findGeneralElection(text, sections) {
  const ge = sections.find((s) => s.level === 2 && /^general election$/i.test(s.title));
  if (ge) return ge;
  return sections.find((s) => /general election/i.test(s.title)) || null;
}

// ---------------------------------------------------------------------------
// Results (election night)
// ---------------------------------------------------------------------------

function parseCount(text) {
  const n = Number(toPlainText(text || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Reads the general election's {{Election box}} from its Results section.
 * Returns null until at least one candidate has votes. `winner` is set when
 * editors mark exactly one winning candidate; two or more marked winners
 * means they advance to a runoff (Georgia, Louisiana).
 */
export function parseResults(sectionText) {
  const start = sectionText.search(/\{\{\s*Election box begin/i);
  if (start === -1) return null;
  const endMatch = sectionText.slice(start).search(/\{\{\s*Election box end/i);
  const block = sectionText.slice(start, endMatch === -1 ? undefined : start + endMatch);
  const candidates = [];
  let total = null;
  for (const t of listTemplates(block)) {
    if (/^election box (winning )?candidate/.test(t.name)) {
      const name = toPlainText(t.params.candidate || "").replace(/\s*\((incumbent|write-in)\)\s*$/i, "").trim();
      if (!name) continue;
      candidates.push({
        name,
        party: partyCode(t.params.party || ""),
        votes: parseCount(t.params.votes),
        percentage: parseCount(t.params.percentage),
        winner: t.name.startsWith("election box winning"),
      });
    } else if (/^election box total/.test(t.name)) {
      total = parseCount(t.params.votes);
    }
  }
  if (!candidates.some((c) => c.votes)) return null;
  const sum = candidates.reduce((n, c) => n + (c.votes || 0), 0);
  const totalVotes = total || sum;
  for (const c of candidates) {
    if (c.percentage === null && c.votes) c.percentage = Math.round((c.votes / totalVotes) * 1000) / 10;
  }
  candidates.sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const winners = candidates.filter((c) => c.winner);
  return {
    candidates,
    totalVotes,
    winner: winners.length === 1 ? winners[0].name : null,
    runoff: winners.length > 1,
  };
}

/**
 * Parses a race article. `race` is an entry from races.mjs.
 */
export function parseRace(wikitext, race) {
  const text = stripNoise(wikitext);
  const info = parseInfobox(wikitext);
  const nominees = readNominees(info);
  const incumbent = readIncumbent(info);
  const sections = listSections(text);
  const general = findGeneralElection(text, sections);

  const result = {
    nominees,
    incumbent,
    results: null,
    ratings: [],
    aggregates: [],
    polls: [],
    candidates: [],
  };
  if (!general) return result;

  const inGeneral = sections.filter(
    (s) => s.start >= general.start && s.start < general.end,
  );
  const resultsSection = inGeneral.find((s) => /^results$/i.test(s.title));
  if (resultsSection) result.results = parseResults(text.slice(resultsSection.bodyStart, resultsSection.end));

  const predictions = inGeneral.find((s) => /prediction|rating|forecast/i.test(s.title));
  if (predictions) result.ratings = readRatings(text.slice(predictions.bodyStart, predictions.end));

  const polling = inGeneral.find((s) => /^poll/i.test(s.title));
  if (!polling) return result;

  const pollingText = text.slice(polling.bodyStart, polling.end);
  // Sub-sections such as "Ranked-choice polls" or "Runoff" are skipped;
  // first-choice polls are what most readers mean by "the polls".
  const skipRanges = sections
    .filter(
      (s) =>
        s.start > polling.start &&
        s.start < polling.end &&
        /ranked|rcv|instant|runoff|hypothetical|primary/i.test(s.title),
    )
    .map((s) => [s.start - polling.bodyStart, s.end - polling.bodyStart]);

  const tables = findTables(pollingText)
    .filter((t) => !t.hidden)
    .filter((t) => !skipRanges.some(([a, b]) => t.start >= a && t.start < b))
    .map((t) => interpretPollTable(parseTable(t.text)))
    .filter(Boolean);

  // The headline match-up is the nominees named in the infobox. Tables that
  // do not include the top two nominees are hypothetical match-ups.
  const leaders = nominees.slice(0, 2);
  const matches = (table) =>
    leaders.length < 2 ||
    leaders.every((n) => table.candidates.some((c) => sameCandidate(c, n)));

  const pollTables = tables.filter((t) => t.kind === "polls" && matches(t));
  const aggTables = tables.filter((t) => t.kind === "aggregate" && matches(t));

  // Canonical candidate list: nominees first, then anyone else polled.
  const canon = [];
  const canonical = (c) => {
    let hit = canon.find((k) => sameCandidate(k, c));
    if (!hit) {
      const nominee = nominees.find((n) => sameCandidate(n, c));
      hit = {
        name: nominee ? nominee.name : c.name,
        party: (nominee && nominee.party) || c.party || null,
        nominee: Boolean(nominee),
      };
      if (nominee?.partyName) hit.partyName = nominee.partyName;
      if (nominee?.note) hit.note = nominee.note;
      canon.push(hit);
    }
    return hit.name;
  };
  for (const n of leaders) canonical(n);

  const rename = (values, table) => {
    const out = {};
    for (const c of table.candidates) {
      if (values[c.name] === null || values[c.name] === undefined) continue;
      out[canonical(c)] = values[c.name];
    }
    return out;
  };

  const seen = new Set();
  for (const table of pollTables) {
    for (const p of readPollRows(table)) {
      const key = `${p.pollster}|${p.dates}`;
      if (seen.has(key)) continue;
      seen.add(key);
      p.values = rename(p.values, table);
      if (Object.keys(p.values).length < 2) continue;
      result.polls.push(p);
    }
  }
  for (const table of aggTables) {
    for (const a of readAggregateRows(table)) {
      a.values = rename(a.values, table);
      result.aggregates.push(a);
    }
  }

  // Newest first. Wikipedia lists newest first, but be explicit.
  result.polls.sort((a, b) => (b.end || "").localeCompare(a.end || ""));
  result.candidates = canon;
  return result;
}

// ---------------------------------------------------------------------------
// Competitive House districts
// ---------------------------------------------------------------------------

/**
 * Reads the "Latest published ratings for competitive seats" table of the
 * House election ratings article: one row per district with its Cook PVI,
 * incumbent, last result and each forecaster's rating.
 */
export function parseHouseRatings(text) {
  const clean = stripNoise(text);
  const sections = listSections(clean);
  const sec = sections.find((s) => /latest published ratings/i.test(s.title)) || sections[0];
  const body = sec ? clean.slice(sec.bodyStart, sec.end) : clean;
  const table = findTables(body)[0];
  if (!table) return [];
  const grid = parseTable(table.text);
  // The last all-header row names the columns (District, CPVI, ... , Cook, IE, ...).
  let headerIdx = -1;
  grid.forEach((row, i) => {
    if (row.every((g) => g && g.cell.header) && row.some((g) => /district/i.test(g.cell.text))) headerIdx = i;
  });
  if (headerIdx === -1) return [];
  const names = grid[headerIdx].map((g) => g.cell.text.replace(/\s*[A-Z][a-z]{2}\.?\s*\d+,.*$/, "").trim());
  const col = (re) => names.findIndex((n) => re.test(n));
  const iPvi = col(/pvi/i);
  const iInc = col(/^incumbent$/i);
  const iLast = col(/last result/i);
  const firstRating = iLast + 1;
  const out = [];
  for (const row of grid.slice(headerIdx + 1)) {
    const head = row[0]?.cell;
    const m = head?.raw.match(/ushr\s*\|\s*([A-Z]{2})\s*\|\s*([^|}]+)/i);
    if (!m) continue;
    const state = m[1].toUpperCase();
    const num = m[2].trim().toUpperCase() === "AL" ? "AL" : String(parseInt(m[2], 10));
    const pviRaw = iPvi >= 0 ? row[iPvi]?.cell.raw || "" : "";
    const pm = pviRaw.match(/PVI\s*\|\s*([DR])\s*\|\s*(\d+)/i);
    const pvi = pm ? `${pm[1].toUpperCase()}+${pm[2]}` : /even/i.test(toPlainText(pviRaw)) ? "EVEN" : null;
    const incCell = iInc >= 0 ? row[iInc]?.cell : null;
    const incName = incCell ? incCell.text : "";
    const incParty = incCell ? (/Democratic/i.test(incCell.attrs) ? "D" : /Republican/i.test(incCell.attrs) ? "R" : null) : null;
    const ratings = [];
    for (let c = firstRating; c < names.length; c++) {
      const cell = row[c]?.cell;
      if (!cell || !cell.text) continue;
      ratings.push({ source: names[c], ...normalizeRating(cell.text) });
    }
    out.push({
      id: `${state}-${num}`,
      state,
      district: num,
      pvi,
      incumbent: incName && !/^(vacant|open)/i.test(incName) ? { name: incName, party: incParty } : null,
      lastResult: iLast >= 0 ? row[iLast]?.cell.text || null : null,
      ratings,
    });
  }
  return out;
}

/**
 * The part of a state's House article about one district: its
 * "==District N==" section, or the whole article for at-large seats.
 */
export function districtSection(text, district) {
  if (district === "AL") {
    const secs = listSections(text);
    const al = secs.find((s) => s.level === 2 && /at.large/i.test(s.title));
    return al ? text.slice(al.start, al.end) : text;
  }
  const secs = listSections(text);
  const sec = secs.find((s) => s.level === 2 && new RegExp(`^District\\s+${district}$`, "i").test(s.title));
  return sec ? text.slice(sec.start, sec.end) : null;
}

// ---------------------------------------------------------------------------
// House generic ballot
// ---------------------------------------------------------------------------

function partyKey(name) {
  const t = name.toLowerCase();
  if (t.startsWith("democrat")) return "Democrats";
  if (t.startsWith("republican")) return "Republicans";
  return null;
}

function renameParties(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const key = partyKey(k);
    if (key && typeof v === "number") out[key] = v;
  }
  return out;
}

/**
 * The national House generic ballot. Aggregator averages come from the
 * House elections article (its "GenericBallotAgg" section); individual polls
 * from the first (current-cycle) table of the polling template. Values are
 * keyed "Democrats" and "Republicans".
 */
export function parseGenericBallot(houseText, pollingText) {
  const out = { aggregates: [], polls: [] };
  const agg = stripNoise(houseText || "").match(/<section begin="?GenericBallotAgg"?\s*\/>([\s\S]*?)<section end/i);
  if (agg) {
    for (const t of findTables(agg[1])) {
      const table = interpretPollTable(parseTable(t.text));
      if (table?.kind !== "aggregate") continue;
      for (const row of readAggregateRows(table)) {
        row.values = renameParties(row.values);
        if (Object.keys(row.values).length === 2) out.aggregates.push(row);
      }
      break;
    }
  }
  const text = stripNoise(pollingText || "");
  const first = findTables(text).find((t) => !t.hidden);
  if (first) {
    const table = interpretPollTable(parseTable(first.text));
    if (table?.kind === "polls") {
      for (const p of readPollRows(table)) {
        p.values = renameParties(p.values);
        if (Object.keys(p.values).length === 2) out.polls.push(p);
      }
    }
  }
  out.polls.sort((a, b) => (b.end || "").localeCompare(a.end || ""));
  return out;
}

// ---------------------------------------------------------------------------
// Averages
// ---------------------------------------------------------------------------

/**
 * Unweighted average of recent polls: the newest poll from each pollster
 * that finished within `windowDays` of `asOf`.
 */
export function simpleAverage(polls, candidates, { asOf, windowDays = 30 } = {}) {
  const cutoff = asOf ? new Date(Date.parse(asOf) - windowDays * 86400000) : null;
  const byPollster = new Map();
  for (const p of polls) {
    if (!p.end) continue;
    if (cutoff && new Date(p.end) < cutoff) continue;
    const key = p.pollster.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase();
    if (!byPollster.has(key)) byPollster.set(key, p); // polls are newest first
  }
  const used = [...byPollster.values()];
  if (used.length === 0) return null;
  const values = {};
  for (const c of candidates) {
    const nums = used.map((p) => p.values[c.name]).filter((v) => typeof v === "number");
    if (nums.length) values[c.name] = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  }
  return {
    values,
    pollCount: used.length,
    windowDays,
    from: used.map((p) => p.end).sort()[0],
    to: used.map((p) => p.end).sort().at(-1),
  };
}
