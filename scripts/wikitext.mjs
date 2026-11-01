// A small wikitext toolkit: just enough to read election polling tables.
//
// It is not a general MediaWiki parser. It understands sections, tables
// (with rowspan/colspan), templates, links and the inline markup that shows
// up in poll tables, and it turns cell markup into plain text.

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

/** Removes HTML comments and <ref> footnotes, which only add noise. */
export function stripNoise(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, "");
}

/**
 * Finds the index of the "}}" that closes the template opening at `start`
 * (which must point at "{{"). Returns -1 when unbalanced.
 */
function closeTemplate(text, start) {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth++;
      i++;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) return i - 1;
    }
  }
  return -1;
}

/**
 * Splits `text` on `sep` at nesting depth zero, ignoring separators that sit
 * inside {{templates}} or [[links]].
 */
export function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      i++;
    } else if ((two === "}}" || two === "]]") && depth > 0) {
      depth--;
      i++;
    } else if (depth === 0 && text.startsWith(sep, i)) {
      parts.push(text.slice(last, i));
      i += sep.length - 1;
      last = i + 1;
    }
  }
  parts.push(text.slice(last));
  return parts;
}

/** Index of the first depth-zero single "|" (not "||"), or -1. */
function findAttrPipe(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      i++;
    } else if ((two === "}}" || two === "]]") && depth > 0) {
      depth--;
      i++;
    } else if (depth === 0 && text[i] === "|") {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Templates and inline markup
// ---------------------------------------------------------------------------

const DROP_TEMPLATES = new Set([
  "efn", "efn-ua", "efn-lr", "efn-la", "refn", "notetag", "ref", "sfn", "r",
  "cn", "citation needed", "dead link", "update inline", "as of", "clarify",
  "party shading", "party color", "party colour", "flagicon", "flag icon",
  "increase", "decrease", "steady", "nbsp", "!", "hidden begin", "hidden end",
  "collapse top", "collapse bottom", "sort", "anchor",
]);

const DASH_TEMPLATES = new Set([
  "sdash", "ndash", "mdash", "snd", "spnd", "spaced ndash", "spaced en dash",
  "dash", "en dash", "em dash", "–", "—",
]);

function templateName(inner) {
  return inner.split("|")[0].trim().toLowerCase().replace(/_/g, " ");
}

function positionalArgs(inner) {
  return splitTopLevel(inner, "|")
    .slice(1)
    .filter((a) => !/^\s*[\w -]+\s*=/.test(a))
    .map((a) => a.trim());
}

function renderTemplate(inner) {
  const name = templateName(inner);
  const base = name.split("/")[0];
  if (DROP_TEMPLATES.has(name) || DROP_TEMPLATES.has(base)) {
    return name === "nbsp" ? " " : "";
  }
  if (DASH_TEMPLATES.has(name)) return "–";
  if (name === "plus-minus" || name === "pm" || name === "+-") return "±";
  const args = positionalArgs(inner);
  if (name === "usraceratings" || name === "usracerating") return args.join(" ");
  if (name === "sortname") return args.slice(0, 2).join(" ");
  if (name === "sort" && args.length > 1) return args[1];
  if (name === "abbr" || name === "abbrlink") return args[0] ?? "";
  if (name === "date" || name === "dts") return args.join(" ");
  // Wrapper templates such as {{nowrap|…}}, {{small|…}}, {{nobold|…}}.
  return args[0] ?? "";
}

/** Replaces every template with its rendered text, innermost first. */
export function expandTemplates(text) {
  let out = text;
  for (let guard = 0; guard < 50 && out.includes("{{"); guard++) {
    let changed = false;
    // Find innermost templates: "{{" not followed by another "{{" before "}}".
    out = out.replace(/\{\{((?:(?!\{\{|\}\})[\s\S])*)\}\}/g, (_, inner) => {
      changed = true;
      return renderTemplate(inner);
    });
    if (!changed) break;
  }
  return out;
}

/** Removes every template whose name matches `test`, including its body. */
export function removeTemplates(text, test) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{{", i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    const close = closeTemplate(text, open);
    if (close === -1) {
      out += text.slice(open);
      break;
    }
    const inner = text.slice(open + 2, close);
    out += test(templateName(inner)) ? "" : text.slice(open, close + 2);
    i = close + 2;
  }
  return out;
}

const ENTITIES = {
  nbsp: " ", ndash: "–", mdash: "–", amp: "&", lt: "<", gt: ">", quot: '"',
  apos: "'", plusmn: "±", minus: "−", thinsp: " ", ensp: " ", emsp: " ",
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Turns a fragment of wikitext into plain, single-line text. */
export function toPlainText(text) {
  let t = stripNoise(text);
  t = removeTemplates(t, (n) => /^(efn|refn|notetag|ref|sfn|r)\b/.test(n));
  t = expandTemplates(t);
  t = t
    .replace(/\[\[(?:file|image):[^\]]*\]\]/gi, "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]*)\]/g, "$1")
    .replace(/\[https?:\/\/[^\]]*\]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<wbr\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/'''|''/g, "");
  return decodeEntities(t).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Lists headings as { level, title, start, bodyStart, end }. */
export function listSections(text) {
  const re = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text))) {
    heads.push({
      level: m[1].length,
      title: toPlainText(m[2]),
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  for (let i = 0; i < heads.length; i++) {
    let end = text.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= heads[i].level) {
        end = heads[j].start;
        break;
      }
    }
    heads[i].end = end;
  }
  return heads;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Finds top-level {| … |} tables. Each result has { start, end, text,
 * hidden }, where `hidden` means the table sits inside a {{hidden begin}}
 * block (Wikipedia's convention for hypothetical match-ups) or is collapsed.
 */
export function findTables(text) {
  const tables = [];
  const lines = text.split("\n");
  let offset = 0;
  let depth = 0;
  let hiddenDepth = 0;
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (depth === 0) {
      hiddenDepth += (trimmed.match(/\{\{\s*(hidden begin|collapse top|cot)\b/gi) || []).length;
      hiddenDepth -= (trimmed.match(/\{\{\s*(hidden end|collapse bottom|cob)\b/gi) || []).length;
      if (hiddenDepth < 0) hiddenDepth = 0;
    }
    if (trimmed.startsWith("{|")) {
      if (depth === 0) {
        current = {
          start: offset,
          hidden: hiddenDepth > 0 || /collapsed/i.test(trimmed),
        };
      }
      depth++;
    } else if (trimmed.startsWith("|}") && depth > 0) {
      depth--;
      if (depth === 0 && current) {
        current.end = offset + line.length;
        current.text = text.slice(current.start, current.end);
        tables.push(current);
        current = null;
      }
    }
    offset += line.length + 1;
  }
  return tables;
}

function parseSpan(attrs, name) {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']?\\s*(\\d+)`, "i"));
  return m ? Math.max(1, Number(m[1])) : 1;
}

function makeCell(raw, header) {
  const pipe = findAttrPipe(raw);
  let attrs = "";
  let content = raw;
  if (pipe !== -1) {
    attrs = raw.slice(0, pipe);
    content = raw.slice(pipe + 1);
  }
  return {
    header,
    raw: content,
    text: toPlainText(content),
    attrs,
    rowspan: parseSpan(attrs, "rowspan"),
    colspan: parseSpan(attrs, "colspan"),
  };
}

/**
 * Parses a table into a rectangular grid. Every grid cell is
 * { cell, carried } where `carried` marks a copy produced by a rowspan from
 * an earlier row (colspan copies are not marked carried).
 */
export function parseTable(tableText) {
  const body = stripNoise(tableText);
  const rows = [];
  let row = null;
  let lastCell = null;
  let depth = 0;
  const lines = body.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const t = line.trim();
    if (li === 0) {
      depth = 1;
      continue;
    }
    if (depth > 1) {
      // Nested table: keep it as part of the current cell's text.
      if (t.startsWith("{|")) depth++;
      if (t.startsWith("|}")) depth--;
      if (lastCell) lastCell.raw += "\n" + line;
      continue;
    }
    if (t.startsWith("{|")) {
      depth++;
      if (lastCell) lastCell.raw += "\n" + line;
      continue;
    }
    if (t.startsWith("|}")) break;
    if (t.startsWith("|+")) continue;
    if (t.startsWith("|-")) {
      row = [];
      rows.push(row);
      lastCell = null;
      continue;
    }
    const isHeader = t.startsWith("!");
    const isData = t.startsWith("|");
    if (isHeader || isData) {
      if (!row) {
        row = [];
        rows.push(row);
      }
      const content = t.slice(1);
      let pieces = splitTopLevel(content, "||");
      if (isHeader) pieces = pieces.flatMap((p) => splitTopLevel(p, "!!"));
      for (const piece of pieces) {
        lastCell = makeCell(piece, isHeader);
        row.push(lastCell);
      }
      continue;
    }
    if (lastCell) {
      lastCell.raw += "\n" + line;
      lastCell.text = toPlainText(lastCell.raw);
    }
  }
  // Re-render cells whose text grew over several lines.
  for (const r of rows) {
    for (const c of r) c.text = toPlainText(c.raw);
  }
  return expandGrid(rows.filter((r) => r.length > 0));
}

function expandGrid(rows) {
  const grid = [];
  const pending = []; // per column: { cell, left }
  for (const row of rows) {
    const out = [];
    let col = 0;
    const fillPending = () => {
      while (pending[col] && pending[col].left > 0) {
        out[col] = { cell: pending[col].cell, carried: true };
        pending[col].left--;
        col++;
      }
    };
    for (const cell of row) {
      fillPending();
      for (let k = 0; k < cell.colspan; k++) {
        out[col] = { cell, carried: false };
        if (cell.rowspan > 1) pending[col] = { cell, left: cell.rowspan - 1 };
        else pending[col] = undefined;
        col++;
      }
    }
    // Rowspans that extend past the last explicit cell of this row.
    for (let c = col; c < pending.length; c++) {
      if (pending[c] && pending[c].left > 0) {
        out[c] = { cell: pending[c].cell, carried: true };
        pending[c].left--;
      }
    }
    grid.push(out);
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Infobox
// ---------------------------------------------------------------------------

/** Reads |key = value pairs from the first {{Infobox …}} template. */
export function parseInfobox(text) {
  const open = text.search(/\{\{\s*Infobox/i);
  if (open === -1) return {};
  const close = closeTemplate(text, open);
  if (close === -1) return {};
  const inner = stripNoise(text.slice(open + 2, close));
  const fields = {};
  for (const part of splitTopLevel(inner, "|").slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    fields[key] = part.slice(eq + 1).trim();
  }
  return fields;
}

/**
 * Lists the top-level templates in `text` as { name, params }, where params
 * maps named arguments (trimmed raw wikitext) and positional ones by index.
 */
export function listTemplates(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{{", i);
    if (open === -1) break;
    const close = closeTemplate(text, open);
    if (close === -1) break;
    const inner = text.slice(open + 2, close);
    const parts = splitTopLevel(inner, "|");
    const params = {};
    let pos = 1;
    for (const part of parts.slice(1)) {
      const eq = part.indexOf("=");
      if (eq !== -1 && /^\s*[\w -]+\s*$/.test(part.slice(0, eq))) {
        params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
      } else {
        params[pos++] = part.trim();
      }
    }
    out.push({ name: parts[0].trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " "), params });
    i = close + 2;
  }
  return out;
}
