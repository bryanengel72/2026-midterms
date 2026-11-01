#!/usr/bin/env node
// Builds data/polls.json from Wikipedia's 2026 race articles.
//
//   node scripts/build-data.mjs            fetch every article, then build
//   node scripts/build-data.mjs --cache    reuse .cache/wikitext when present
//   node scripts/build-data.mjs --offline  build only from .cache/wikitext
//
// A race whose article cannot be fetched keeps its previous data (marked
// stale) so one bad request never blanks a state.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATES, listRaces, houseSeatsPage } from "./races.mjs";
import { fetchWikitext, pageUrl } from "./wiki.mjs";
import {
  parseRace,
  simpleAverage,
  partyCode,
  parseGenericBallot,
  parseHouseRatings,
  parseHouseTotals,
  districtSection,
} from "./parse-race.mjs";
import { parseInfobox, toPlainText } from "./wikitext.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "polls.json");
const CACHE = join(ROOT, ".cache", "wikitext");
const ELECTION_DATE = "2026-11-03";

const args = new Set(process.argv.slice(2));
const offline = args.has("--offline");
const useCache = offline || args.has("--cache");
const delayMs = Number(process.env.FETCH_DELAY_MS ?? 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function round1(n) {
  return Math.round(n * 10) / 10;
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** Picks the single best number to show for a race, and says where it came from. */
function headline(race, today) {
  const names = race.candidates.map((c) => c.name);
  const pack = (values, basis, detail) => {
    const ranked = names
      .filter((n) => typeof values[n] === "number")
      .map((n) => ({ name: n, value: values[n] }))
      .sort((a, b) => b.value - a.value);
    if (ranked.length < 2) return null;
    return {
      basis,
      detail,
      values,
      leader: ranked[0].value === ranked[1].value ? null : ranked[0].name,
      margin: round1(ranked[0].value - ranked[1].value),
    };
  };

  const avgRow = race.aggregates.find((a) => a.isAverage);
  const aggRows = race.aggregates.filter((a) => !a.isAverage);
  if (avgRow) {
    return pack(avgRow.values, "aggregate-average", `Average of ${aggRows.length} poll aggregators`);
  }
  if (aggRows.length) {
    const values = {};
    for (const n of names) {
      const m = mean(aggRows.map((a) => a.values[n]).filter((v) => typeof v === "number"));
      if (m !== null) values[n] = round1(m);
    }
    const detail =
      aggRows.length === 1
        ? `${aggRows[0].source} polling average`
        : `Average of ${aggRows.length} poll aggregators`;
    const h = pack(values, "aggregate", detail);
    if (h) return h;
  }
  const simple = simpleAverage(race.polls, race.candidates, { asOf: today, windowDays: 30 });
  if (simple) {
    const h = pack(
      simple.values,
      "simple-average",
      `Simple average of ${simple.pollCount} poll${simple.pollCount === 1 ? "" : "s"} from the last 30 days (newest per pollster)`,
    );
    if (h) return h;
  }
  const latest = race.polls[0];
  if (latest) {
    return pack(latest.values, "latest-poll", `Most recent poll: ${latest.pollster}, ${latest.dates}`);
  }
  return null;
}

/** The most common forecaster rating; ties go to the more competitive one. */
function consensus(ratings) {
  const order = ["Tossup", "Tilt", "Lean", "Likely", "Safe"];
  const counts = new Map();
  for (const r of ratings) counts.set(r.rating, (counts.get(r.rating) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const sa = order.indexOf(a[0].split(" ")[0]);
    const sb = order.indexOf(b[0].split(" ")[0]);
    return sa - sb;
  })[0];
  if (!best) return null;
  const sample = ratings.find((r) => r.rating === best[0]);
  return {
    rating: best[0],
    strength: sample.strength,
    lean: sample.lean,
    count: best[1],
    of: ratings.length,
  };
}

/** Everything except the timestamp, for change detection. */
function fingerprint(data) {
  const { generatedAt, ...rest } = data;
  return JSON.stringify(rest);
}

const SENATE_OVERVIEW = "2026 United States Senate elections";
const HOUSE_OVERVIEW = "2026 United States House of Representatives elections";
const GENERIC_BALLOT_POLLS = "Template:2026 United States elections/polling";
const HOUSE_RATINGS = "2026 United States House of Representatives election ratings";
const AT_LARGE = new Set(["AK", "DE", "ND", "SD", "VT", "WY"]);

function houseStatePage(code) {
  const name = STATES.find((st) => st.code === code).name;
  return AT_LARGE.has(code)
    ? `2026 United States House of Representatives election in ${name}`
    : `2026 United States House of Representatives elections in ${name}`;
}

/** Title of the "(districts A–B)" sub-article that covers `district`, if any. */
function subArticleFor(text, district) {
  const n = Number(district);
  if (!Number.isFinite(n)) return null;
  for (const m of text.matchAll(/\{\{\s*main\s*\|\s*([^}|]*\(districts?\s*(\d+)\s*[–-]\s*(\d+)\)[^}|]*)/gi)) {
    if (n >= Number(m[2]) && n <= Number(m[3])) return m[1].trim();
  }
  return null;
}

/**
 * Competitive House districts: the ratings article lists every district at
 * least one forecaster doesn't call safe; each district's candidates, polls
 * and results come from its section of the state's House article. A state
 * whose article can't be read keeps its districts' previous data.
 */
async function buildHouseDistricts(today, previous, failures) {
  const prevById = new Map((previous?.districts || []).map((d) => [d.id, d]));
  let page;
  try {
    page = await fetchWikitext(HOUSE_RATINGS, { cacheDir: CACHE, useCache, offline });
  } catch (err) {
    failures.push(`House ratings: ${err.message}`);
  }
  const rated = page ? parseHouseRatings(page.text) : [];
  if (!rated.length) {
    failures.push("House ratings: could not read; kept previous");
    return previous || null;
  }
  const byState = new Map();
  for (const d of rated) {
    if (!byState.has(d.state)) byState.set(d.state, []);
    byState.get(d.state).push(d);
  }
  const districts = [];
  const subPages = new Map();
  for (const [code, list] of byState) {
    let statePage = null;
    try {
      statePage = await fetchWikitext(houseStatePage(code), { cacheDir: CACHE, useCache, offline });
    } catch (err) {
      failures.push(`House ${code}: ${err.message}`);
    }
    for (const d of list) {
      const entry = {
        ...d,
        consensus: consensus(d.ratings),
        url: statePage
          ? pageUrl(statePage.title) + (d.district === "AL" ? "" : `#District_${d.district}`)
          : prevById.get(d.id)?.url || null,
      };
      let section = statePage ? districtSection(statePage.text, d.district) : null;
      if (!section && statePage) {
        // Big states split districts into sub-articles, e.g. California's
        // "(districts 1–26)" and "(districts 27–52)".
        const sub = subArticleFor(statePage.text, d.district);
        if (sub) {
          if (!subPages.has(sub)) {
            try {
              const sp = await fetchWikitext(sub, { cacheDir: CACHE, useCache, offline });
              subPages.set(sub, sp);
              if (sp && !sp.fromCache) await sleep(delayMs);
            } catch (err) {
              failures.push(`House ${code} (${sub}): ${err.message}`);
              subPages.set(sub, null);
            }
          }
          const sp = subPages.get(sub);
          if (sp) {
            section = districtSection(sp.text, d.district);
            if (section) entry.url = `${pageUrl(sp.title)}#District_${d.district}`;
          }
        }
      }
      if (section) {
        const parsed = parseRace(section, { id: d.id });
        entry.candidates = parsed.candidates.length ? parsed.candidates : parsed.nominees;
        entry.polls = parsed.polls;
        entry.aggregates = parsed.aggregates;
        entry.results = parsed.results;
        if (!entry.incumbent && parsed.incumbent) entry.incumbent = parsed.incumbent;
      } else {
        const prev = prevById.get(d.id);
        Object.assign(entry, {
          candidates: prev?.candidates || [],
          polls: prev?.polls || [],
          aggregates: prev?.aggregates || [],
          results: prev?.results || null,
          stale: Boolean(prev),
        });
      }
      entry.headline = headline(entry, today);
      entry.latestPoll = entry.polls[0]?.end || null;
      districts.push(entry);
    }
    if (statePage && !statePage.fromCache) await sleep(delayMs);
  }
  const forecasts = parseHouseTotals(page.text);
  return { url: pageUrl(page.title), districts, forecasts, safe: safeSeats(forecasts, districts) || previous?.safe || null };
}

/**
 * Seats outside the competitive table (every forecaster calls them safe), by
 * party: a forecaster's total minus the competitive seats it gives that
 * party. Forecasters whose numbers don't add up to the same 435 are skipped;
 * the most common answer wins.
 */
function safeSeats(forecasts, districts) {
  const outside = 435 - districts.length;
  const tally = new Map();
  for (const f of forecasts) {
    const lean = (side) => districts.filter((d) => d.ratings.find((r) => r.source === f.source)?.lean === side).length;
    const D = f.D - lean("D");
    const R = f.R - lean("R");
    if (D < 0 || R < 0 || D + R !== outside) continue;
    const key = `${D}|${R}`;
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const best = [...tally].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const [D, R] = best[0].split("|").map(Number);
  return { D, R, agreeing: best[1], of: forecasts.length };
}

/**
 * Reads the Senate's current makeup from the overview article's infobox:
 * seats each party holds now (seats_beforeN) and how many of those are on
 * the 2026 ballot (1dataN, the "Seats up" row). Returns null if unreadable.
 */
function parseSenateMakeup(text) {
  const info = parseInfobox(text);
  const before = { D: 0, R: 0, I: 0 };
  const up = { D: 0, R: 0, I: 0 };
  for (let i = 1; i <= 6; i++) {
    if (!info[`party${i}`]) continue;
    const party = partyCode(info[`party${i}`]);
    if (!(party in before)) continue;
    const num = (v) => parseInt(toPlainText(v || "").replace(/[^0-9]/g, ""), 10) || 0;
    before[party] += num(info[`seats_before${i}`]);
    up[party] += num(info[`1data${i}`]);
  }
  const total = before.D + before.R + before.I;
  if (total !== 100) return null;
  return {
    before,
    up,
    notUp: { D: before.D - up.D, R: before.R - up.R, I: before.I - up.I },
  };
}

async function loadPrevious() {
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    const byId = new Map();
    for (const s of prev.states || []) for (const r of s.races || []) byId.set(r.id, r);
    return {
      byId,
      fingerprint: fingerprint(prev),
      senate: prev.senate || null,
      genericBallot: prev.genericBallot || null,
      house: prev.house || null,
    };
  } catch {
    return { byId: new Map(), fingerprint: null, senate: null, genericBallot: null, house: null };
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const {
    byId: previous,
    fingerprint: previousFingerprint,
    senate: previousSenate,
    genericBallot: previousGenericBallot,
    house: previousHouse,
  } = await loadPrevious();
  const races = listRaces();
  const built = new Map();
  const failures = [];

  for (const [i, race] of races.entries()) {
    let page = null;
    try {
      page = await fetchWikitext(race.page, { cacheDir: CACHE, useCache, offline });
    } catch (err) {
      failures.push(`${race.id}: ${err.message}`);
    }

    if (!page) {
      const prev = previous.get(race.id);
      if (prev) built.set(race.id, { ...prev, stale: true });
      else failures.push(`${race.id}: no article and no previous data`);
      continue;
    }

    const parsed = parseRace(page.text, race);
    const entry = {
      id: race.id,
      office: race.office,
      label: race.label,
      article: page.title,
      url: pageUrl(page.title),
      incumbent: parsed.incumbent,
      candidates: parsed.candidates.length ? parsed.candidates : parsed.nominees,
      results: parsed.results,
      ratings: parsed.ratings,
      aggregates: parsed.aggregates,
      polls: parsed.polls,
    };
    entry.headline = headline(entry, today);
    entry.consensus = consensus(entry.ratings);
    entry.latestPoll = entry.polls[0]?.end || null;
    built.set(race.id, entry);
    process.stdout.write(
      `${String(i + 1).padStart(2)}/${races.length} ${race.id.padEnd(9)} ${String(entry.polls.length).padStart(3)} polls\n`,
    );
    if (!page.fromCache) await sleep(delayMs);
  }

  // Senate makeup for the seat chart; keep the previous one if unreadable.
  let senate = null;
  try {
    const page = await fetchWikitext(SENATE_OVERVIEW, { cacheDir: CACHE, useCache, offline });
    senate = page ? parseSenateMakeup(page.text) : null;
    if (senate) senate.url = pageUrl(page.title);
  } catch (err) {
    failures.push(`Senate overview: ${err.message}`);
  }
  if (!senate) {
    senate = previousSenate;
    failures.push("Senate overview: could not read seat counts; kept previous");
  }

  // House generic ballot: aggregates from the House article, polls from the
  // polling template. Keep the previous data if either can't be read.
  let genericBallot = null;
  try {
    const house = await fetchWikitext(HOUSE_OVERVIEW, { cacheDir: CACHE, useCache, offline });
    const pollsPage = await fetchWikitext(GENERIC_BALLOT_POLLS, { cacheDir: CACHE, useCache, offline });
    if (house && pollsPage) {
      const gb = parseGenericBallot(house.text, pollsPage.text);
      if (gb.aggregates.length || gb.polls.length) {
        const entry = {
          id: "US-HOUSE",
          label: "House generic ballot",
          url: pageUrl(house.title),
          pollsUrl: pageUrl(pollsPage.title),
          candidates: [
            { name: "Democrats", party: "D", nominee: true },
            { name: "Republicans", party: "R", nominee: true },
          ],
          aggregates: gb.aggregates,
          polls: gb.polls,
        };
        entry.headline = headline(entry, today);
        entry.latestPoll = entry.polls[0]?.end || null;
        genericBallot = entry;
      }
    }
  } catch (err) {
    failures.push(`Generic ballot: ${err.message}`);
  }
  if (!genericBallot) {
    genericBallot = previousGenericBallot;
    failures.push("Generic ballot: could not read; kept previous");
  }

  const house = await buildHouseDistricts(today, previousHouse, failures);
  if (house) {
    const n = house.districts.length;
    const polled = house.districts.filter((d) => d.polls.length).length;
    console.log(`House: ${n} competitive districts, ${polled} with polls; safe seats ${house.safe ? `${house.safe.D} D, ${house.safe.R} R` : "unknown"}; ${house.forecasts?.length || 0} forecaster totals`);
  }

  const withPolls = [...built.values()].filter((r) => r.polls.length).length;
  const prevWithPolls = [...previous.values()].filter((r) => r.polls?.length).length;
  if (prevWithPolls && withPolls < prevWithPolls * 0.5) {
    console.error(
      `Refusing to write: only ${withPolls} races have polls (previously ${prevWithPolls}). ` +
        `Wikipedia may be down or its table layout changed.`,
    );
    process.exit(1);
  }

  const data = {
    generatedAt: new Date().toISOString(),
    electionDate: ELECTION_DATE,
    source: {
      name: "Wikipedia",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      note: "Polls, aggregates and ratings are read from each race's English Wikipedia article.",
    },
    senate,
    genericBallot,
    house,
    states: STATES.map(({ code, name }) => ({
      code,
      name,
      houseUrl: pageUrl(houseSeatsPage(name)),
      races: races.filter((r) => r.state === code).map((r) => built.get(r.id)).filter(Boolean),
    })),
  };

  const total = [...built.values()].reduce((n, r) => n + r.polls.length, 0);
  if (previousFingerprint && fingerprint(data) === previousFingerprint) {
    console.log(`\nNo changes since the last build (${built.size} races, ${total} polls). Left ${OUT} as is.`);
  } else {
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(data, null, 1) + "\n");
    console.log(`\nWrote ${OUT}: ${built.size} races, ${withPolls} with polls, ${total} polls.`);
  }
  if (failures.length) {
    console.warn(`\n${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
