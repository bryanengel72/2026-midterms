# 2026 Midterm Poll Checker

A state-by-state poll checker for the November 3, 2026 midterms. For every U.S. Senate and governor race on the ballot it shows:

- **The current polling picture**: the average across poll aggregators (270toWin, Decision Desk HQ, FiftyPlusOne, RealClearPolitics, Silver Bulletin and others) where Wikipedia lists them, otherwise a simple average of the last 30 days of polls.
- **Every general election poll**: pollster, field dates, sample size and population, margin of error, each candidate's share, and the lead.
- **A poll trend chart** with a 30-day rolling average.
- **Forecaster ratings** (Cook, Sabato, Inside Elections and more) with the consensus rating.
- **Betting odds from Polymarket**: each candidate's implied chance of winning, loaded live in your browser when you open a state and refreshed every minute while it stays open.
- **A tile map** of all 50 states, colored by polling lead, forecaster rating or betting odds, and a sortable table of every race.

Coverage: all 35 Senate races (33 regular plus the Florida and Ohio specials) and all 36 governor races. States with no statewide race (Indiana, Missouri, North Dakota, Utah, Washington) link to their House races.

## Where the data comes from

Each race's English Wikipedia article (for example [2026 United States Senate election in Georgia](https://en.wikipedia.org/wiki/2026_United_States_Senate_election_in_Georgia)). Wikipedia editors keep the "General election > Polling" and "Predictions" tables current, and the content is reusable under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), which the site credits in its footer.

`scripts/build-data.mjs` downloads each article's wikitext, parses the tables and writes `data/polls.json`. It:

- reads the nominees from the article's infobox and keeps only polls of that match-up (hypothetical match-ups, primary polls and ranked-choice round tables are skipped);
- folds poll variants (leaners pushed, head-to-head versions) into the pollster's headline result;
- keeps a race's previous data, marked stale, if its article cannot be fetched;
- refuses to overwrite the data if far fewer races parse than last time, so a Wikipedia outage or layout change cannot blank the site;
- leaves the file untouched when nothing changed.

## Betting odds

Odds come from [Polymarket](https://polymarket.com)'s public API (no key needed). Every race has a "<State> <Office> Election Winner" market; their slugs are listed in `scripts/races.mjs`.

**No Polymarket data is stored in this repository.** `data/polls.json` holds only each race's market slug and link. The visitor's browser loads the odds directly from Polymarket:

- opening a state loads that state's races (one request), refreshed every minute while it stays open;
- coloring the map by betting odds, or sorting the table by them, loads all 71 races (five requests), refreshed at most every five minutes while that view is on. Until then the table has no odds column.

The data build checks that each slug still resolves and searches by title for any that moved, but keeps only the slug.

Polymarket's [terms of use](https://polymarket.com/tos) grant a personal-use license and do not clearly permit showing its odds on another public site. If you plan to publish the site widely, consider asking Polymarket for written permission.

Odds are not polls. They show what bettors will pay for each outcome, they can disagree with the polls, and markets with little money traded (flagged on the page under $50,000) can swing on a few bets.

## Running it

Requires Node 20 or newer. There are no dependencies to install.

```sh
npm run update     # fetch all 71 articles from Wikipedia and rebuild data/polls.json
npm start          # serve the site at http://localhost:8080
npm test           # parser tests
```

`npm run update:cached` reuses articles already downloaded to `.cache/` (handy while working on the parser); `npm run build:offline` also skips the Polymarket slug check. Behind a corporate or sandbox proxy, run Node with `NODE_USE_ENV_PROXY=1` so `fetch` honors `HTTPS_PROXY`.

## Automatic updates and hosting

`.github/workflows/update-polls.yml` runs every three hours on `main` (and on demand from the Actions tab). It tests the parser, refreshes the polls, commits `data/polls.json` if anything changed, and publishes the site with GitHub Pages.

To turn on publishing, once: **Settings > Pages > Build and deployment > Source: GitHub Actions**. The site is plain HTML, CSS and JavaScript, so any static host works too.

## Project layout

```
index.html               page shell
assets/app.js            map, state view, chart and tables
assets/markets.js        Polymarket odds (shared by the browser and the build)
assets/styles.css        styles, light and dark themes
data/polls.json          generated data (committed)
scripts/races.mjs        which races are on the ballot in each state
scripts/wiki.mjs         polite Wikipedia fetcher with retries and caching
scripts/wikitext.mjs     wikitext table and template parsing
scripts/parse-race.mjs   turns one race article into polls, averages and ratings
scripts/build-data.mjs   builds data/polls.json
scripts/serve.mjs        local preview server
test/parser.test.mjs     parser tests
test/markets.test.mjs    odds matching tests
```

## Reading the numbers

Polls are snapshots of opinion when they were taken, not predictions. A lead inside the margin of error is effectively a tie, and partisan polls (marked (D) or (R) after the pollster) tend to favor their side. Always check a number against the Wikipedia article, which cites each original poll.
