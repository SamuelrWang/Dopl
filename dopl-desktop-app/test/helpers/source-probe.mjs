// Source-extraction probes for the renderer suites (no tests of its own).
//
// The renderer has no build step, so ~45 assertions across the session-* suites read
// session.css / session.html / session.js as TEXT. Three failure modes came out of the
// six-agent audit, and this module is the fix for all three:
//
//   (a) SLICE INVERSION FAILED OPEN. `SRC.slice(SRC.indexOf(A), SRC.indexOf(B))` takes the
//       FIRST occurrence of each marker ANYWHERE, including inside a comment. If B ever
//       moves above A the slice is "" and every `assert.ok(!/x/.test(slice))` inside it
//       passes VACUOUSLY — silently disarming the guard. `between()` throws instead, and
//       `ruleOf` / `fnOf` match an EXACT selector or function and return its real block, so
//       there is no marker ordering to invert in the first place.
//   (b) EXACT FORMATTING was pinned as if it were behavior. `declsOf()` returns a rule as
//       {prop: value}, so re-ordering two independent declarations or running a formatter
//       is not a test failure, while the VALUES stay pinned.
//   (c) GLOBAL NEGATIVE GREPS matched comments as readily as code. `selectorsOf()` and
//       `declaredProps()` answer "does the stylesheet actually declare this?" over parsed
//       rules rather than over the file's raw text.
//
// String/offset work: no DOM, no CSS engine. JavaScript is tokenized with espree (eslint's
// parser, already installed) so regex literals are lexed correctly.

import { createRequire } from "node:module";

const espree = createRequire(import.meta.url)("espree");

// ── generic guarded slice ────────────────────────────────────────────────────
// The audit's fail-open pattern, closed: both markers must exist AND be in order.
export function between(src, from, to, label) {
  const what = label ? label + ": " : "";
  const i = src.indexOf(from);
  const j = src.indexOf(to);
  if (i === -1) throw new Error(`${what}start marker not found: ${JSON.stringify(from)}`);
  if (j === -1) throw new Error(`${what}end marker not found: ${JSON.stringify(to)}`);
  if (j <= i) throw new Error(`${what}markers out of order: ${JSON.stringify(from)}@${i} >= ${JSON.stringify(to)}@${j}`);
  return src.slice(i, j);
}

// "a is declared before b" as a checked question, not a bare indexOf comparison
// (two -1s compare equal, which is how an absent marker used to read as "in order").
export function orderOf(src, a, b, label) {
  const what = label ? label + ": " : "";
  const i = src.indexOf(a);
  const j = src.indexOf(b);
  if (i === -1) throw new Error(`${what}not found: ${JSON.stringify(a)}`);
  if (j === -1) throw new Error(`${what}not found: ${JSON.stringify(b)}`);
  return i < j;
}

const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const blank = (s) => s.replace(/[^\n]/g, " ");

// Comments blanked to spaces: offsets (and line numbers) are preserved, so a marker
// inside a comment can never be mistaken for the real thing.
const maskCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, blank);

function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

// The selector text of the block opening at `open`: everything back to the previous
// block/declaration boundary.
function headStart(src, open, floor) {
  for (let i = open - 1; i >= floor; i--) {
    const c = src[i];
    if (c === "}" || c === "{" || c === ";") return i + 1;
  }
  return floor;
}

const NESTS = /^@(media|supports|container|layer|scope|document)\b/;

// Visit every real (non at-) rule, descending into the at-rules that contain rules.
function eachRule(css, visit) {
  const masked = maskCss(css);
  (function walk(start, end, at) {
    let i = start;
    while (i < end) {
      const open = masked.indexOf("{", i);
      if (open === -1 || open >= end) return;
      const close = matchBrace(masked, open);
      if (close === -1) return;
      const head = norm(masked.slice(headStart(masked, open, i), open));
      if (head.startsWith("@")) {
        if (NESTS.test(head)) walk(open + 1, close, head);
      } else if (head) {
        visit({ selector: head, at, open, close, body: css.slice(open + 1, close), decls: masked.slice(open + 1, close) });
      }
      i = close + 1;
    }
  })(0, masked.length, "");
}

// Every rule whose selector list matches `selector` EXACTLY (whitespace-normalized).
export function rulesOf(css, selector) {
  const want = norm(selector);
  const hits = [];
  eachRule(css, (rule) => { if (rule.selector === want) hits.push(rule); });
  return hits;
}

// One rule. `opts.at` picks the copy inside a matching at-rule (e.g. "reduced-motion");
// with no `at` the top-level copy wins over one nested in a media query.
export function ruleOf(css, selector, opts) {
  const at = opts && opts.at;
  const all = rulesOf(css, selector);
  if (at != null) return all.find((r) => r.at.includes(at)) || null;
  return all.find((r) => r.at === "") || all[0] || null;
}

export function hasRule(css, selector, opts) {
  return ruleOf(css, selector, opts) !== null;
}

function parseDecls(body) {
  const out = {};
  const push = (chunk) => {
    const t = chunk.trim();
    if (!t || t.includes("{")) return; // a nested block is not a declaration
    const c = t.indexOf(":");
    if (c <= 0) return;
    out[norm(t.slice(0, c))] = norm(t.slice(c + 1));
  };
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (ch === ";" && depth === 0) { push(buf); buf = ""; continue; }
    buf += ch;
  }
  push(buf);
  return out;
}

// A rule as {prop: value}. Declaration ORDER and formatting stop being load-bearing;
// the values stay pinned. Throws when the rule is missing (never a silent empty object).
export function declsOf(css, selector, opts) {
  const rule = ruleOf(css, selector, opts);
  if (!rule) throw new Error(`css rule not found: ${JSON.stringify(norm(selector))}`);
  return parseDecls(rule.decls);
}

// Every selector the stylesheet actually declares (comments excluded) — the honest
// version of a `!/^\.badge/m.test(CSS)` grep.
export function selectorsOf(css) {
  const out = [];
  eachRule(css, (rule) => out.push(rule.selector));
  return out;
}

// True when ANY declared selector matches the predicate / pattern.
export function anySelector(css, pattern) {
  const test = typeof pattern === "function" ? pattern : (s) => pattern.test(s);
  return selectorsOf(css).some(test);
}

// Every property name declared anywhere in the stylesheet.
export function declaredProps(css) {
  const props = new Set();
  eachRule(css, (rule) => { for (const p of Object.keys(parseDecls(rule.decls))) props.add(p); });
  return props;
}

// ── javascript ───────────────────────────────────────────────────────────────
// Built from espree's tokens, so string, template and REGEX literals are all known and a
// quote inside `/"/g` cannot desynchronise the scan (T1-10). Offsets are preserved.
const TOKENIZE = { ecmaVersion: "latest", comment: true, range: true };

function tokensOf(src) {
  for (const sourceType of ["script", "module"]) {
    try { return espree.tokenize(src, { ...TOKENIZE, sourceType }); } catch { /* next */ }
  }
  return null;
}

function maskRanges(src, ranges) {
  let out = "";
  let last = 0;
  for (const [a, b, keep] of ranges) {
    out += src.slice(last, a + keep) + blank(src.slice(a + keep, b));
    last = b;
  }
  return out + src.slice(last);
}

// Comments and literals blanked, so brace matching cannot be thrown off by a `{` inside a
// literal and a marker inside a comment is never mistaken for code. Throws on unparseable input.
function maskJs(src) {
  const tokens = tokensOf(src);
  if (!tokens) throw new Error("source-probe: not parseable as JavaScript");
  const ranges = tokens.comments.map((c) => [c.range[0], c.range[1], 0]);
  for (const t of tokens) {
    if (t.type === "String") ranges.push([t.range[0], t.range[1], 1]);
    else if (t.type === "Template" || t.type === "RegularExpression") ranges.push([t.range[0], t.range[1], 0]);
  }
  return maskRanges(src, ranges.sort((x, y) => x[0] - y[0]));
}

// The source with every comment blanked (offsets and line numbers preserved); strings and
// code untouched. For assertions about what the code DOES, which a comment must never satisfy.
export function codeOf(src) {
  const tokens = tokensOf(src);
  if (!tokens) throw new Error("source-probe: not parseable as JavaScript");
  return maskRanges(src, tokens.comments.map((c) => [c.range[0], c.range[1], 0]));
}

// The code between `// ─── BEGIN <name>` and `// ─── END <name>` (the BEGIN line included).
// Fails CLOSED: a missing, repeated or inverted sentinel throws.
export function sentinelBlock(src, name) {
  const begin = `// ─── BEGIN ${name}`;
  const end = `// ─── END ${name}`;
  const i = src.indexOf(begin);
  const j = src.indexOf(end);
  if (i === -1) throw new Error(`BEGIN ${name} sentinel missing`);
  if (j === -1) throw new Error(`END ${name} sentinel missing`);
  if (j <= i) throw new Error(`${name} sentinels out of order`);
  if (src.indexOf(begin, i + 1) !== -1) throw new Error(`BEGIN ${name} sentinel repeated`);
  return src.slice(i, j);
}

function matchPair(src, open, o, c) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return i;
  }
  return -1;
}

// The EXACT source of `function <name>(...) { ... }`, brace-matched to its real end.
// Replaces `src.slice(src.indexOf("function a("), src.indexOf("function b("))`, where
// moving b above a silently emptied the block and disarmed every guard inside it.
export function fnOf(src, name) {
  const masked = maskJs(src);
  const re = new RegExp(`(?:^|[^\\w$.])function\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`, "m");
  const m = re.exec(masked);
  if (!m) throw new Error(`function not found: ${name}`);
  const at = m.index + m[0].indexOf("function");
  const paren = masked.indexOf("(", at);
  const params = matchPair(masked, paren, "(", ")");
  const open = params === -1 ? -1 : masked.indexOf("{", params);
  const close = open === -1 ? -1 : matchBrace(masked, open);
  if (close === -1) throw new Error(`unbalanced body for function ${name}`);
  return src.slice(at, close + 1);
}
