# 2026 Midterm Poll Checker

A state-by-state poll checker for the November 3, 2026 midterms. For every U.S. Senate and governor race on the ballot it shows:

- **The current polling picture**: the average across poll aggregators (270toWin, Decision Desk HQ, FiftyPlusOne, RealClearPolitics, Silver Bulletin and others) where Wikipedia lists them, otherwise a simple average of the last 30 days of polls.
- **Every general election poll**: pollster, field dates, sample size and population, margin of error, each candidate's share, and the lead.
- **A poll trend chart** with a 30-day rolling average.
- **Forecaster ratings** (Cook, Sabato, Inside Elections and more) with the consensus rating.
- **A tile map** of all 50 states, colored by polling lead or by forecaster rating, and a sortable table of every race.

- **The House generic ballot**: the national Democrat-vs-Republican congressional average, its trend, the aggregators and every poll (from Wikipedia's 2026 House elections article and its generic ballot polling table).
- **A 435-seat House chart**: seats every forecaster rates safe, plus each competitive district by its polling leader (or forecasters' consensus, or the result once called), with the count toward 218 and each forecaster's own published seat totals.
- **Competitive House districts**: every district that at least one of ten forecasters (Cook, Inside Elections, Sabato, The Economist, Split Ticket, Decision Desk HQ, FiftyPlusOne, Fox News, Silver Bulletin, RealClearPolitics) doesn't rate safe, with its partisan lean, incumbent, consensus rating, candidates and district polls. A summary bar splits them by consensus rating, the table filters and sorts, and each state's page lists its own competitive districts. Ratings come from Wikipedia's "2026 United States House of Representatives election ratings" article; candidates and polls from each district's section of its state's House elections article.
- **A 100-seat Senate chart** showing where the chamber stands if each race goes to its polling leader (or forecasters' pick).
- **Poll closing times** for election night, with countdowns, and each state's closing time on its page.
- **A time machine**: a slider and Play button that rewind the map, Senate chart and table to any date since August 1, using 30-day poll averages.
- **Live updates**: an open page checks for new data every two minutes (and when you return to the tab) and updates in place, no reload needed.
- **Race calls**: a feed of races as Wikipedia editors mark winners, newest first, with party flips marked. Times are when the site first saw each call.
- **Alerts for your states**: a "🔔 Alert me" button on Your states sends a browser notification (and an on-page pop-up) when a race in a starred state is called, while the page is open in a tab. Where browsers don't support notifications (iPhone Safari outside a home-screen app), the on-page pop-up still works.
- **How far off were the polls?**: once races are called, a chart of each race's final polling average against the result (Democrat minus Republican margin), biggest misses first, with the average lean of the misses, the typical miss and how often the polling leader won.
- **Election-night results**: once Wikipedia editors fill in vote counts, a Results view appears (and becomes the default), with winners, votes, the Senate chart by called races, and how each result compared with the final polls.

Coverage: all 35 Senate races (33 regular plus the Florida and Ohio specials) and all 36 governor races. States with no statewide race (Indiana, Missouri, North Dakota, Utah, Washington) link to their House races.

## Where the data comes from

Each race's English Wikipedia article (for example [2026 United States Senate election in Georgia](https://en.wikipedia.org/wiki/2026_United_States_Senate_election_in_Georgia)). Wikipedia editors keep the "General election > Polling" and "Predictions" tables current, and the content is reusable under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), which the site credits in its footer.

`scripts/build-data.mjs` downloads each article's wikitext, parses the tables and writes `data/polls.json`. It:

- reads the nominees from the article's infobox and keeps only polls of that match-up (hypothetical match-ups, primary polls and ranked-choice round tables are skipped);
- folds poll variants (leaners pushed, head-to-head versions) into the pollster's headline result;
- keeps a race's previous data, marked stale, if its article cannot be fetched;
- refuses to overwrite the data if far fewer races parse than last time, so a Wikipedia outage or layout change cannot blank the site;
- leaves the file untouched when nothing changed.

## Running it

Requires Node 20 or newer. There are no dependencies to install.

```sh
npm run update     # fetch the race, ratings and state House articles from Wikipedia and rebuild data/polls.json
npm start          # serve the site at http://localhost:8080
npm test           # parser tests
```

`npm run update:cached` reuses articles already downloaded to `.cache/` (handy while working on the parser). Behind a corporate or sandbox proxy, run Node with `NODE_USE_ENV_PROXY=1` so `fetch` honors `HTTPS_PROXY`.

## Automatic updates and hosting

`.github/workflows/update-polls.yml` runs every three hours (hourly November 1 to 3, then every 20 minutes on election night, 6 PM to 7 AM Eastern) on `main` (and on demand from the Actions tab). It tests the parser, refreshes the data, and commits `data/polls.json` if anything changed.

The site is hosted on Vercel, linked to this repository, at https://2026-midterms.vercel.app. Every push to `main`, including the workflow's data commits, redeploys it. The site is plain HTML, CSS and JavaScript with no build step, so any static host works too.

## Project layout

```
index.html               page shell
assets/app.js            map, state view, chart and tables
assets/styles.css        styles, light and dark themes
data/polls.json          generated data (committed)
scripts/races.mjs        which races are on the ballot in each state
scripts/wiki.mjs         polite Wikipedia fetcher with retries and caching
scripts/wikitext.mjs     wikitext table and template parsing
scripts/parse-race.mjs   turns one race article into polls, averages and ratings
scripts/build-data.mjs   builds data/polls.json
scripts/serve.mjs        local preview server
scripts/og-image.mjs     renders assets/og.png, the social preview image (needs Playwright)
test/parser.test.mjs     parser tests
```

## Reading the numbers

Polls are snapshots of opinion when they were taken, not predictions. A lead inside the margin of error is effectively a tie, and partisan polls (marked (D) or (R) after the pollster) tend to favor their side. Always check a number against the Wikipedia article, which cites each original poll.
