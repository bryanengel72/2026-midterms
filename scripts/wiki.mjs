// Fetches raw wikitext from English Wikipedia, politely.
//
// Uses index.php?action=raw, which is served from cache and is far less
// likely to be rate limited than the parse API. Follows #REDIRECT pages,
// retries 429/5xx with exponential backoff, and can cache to disk.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const USER_AGENT =
  "2026-midterms-poll-checker/1.0 (https://github.com/bryanengel72/2026-midterms)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pageUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

function rawUrl(title) {
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  return `https://en.wikipedia.org/w/index.php?title=${t}&action=raw`;
}

function cacheFile(dir, title) {
  return join(dir, title.replace(/[^A-Za-z0-9._-]+/g, "_") + ".wiki");
}

async function fetchOnce(title, { retries = 5 } = {}) {
  let delay = 2000;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(rawUrl(title), {
      headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
    });
    if (res.ok) return await res.text();
    if (res.status === 404) return null;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new Error(`HTTP ${res.status} fetching "${title}"`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
    delay *= 2;
  }
}

/**
 * Returns { title, text, fromCache } for the article, following up to 3 redirects,
 * or null when the article does not exist.
 */
export async function fetchWikitext(title, { cacheDir, useCache = false, offline = false } = {}) {
  let current = title;
  let fromCache = true;
  for (let hop = 0; hop < 4; hop++) {
    let text = null;
    const file = cacheDir ? cacheFile(cacheDir, current) : null;
    if ((useCache || offline) && file) {
      text = await readFile(file, "utf8").catch(() => null);
    }
    if (text === null) {
      if (offline) return null;
      fromCache = false;
      text = await fetchOnce(current);
      if (text === null) return null;
      if (file) {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(file, text);
      }
    }
    const redirect = text.match(/^\s*#REDIRECT\s*\[\[([^\]|#]+)/i);
    if (!redirect) return { title: current, text, fromCache };
    current = redirect[1].trim();
  }
  throw new Error(`Too many redirects for "${title}"`);
}
