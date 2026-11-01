import { test } from "node:test";
import assert from "node:assert/strict";
import { toPlainText, parseTable, findTables, splitTopLevel } from "../scripts/wikitext.mjs";
import {
  parseDateRange,
  parsePercent,
  normalizeRating,
  splitNameParty,
  parseRace,
  parseResults,
  parseGenericBallot,
  parseHouseRatings,
  parseHouseTotals,
  districtSection,
  simpleAverage,
} from "../scripts/parse-race.mjs";
import { listRaces, STATES } from "../scripts/races.mjs";

test("race list covers 50 states, 35 Senate and 36 governor races", () => {
  const races = listRaces();
  assert.equal(STATES.length, 50);
  assert.equal(races.filter((r) => r.office === "Senate").length, 35);
  assert.equal(races.filter((r) => r.office === "Governor").length, 36);
  assert.ok(races.some((r) => r.id === "OH-SEN-S"));
  assert.ok(races.some((r) => r.id === "FL-SEN-S"));
});

test("toPlainText strips links, templates, footnotes and markup", () => {
  assert.equal(toPlainText("[[Mike Collins (politician)|Mike Collins]] (R)"), "Mike Collins (R)");
  assert.equal(toPlainText("Jon<br />Ossoff (D)"), "Jon Ossoff (D)");
  assert.equal(toPlainText("'''55%'''{{efn|Allen Buckley (L) with 3%}}"), "55%");
  assert.equal(toPlainText("±&nbsp;5.2%"), "± 5.2%");
  assert.equal(toPlainText("{{sdash}}"), "–");
  assert.equal(toPlainText("Margin<br />{{nowrap|of error}}"), "Margin of error");
  assert.equal(toPlainText("{{USRaceRating|Lean|D}}"), "Lean D");
  assert.equal(toPlainText('Poll<ref name="x">{{cite web|url=a|title=b}}</ref> source'), "Poll source");
});

test("splitTopLevel ignores separators inside templates and links", () => {
  assert.deepEqual(splitTopLevel("a||{{x|y||z}}||[[p|q]]", "||"), ["a", "{{x|y||z}}", "[[p|q]]"]);
});

test("parseTable expands rowspans and separates cell attributes", () => {
  const grid = parseTable(
    [
      "{| class=wikitable",
      "! Poll !! Date !! A (D) !! B (R)",
      "|-",
      '|rowspan=2 style="text-align:left;"|Acme',
      "|rowspan=2|October 1–3, 2026",
      "|{{party shading/Democratic}}|'''50%'''",
      "|45%",
      "|-",
      "|52% || 46%",
      "|}",
    ].join("\n"),
  );
  assert.equal(grid.length, 3);
  assert.deepEqual(grid[1].map((g) => g.cell.text), ["Acme", "October 1–3, 2026", "50%", "45%"]);
  assert.deepEqual(grid[2].map((g) => g.cell.text), ["Acme", "October 1–3, 2026", "52%", "46%"]);
  assert.equal(grid[2][0].carried, true);
  assert.equal(grid[2][2].carried, false);
});

test("findTables flags tables inside {{hidden begin}} blocks", () => {
  const tables = findTables(
    "{|\n! a\n|}\n{{hidden begin|title=Hypothetical polling}}\n{|\n! b\n|}\n{{hidden end}}\n{|\n! c\n|}",
  );
  assert.deepEqual(tables.map((t) => t.hidden), [false, true, false]);
});

test("parseDateRange handles the formats Wikipedia uses", () => {
  assert.deepEqual(parseDateRange("October 16–23, 2026"), { start: "2026-10-16", end: "2026-10-23" });
  assert.deepEqual(parseDateRange("September 29 – October 2, 2026"), { start: "2026-09-29", end: "2026-10-02" });
  assert.deepEqual(parseDateRange("December 28, 2025 – January 3, 2026"), { start: "2025-12-28", end: "2026-01-03" });
  assert.deepEqual(parseDateRange("December 28 – January 3, 2026"), { start: "2025-12-28", end: "2026-01-03" });
  assert.deepEqual(parseDateRange("through October 20, 2026"), { start: "2026-10-20", end: "2026-10-20" });
  assert.deepEqual(parseDateRange("July 2026"), { start: "2026-07-01", end: "2026-07-31" });
  assert.deepEqual(parseDateRange("Oct. 5–7, 2026"), { start: "2026-10-05", end: "2026-10-07" });
  assert.deepEqual(parseDateRange(""), { start: null, end: null });
});

test("parsePercent", () => {
  assert.equal(parsePercent("52.0%"), 52);
  assert.equal(parsePercent("<1%"), 0.5);
  assert.equal(parsePercent("–"), null);
  assert.equal(parsePercent("4% NR"), 4);
});

test("normalizeRating", () => {
  assert.deepEqual(normalizeRating("Lean D"), { rating: "Lean D", strength: "Lean", lean: "D", flip: false });
  assert.deepEqual(normalizeRating("Solid R"), { rating: "Safe R", strength: "Safe", lean: "R", flip: false });
  assert.deepEqual(normalizeRating("Lean D flip"), { rating: "Lean D", strength: "Lean", lean: "D", flip: true });
  assert.equal(normalizeRating("Toss-up").rating, "Tossup");
});

test("splitNameParty", () => {
  assert.deepEqual(splitNameParty("Jon Ossoff (D)"), { name: "Jon Ossoff", party: "D" });
  assert.deepEqual(splitNameParty("Peggy Flanagan (DFL)"), { name: "Peggy Flanagan", party: "D" });
  assert.deepEqual(splitNameParty("Dan Osborn (I)"), { name: "Dan Osborn", party: "I" });
});

const ARTICLE = `
{{Infobox election
| election_name = 2026 Example Senate election
| nominee1 = [[Alex Rounds]]
| party1 = Republican Party (United States)
| nominee2 = [[Bea Smith (politician)|Bea Smith]] (replacing [[Cal Smith]])
| party2 = Democratic Party (United States)
| before_election = [[Alex Rounds]]
| before_party = Republican Party (United States)
}}
== Republican primary ==
=== Polling ===
{| class="wikitable"
! Poll source !! Date(s) administered !! Alex Rounds (R) !! Dee Other (R)
|-
| Primary Poll || May 1–2, 2026 || 60% || 30%
|}
== General election ==
=== Predictions ===
{| class="wikitable"
!Source
!Ranking
!As of
|-
|''[[The Cook Political Report]]''
|{{USRaceRating|Tossup}}
|October 20, 2026
|-
|[[Sabato's Crystal Ball]]
|{{USRaceRating|Lean|R}}
|October 27, 2026
|}
=== Polling ===
'''Aggregate polls'''
{| class="wikitable"
!Source of poll<br/>aggregation
!Dates<br/>administered
!Dates<br/>updated
!Alex<br/>Rounds (R)
!Bea<br/>Smith (D)
!Other/<wbr/>Undecided
!Margin
|-
|[[270toWin]]
|October 1–20, 2026
|October 21, 2026
|{{party shading/Republican}}|'''48.0%'''
|46.0%
|6.0%
|Rounds +2.0%
|-
| colspan="3" |'''Average'''
|48.0%
|46.0%
|6.0%
|Rounds +2.0%
|}

{| class="wikitable"
|- valign=bottom
! Poll source
! Date(s)<br />administered
! Sample<br />size{{efn|name="Key"}}
! Margin<br />{{nowrap|of error}}
! Alex<br />Rounds (R)
! Bea<br />Smith (D)
! Other
! Undecided
|-
|rowspan=2 style="text-align:left;"|Acme Polling (R)<ref>{{cite web|title=x}}</ref>
|rowspan=2|October 15–17, 2026
|rowspan=2|755 (LV)
|rowspan=2|±&nbsp;3.8%
|{{party shading/Republican}}|'''49%'''
|47%
|{{sdash}}
|4%
|-
|'''50%'''{{efn|Leaners pushed}}
|48%
|{{sdash}}
|2%
|-
|style="text-align:left;"|Beta Research
|September 29 – October 2, 2026
|1,000 (RV)
|±&nbsp;3.1%
|44%
|{{party shading/Democratic}}|'''46%'''
| colspan="2" |10%
|}

{{hidden begin|title=Hypothetical polling}}
{| class="wikitable"
! Poll source !! Date(s) administered !! Alex Rounds (R) !! Cal Smith (D)
|-
| Old Poll || March 1–2, 2026 || 50% || 40%
|}
{{hidden end}}
=== Results ===
`;

test("parseRace reads nominees, ratings, aggregates and headline polls", () => {
  const race = parseRace(ARTICLE, { id: "XX-SEN" });
  assert.deepEqual(
    race.nominees.map((n) => [n.name, n.party, n.note]),
    [
      ["Alex Rounds", "R", undefined],
      ["Bea Smith", "D", "replacing Cal Smith"],
    ],
  );
  assert.deepEqual(race.incumbent, { name: "Alex Rounds", party: "R" });

  assert.deepEqual(
    race.ratings.map((r) => [r.source, r.rating]),
    [
      ["Cook Political Report", "Tossup"],
      ["Sabato's Crystal Ball", "Lean R"],
    ],
  );

  assert.equal(race.aggregates.length, 2);
  assert.deepEqual(race.aggregates[0].values, { "Alex Rounds": 48, "Bea Smith": 46 });
  assert.equal(race.aggregates[1].isAverage, true);

  // Primary and hypothetical polls are excluded; the leaners-pushed variant
  // is folded into its parent poll.
  assert.equal(race.polls.length, 2);
  const [acme, beta] = race.polls;
  assert.equal(acme.pollster, "Acme Polling (R)");
  assert.deepEqual(acme.values, { "Alex Rounds": 49, "Bea Smith": 47 });
  assert.equal(acme.sample, 755);
  assert.equal(acme.population, "LV");
  assert.equal(acme.moe, 3.8);
  assert.equal(acme.other, null);
  assert.equal(acme.undecided, 4);
  assert.equal(beta.end, "2026-10-02");
  // A single cell spanning Other and Undecided is counted once.
  assert.equal(beta.other, null);
  assert.equal(beta.undecided, 10);
});

test("simpleAverage uses the newest poll per pollster inside the window", () => {
  const candidates = [{ name: "A" }, { name: "B" }];
  const polls = [
    { pollster: "X (R)", end: "2026-10-30", values: { A: 50, B: 40 } },
    { pollster: "Y", end: "2026-10-20", values: { A: 44, B: 46 } },
    { pollster: "X (R)", end: "2026-10-10", values: { A: 60, B: 30 } },
    { pollster: "Z", end: "2026-08-01", values: { A: 10, B: 90 } },
  ];
  const avg = simpleAverage(polls, candidates, { asOf: "2026-11-01", windowDays: 30 });
  assert.equal(avg.pollCount, 2);
  assert.deepEqual(avg.values, { A: 47, B: 43 });
});

const EMPTY_RESULTS = `{{Election box begin | title=2026 X}}
{{Election box candidate with party link no change
 | party=Democratic Party (United States)
 | candidate=[[Jon Ossoff]] (incumbent)
 | votes=
 | percentage=
}}
{{Election box candidate with party link
 | party=Republican Party (United States)
 | candidate= [[Mike Collins (politician)|Mike Collins]]
 | votes=
}}
{{Election box total | votes= | percentage=100.0}}
{{Election box end}}`;

test("parseResults is null until votes are filled in", () => {
  assert.equal(parseResults(EMPTY_RESULTS), null);
});

test("parseResults reads votes, percentages and a single winner", () => {
  const text = `{{Election box begin |title=Results<ref>{{cite web|title=x}}</ref>}}
{{Election box winning candidate with party link
 |party=Republican Party (United States)
 |candidate=[[Bernie Moreno]]
 |votes=2,857,383
 |percentage=50.09%
}}{{Election box candidate with party link|party=Democratic Party (United States)|candidate=[[Sherrod Brown]] (incumbent)|votes=2,650,949|percentage=46.47%}}
{{Election box candidate with party link|party=Libertarian Party (United States)|candidate=Don Kissick|votes=195,648}}
{{Election box total|votes=5,704,620}}
{{Election box end}}`;
  const r = parseResults(text);
  assert.equal(r.winner, "Bernie Moreno");
  assert.equal(r.runoff, false);
  assert.equal(r.totalVotes, 5704620);
  assert.deepEqual(r.candidates.map((c) => [c.name, c.party, c.votes, c.percentage]), [
    ["Bernie Moreno", "R", 2857383, 50.09],
    ["Sherrod Brown", "D", 2650949, 46.47],
    ["Don Kissick", "L", 195648, 3.4], // computed from the total
  ]);
});

test("parseResults reports a runoff when two candidates are marked as advancing", () => {
  const text = `{{Election box begin |title=x}}
{{Election box winning candidate with party link|party=Democratic Party (United States)|candidate=A One|votes=100}}
{{Election box winning candidate with party link|party=Republican Party (United States)|candidate=B Two|votes=99}}
{{Election box end}}`;
  const r = parseResults(text);
  assert.equal(r.winner, null);
  assert.equal(r.runoff, true);
});

test("parseGenericBallot reads aggregates and polls keyed by party", () => {
  const house = `intro
<section begin="GenericBallotAgg"/>
{|class="wikitable"
!Source of poll<br>aggregation
!Dates<br>administered
!Dates<br>updated
!Republicans
!Democrats
!Other/<br>Undecided
!Margin
|-
|[[Decision Desk HQ]]
|January 9, 2025 – October 26, 2026
|October 30, 2026
|42.6%
|{{Party shading/Democratic}} |'''51.5%'''
|5.9%
|Democrats +8.9%
|-
|colspan=2 |'''Average'''
|October 30, 2026
|43.1%
|51.7%
|5.2%
|Democrats +8.6%
|}<section end="GenericBallotAgg" />`;
  const polls = `===2025–2026===
{| class="wikitable sortable mw-collapsible mw-open"
! Poll source
! Date(s)<br>administered
! Sample<br>size
! Margin<br>of error
! [[Democratic Party (United States)|Democratic]]<br>
! [[Republican Party (United States)|Republican]]<br>
! Other/<br>Undecided
! Lead
|-
| style="text-align:left;"|Ipsos
|October 20–28, 2026
|1,209 (LV)
|±&nbsp;3.5%
|{{party shading/Democratic}}|'''50%'''
|44%
|6%
|6%
|}
===2024–2025===
{| class="wikitable mw-collapsible mw-collapsed"
! Poll source !! Date(s) administered !! Democratic !! Republican
|-
| Old || May 1–2, 2025 || 40% || 45%
|}`;
  const g = parseGenericBallot(house, polls);
  assert.deepEqual(g.aggregates.map((a) => [a.source, a.values, a.isAverage]), [
    ["Decision Desk HQ", { Republicans: 42.6, Democrats: 51.5 }, false],
    ["Average", { Republicans: 43.1, Democrats: 51.7 }, true],
  ]);
  assert.equal(g.polls.length, 1);
  assert.deepEqual(g.polls[0].values, { Democrats: 50, Republicans: 44 });
  assert.equal(g.polls[0].end, "2026-10-28");
});

test("parseHouseRatings reads each district's lean, incumbent and forecaster ratings", () => {
  const text = `Intro.
== Latest published ratings ==
{| class="wikitable sortable"
! colspan="2" |Constituency
! colspan="2" |Incumbent
! colspan="2" |Ratings
|-
![[List of United States congressional districts|District]]
![[Cook Partisan Voting Index|CPVI]]
!Incumbent
!Last result<ref>x</ref>
![[Cook Political Report|Cook]]<br>{{small|Oct. 30,<br>2026}}
![[Sabato's Crystal Ball|Sabato]]<br>{{small|Oct. 27,<br>2026}}
|-
!{{ushr|PA|7|X}}
|{{shading PVI|R|1}}
| {{Party shading/Republican}} |{{sortname|Ryan|Mackenzie}}
| {{Party shading/Republican}} data-sort-value="50.5" |50.5% R
|{{USRaceRating|Tossup}}
|{{USRaceRating|Lean|D|Flip}}
|-
!{{ushr|AK|AL|X}}
|{{shading PVI|EVEN}}
| {{Party shading/Republican}} |{{sortname|Nick|Begich}} (retiring)
| {{Party shading/Republican}} |51.6% R
|{{USRaceRating|Likely|R}}
|{{USRaceRating|Safe|R}}
|- class="sortbottom"
! colspan="4" |Overall
| {{Party shading/Democratic}} |D – 222<br>R – 195<br>18 tossups
| {{Party shading/Democratic}} |D – 225<br>R – 193<br>17 tossups
|}
== Other ==
`;
  const rows = parseHouseRatings(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "PA-7");
  assert.equal(rows[0].pvi, "R+1");
  assert.deepEqual(rows[0].incumbent, { name: "Ryan Mackenzie", party: "R" });
  assert.equal(rows[0].lastResult, "50.5% R");
  assert.deepEqual(rows[0].ratings.map((r) => [r.source, r.rating, r.flip]), [["Cook", "Tossup", false], ["Sabato", "Lean D", true]]);
  assert.equal(rows[1].id, "AK-AL");
  assert.equal(rows[1].district, "AL");
  assert.equal(rows[1].pvi, "EVEN");
  assert.deepEqual(rows[1].incumbent, { name: "Nick Begich (retiring)", party: "R" });
});

test("districtSection finds a numbered district, or the whole article for at-large seats", () => {
  const text = "Lead.\n== District 1 ==\none\n=== Polling ===\np\n== District 10 ==\nten\n";
  assert.match(districtSection(text, "1"), /one[\s\S]*Polling/);
  assert.doesNotMatch(districtSection(text, "1"), /ten/);
  assert.match(districtSection(text, "10"), /ten/);
  assert.equal(districtSection(text, "3"), null);
  assert.equal(districtSection(text, "AL"), text);
});

test("parseHouseTotals reads each forecaster's whole-House totals from the Overall row", () => {
  const text = `== Latest published ratings ==
{| class="wikitable"
![[List of United States congressional districts|District]]
!CPVI
!Incumbent
!Last result
![[Cook Political Report|Cook]]<br>{{small|Oct. 30,<br>2026}}
![[Sabato's Crystal Ball|Sabato]]<br>{{small|Oct. 27,<br>2026}}
|-
!{{ushr|PA|7|X}}
|{{shading PVI|R|1}}
| Ryan Mackenzie
| 50.5% R
|{{USRaceRating|Tossup}}
|{{USRaceRating|Lean|D|Flip}}
|- class="sortbottom"
! colspan="4" |Overall
| {{Party shading/Democratic}} |D – 222<br>R – 195<br>18 tossups
| {{Party shading/Republican}} |D – 210<br>R – 225
|}
`;
  assert.deepEqual(parseHouseTotals(text), [
    { source: "Cook", D: 222, R: 195, tossup: 18 },
    { source: "Sabato", D: 210, R: 225, tossup: 0 },
  ]);
  assert.equal(parseHouseRatings(text).length, 1);
});
