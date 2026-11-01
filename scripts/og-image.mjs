// Renders assets/og.png, the 1200x630 preview shown when the site is shared
// on social media or in messages. Needs Playwright (not a project
// dependency): run with `node scripts/og-image.mjs` where it is installed.
// The image is decorative: the chamber is symmetric on purpose, so it never
// reads as a forecast.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// require() so a global Playwright install (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)("playwright");

const out = fileURLToPath(new URL("../assets/og.png", import.meta.url));

// Rating scale, Safe D to Safe R, as in the site's palette.
const bands = [
  ["#184f95", 14], ["#2a78d6", 14], ["#86b6ef", 14], ["#e4e2dc", 16],
  ["#f09591", 14], ["#e34948", 14], ["#a3282a", 14],
];
const colors = bands.flatMap(([c, n]) => Array(n).fill(c));

// 100 seats in 5 semicircular rows, filled left to right by angle.
function chamber() {
  const cx = 250, cy = 250, rows = 5, r0 = 120, r1 = 240;
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
  const total = radii.reduce((a, r) => a + r, 0);
  const counts = radii.map((r) => Math.round((100 * r) / total));
  counts[rows - 1] += 100 - counts.reduce((a, b) => a + b, 0);
  const seats = [];
  radii.forEach((r, i) => {
    for (let k = 0; k < counts[i]; k++) {
      const a = Math.PI - (Math.PI * k) / (counts[i] - 1);
      seats.push({ a, x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) });
    }
  });
  seats.sort((p, q) => q.a - p.a);
  return seats
    .map((s, i) => `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="11.5" fill="${colors[i]}"/>`)
    .join("");
}

const html = `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #fcfcfb; color: #0b0b0b;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; position: relative; overflow: hidden; }
  .bar { position: absolute; left: 0; right: 0; top: 0; height: 14px;
    background: linear-gradient(90deg, #2a78d6 0 50%, #e34948 50% 100%); }
  .text { position: absolute; left: 72px; top: 92px; width: 560px; }
  .kicker { font-size: 26px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #52514e; }
  h1 { font-size: 78px; line-height: 1.02; font-weight: 800; letter-spacing: -0.02em; margin: 18px 0 26px; }
  p { font-size: 29px; line-height: 1.35; color: #3a3936; }
  .url { position: absolute; left: 72px; bottom: 56px; font-size: 26px; font-weight: 600; color: #2a78d6; }
  svg { position: absolute; right: 56px; top: 150px; }
  .caption { position: absolute; right: 56px; width: 500px; top: 420px; text-align: center;
    font-size: 22px; color: #52514e; }
</style></head><body>
  <div class="bar"></div>
  <div class="text">
    <div class="kicker">Election Day · Nov. 3, 2026</div>
    <h1>2026 Midterm Poll Checker</h1>
    <p>Polls, averages and forecaster ratings for every Senate, governor and competitive House race, state by state.</p>
  </div>
  <svg width="500" height="262" viewBox="-14 -14 528 277">${chamber()}</svg>
  <div class="caption">Polls and ratings from Wikipedia</div>
  <div class="url">2026-midterms.vercel.app</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log(`Wrote ${out}`);
