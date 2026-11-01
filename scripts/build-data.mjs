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
import { parseRace, simpleAverage } from "./parse-race.mjs";

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

async function loadPrevious() {
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    const byId = new Map();
    for (const s of prev.states || []) for (const r of s.races || []) byId.set(r.id, r);
    return { byId, fingerprint: fingerprint(prev) };
  } catch {
    return { byId: new Map(), fingerprint: null };
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const { byId: previous, fingerprint: previousFingerprint } = await loadPrevious();
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
