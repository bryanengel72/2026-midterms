import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLabel, summarizeEvent, eventUrl, fetchEvents } from "../assets/markets.js";

const market = (label, yes, extra = {}) => ({
  groupItemTitle: label,
  outcomePrices: JSON.stringify([String(yes), String(1 - yes)]),
  active: true,
  closed: false,
  ...extra,
});

test("parseLabel reads names, parties and honorifics", () => {
  assert.deepEqual(parseLabel("James Talarico (D)"), { name: "James Talarico", party: "D", partyOnly: false, honorific: false });
  assert.deepEqual(parseLabel("Sen. Dan Sullivan"), { name: "Dan Sullivan", party: null, partyOnly: false, honorific: true });
  assert.deepEqual(parseLabel("Independent"), { name: "Independent", party: "I", partyOnly: true, honorific: false });
  assert.equal(parseLabel("Byron Donalds (R) ").party, "R");
});

test("summarizeEvent matches outcomes to candidates and drops placeholders", () => {
  const event = {
    slug: "alaska-senate-election-winner",
    volume: "2373396.2",
    markets: [
      market("Sen. Dan Sullivan", 0.275),
      market("Mary Peltola", 0.725),
      market("Daniel J. Sullivan Jr.", 0.0005),
      { groupItemTitle: "Candidate C", outcomePrices: null, active: false, closed: false },
    ],
  };
  const candidates = [
    { name: "Dan S. Sullivan", party: "R" },
    { name: "Mary Peltola", party: "D" },
    { name: "Daniel J. Sullivan Jr.", party: "I" },
  ];
  const s = summarizeEvent(event, candidates, { name: "Dan S. Sullivan", party: "R" });
  assert.equal(s.url, "https://polymarket.com/event/alaska-senate-election-winner");
  assert.equal(s.volume, 2373396);
  assert.deepEqual(
    s.outcomes.map((o) => [o.name, o.party, o.probability]),
    [
      ["Mary Peltola", "D", 0.725],
      ["Dan S. Sullivan", "R", 0.275],
    ],
  );
  assert.equal(s.otherProbability, 0.001); // the sub-1% outcome, rounded
});

test("summarizeEvent handles nicknames and party-only outcomes", () => {
  const maine = summarizeEvent(
    { slug: "maine-governor-winner-2026", volume: 60000, markets: [market("Hannah Pingree (D)", 0.97), market("Robert Charles (R)", 0.03)] },
    [{ name: "Hannah Pingree", party: "D" }, { name: "Bobby Charles", party: "R" }, { name: "Rick Bennett", party: "I" }],
  );
  assert.deepEqual(maine.outcomes.map((o) => o.name), ["Hannah Pingree", "Bobby Charles"]);

  const nebraska = summarizeEvent(
    { slug: "nebraska-senate-election-winner", volume: 1, markets: [market("Pete Ricketts (R)", 0.75), market("Independent", 0.25)] },
    [{ name: "Pete Ricketts", party: "R" }, { name: "Dan Osborn", party: "I" }],
  );
  assert.deepEqual(nebraska.outcomes.map((o) => o.name), ["Pete Ricketts", "Dan Osborn"]);

  // A label that matches nobody keeps Polymarket's own wording.
  const unknown = summarizeEvent(
    { slug: "x", volume: 1, markets: [market("Someone Else (D)", 0.6), market("Pete Ricketts (R)", 0.4)] },
    [{ name: "Pete Ricketts", party: "R" }],
  );
  assert.deepEqual(unknown.outcomes[0], { label: "Someone Else", name: null, party: "D", probability: 0.6 });
});

test("a candidate's surname alone does not match the wrong party", () => {
  const s = summarizeEvent(
    { slug: "x", volume: 1, markets: [market("Lindsey Graham (R)", 0.5), market("Pat Graham (D)", 0.5)] },
    [{ name: "Darline Graham", party: "R" }, { name: "Annie Andrews", party: "D" }],
  );
  assert.equal(s.outcomes.find((o) => o.label === "Pat Graham").name, null);
});

test("eventUrl rejects unexpected slugs", () => {
  assert.equal(eventUrl("texas-senate-election-winner"), "https://polymarket.com/event/texas-senate-election-winner");
  assert.equal(eventUrl("../evil"), null);
});

test("fetchEvents batches slugs into one query each", async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    const slugs = [...new URL(url).searchParams.getAll("slug")];
    return { ok: true, json: async () => slugs.map((slug) => ({ slug })) };
  };
  const out = await fetchEvents(["a", "b", "c", "BAD SLUG"], { fetchImpl: fake, batchSize: 2 });
  assert.equal(calls.length, 2);
  assert.deepEqual([...out.keys()], ["a", "b", "c"]);
});
