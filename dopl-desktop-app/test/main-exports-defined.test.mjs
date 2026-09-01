// EVERY IDENTIFIER A `module.exports` BLOCK NAMES MUST BE BOUND IN ITS FILE.
//
// WHY THIS FILE EXISTS. Phase 2 of the channels rollback deleted
// `main/session-team.js` and its `require`, but left one line behind in
// session-engine.js's export object:
//
//     acceptsInboundFrom: sessionTeam.acceptsInboundFrom,
//
// `module.exports = { … }` is EVALUATED, so that is a load-time
// `ReferenceError: sessionTeam is not defined` — not a dead line, a main
// process that cannot require its own session engine. Nothing caught it:
// every session test in this suite reads the file as SOURCE and slices a pure
// block out of it (the extraction idiom), so no test ever `require`d the module,
// and `eslint` treats an undeclared identifier as `no-undef`… which this config
// does not enable for `main/` (globals live everywhere). The suite was green over
// a desktop app that could not start.
//
// WHAT IS CHECKED, and why the exports block specifically. A deleted `require`
// leaves its uses behind ALL OVER a file, but almost every one of those sits
// inside a function body that a broken build simply never calls — annoying, not
// fatal. The export object is the one region that runs at REQUIRE time on every
// path, so an unbound name there is always a hard crash. That makes it both the
// highest-value region to police and the cheapest: no parser, no module loading,
// no electron.
//
// Run: `node --test dopl-desktop-app/test/main-exports-defined.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");

// Node/CommonJS ambient names plus the standard globals a main module may reach
// for without declaring. Deliberately short: anything else must be declared in
// the file, which is the whole point.
const AMBIENT = new Set([
  "require", "module", "exports", "process", "console", "global", "globalThis",
  "Buffer", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask",
  "fetch", "structuredClone", "performance",
  "Object", "Array", "String", "Number", "Boolean", "Math", "JSON", "Date", "RegExp",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Symbol", "Error", "TypeError", "Proxy", "Reflect",
  "Intl", "BigInt", "Infinity", "NaN", "undefined",
]);

/** The `module.exports = { … };` object literal, or null when the file has none
 *  (or exports a non-literal — a function, a re-export — which this cannot read). */
function exportsBlock(src) {
  const from = src.indexOf("\nmodule.exports = {");
  if (from === -1) return null;
  const to = src.indexOf("\n};", from);
  return to > from ? src.slice(from, to) : null;
}

/**
 * Blank out comments AND string/template literals, so a NAME appearing in prose
 * or inside a quoted glob is never read as code. Newlines are preserved so the
 * result still lines up with the original.
 *
 * A SCANNER RATHER THAN A PAIR OF REGEXES, because two independent passes get
 * this wrong in both directions on this very tree:
 *   • `//`-comment prose writes glob paths (`src/features/*&#47;client/…`) whose
 *     `/*` opens a block comment a lazy matcher then closes hundreds of lines
 *     below — ui-sync.js lost its entire pure block that way.
 *   • string literals do the same (`'~/.claude/**'` in sdk-loader.js), and no
 *     comment-only pass can see them at all.
 * One left-to-right walk with a state has neither problem: whichever construct
 * OPENS first owns the text until it closes.
 *
 * Single/double quotes only open a literal when the closer is on the SAME line,
 * which is the JS rule and also what keeps a regex character class (`/['"]/`)
 * from being mistaken for the start of a string.
 */
function blankNonCode(src) {
  let out = "";
  let i = 0;
  const keep = (ch) => (ch === "\n" ? "\n" : " ");
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") { out += " "; i += 1; }
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i += 1) out += keep(src[i]);
      continue;
    }
    const q = src[i];
    if (q === "'" || q === '"' || q === "`") {
      const line = src.indexOf("\n", i);
      let j = i + 1;
      let closed = -1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === q) { closed = j; break; }
        if (src[j] === "\n" && q !== "`") break; // an unclosed quote is not a literal
        j += 1;
      }
      if (closed !== -1 && (q === "`" || line === -1 || closed < line)) {
        for (; i <= closed; i += 1) out += keep(src[i]);
        continue;
      }
    }
    out += src[i];
    i += 1;
  }
  return out;
}

/** Identifiers the block DEREFERENCES (`foo.bar`) or hands over by shorthand
 *  (`{ foo }` / `key: foo,`) — i.e. names it evaluates. Property names after a
 *  dot, and keys before a colon, are excluded by construction. */
function referencedIdentifiers(block) {
  const code = blankNonCode(block);
  const names = new Set();
  // `ident.` — a member read. The negative lookbehind keeps `a.b.c` from also
  // counting `b`, and keeps an object KEY (`ident:`) out of this pass.
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\./g)) names.add(m[1]);
  // `key: ident,` and shorthand `ident,` — a value handed over as-is.
  for (const m of code.matchAll(/(?:^|[,{])\s*(?:[A-Za-z_$][\w$]*\s*:\s*)?([A-Za-z_$][\w$]*)\s*(?=[,}])/gm)) {
    names.add(m[1]);
  }
  return names;
}

/** Every name the FILE binds at any scope: declarations, functions, classes, and
 *  both destructuring forms (`{ a, b: c }` / `[a, b]`). Scope-blind on purpose —
 *  this test is about a name that exists NOWHERE, never about shadowing. */
function boundIdentifiers(src) {
  const code = blankNonCode(src);
  const names = new Set();
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\b(?:function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // Destructured bindings: take the whole pattern and read every leaf name,
  // where `a: b` binds `b` and a bare `a` binds `a`.
  for (const m of code.matchAll(/\b(?:const|let|var)\s*([[{][^=]*?[\]}])\s*=/g)) {
    for (const leaf of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?/g)) {
      names.add(leaf[2] || leaf[1]);
    }
  }
  return names;
}

// ⚠ RECURSIVE SINCE 2026-08-31. This is a SOURCE scan, not a require, so walking the whole tree
// costs nothing — and the runtime-adapter port moved a dozen modules into `main/runtime/**`,
// which a flat `readdirSync` would have dropped from a guard whose whole subject is a name in an
// export object that nothing binds. That defect is a load-time `ReferenceError`, and an adapter
// tree nothing loads until a spawn is the worst place to keep one.
function walkJs(dir, prefix, out) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walkJs(full, prefix ? `${prefix}/${entry}` : entry, out); continue; }
    if (entry.endsWith(".js")) out.push(prefix ? `${prefix}/${entry}` : entry);
  }
  return out;
}
const FILES = walkJs(MAIN, "", []);

test("the detector really catches the defect it was written for", () => {
  // A POSITIVE CONTROL. Everything above is a filter, and a filter that quietly
  // stops matching reports a clean tree forever. This is the exact shape the
  // rollback left behind — a require deleted, its use left in the export object.
  const broken = [
    "const io = require('./session-io');",
    "function launch() {}",
    "",
    "module.exports = {",
    "  launch,",
    "  baseRecord: io.baseRecord,",
    "  acceptsInboundFrom: sessionTeam.acceptsInboundFrom,",
    "};",
    "",
  ].join("\n");
  const block = exportsBlock(broken);
  assert.ok(block, "the control source must have a readable export block");
  const bound = boundIdentifiers(broken);
  const unbound = [...referencedIdentifiers(block)].filter(
    (n) => !AMBIENT.has(n) && !bound.has(n)
  );
  assert.deepEqual(unbound, ["sessionTeam"]);
});

test("the main tree is being read at all (no vacuous pass)", () => {
  assert.ok(FILES.length > 50, `expected the whole main/ tree, saw ${FILES.length} files`);
  const withExports = FILES.filter((f) => exportsBlock(readFileSync(join(MAIN, f), "utf8")));
  assert.ok(withExports.length > 40, `expected most modules to export a literal, saw ${withExports.length}`);
});

test("no main module exports a name it does not bind", () => {
  const broken = [];
  for (const file of FILES) {
    const src = readFileSync(join(MAIN, file), "utf8");
    const block = exportsBlock(src);
    if (!block) continue;
    const bound = boundIdentifiers(src);
    for (const name of referencedIdentifiers(block)) {
      if (AMBIENT.has(name) || bound.has(name)) continue;
      broken.push(`${file}: module.exports evaluates \`${name}\`, which nothing in the file binds`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    "an unbound name in `module.exports = { … }` is a load-time ReferenceError — " +
      "the module cannot be required at all. This is what a deleted `require` " +
      "leaves behind; delete the export line with it."
  );
});
