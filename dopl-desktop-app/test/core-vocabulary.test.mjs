// CORE MAY NOT NAME A VENDOR — the guard that makes "zero repeated code" mechanical.
//
// ⚠ THE FAILURE IT PREVENTS IS NOT UGLY CODE. It is a second runtime arriving as a BRANCH added
// to 138 core modules instead of a directory added under `main/runtime/`. Requirement (7) of the
// port — shared core, adapters implement only declared differences — has teeth exactly as far as
// this scan reaches and no further.
//
// ⚠ IT SCANS CODE LINES ONLY, AND THAT ALLOWANCE IS THE DIFFERENCE BETWEEN A CHECKLIST AND NOISE.
// Measured 2026-08-31 before the extraction: 50 of 138 core files contained `claude`
// case-insensitively and 21 contained `canUseTool`, including `session-reducer.js`,
// `session-state.js`, `session-effects.js`, `session-teardown.js`, `session-gate.js` and
// `session-permissions.js` — every one of which the design lists as UNTOUCHED core. Almost all of
// those hits are comments carrying hard-won argument, which this repo treats as load-bearing: a
// paragraph explaining WHY the permission bridge is shaped the way it is has to be able to name
// the thing it is explaining. So the scan strips comments and string-internal `//` before it
// looks, and a mention inside a comment is always fine.
//
// ⚠ AND `cursor` IS SCANNED AS THE VENDOR SPELLING, NOT AS A BARE WORD — the one place the port's
// design did not survive contact with this tree. `main/listener-io.js` and
// `main/listener-messages.js` use `cursor` on CODE lines for the LISTENER's pagination cursor, a
// core concept with nothing to do with Anysphere. Forbidding the bare word would fail correct
// lines and teach the next reader to rename a real domain term. The vendor spellings
// (`@cursor/`, `cursor-agent`, `cursor://`, and the id as a quoted literal) collide with nothing.
//
// HOW TO FIX A FAILURE. Not by moving the token into a comment. Either the code belongs in an
// adapter (move it), or it is asking a question core is allowed to ask — in which case ask it
// through `main/runtime/index.js`, which answers with a descriptor field or one of the sixteen
// contract methods and names no vendor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const RUNTIME_DIR = join(MAIN, "runtime");

// ⚠ THE VENDOR VOCABULARY. Two kinds of entry and they are not the same kind of rule:
//   the WORDS a platform is called (`claude`, `anthropic`, `codex`, and Cursor's own spellings),
//   and the API SHAPES only one platform has (`sdk.query`, `canUseTool`, `permissionMode`,
//   `app-server`). Both mean the same thing on a code line in core: a decision that belongs to a
//   runtime is being made where every runtime has to live with it.
const FORBIDDEN = [
  ["anthropic", /anthropic/i],
  ["claude", /claude/i],
  ["codex", /\bcodex\b/i],
  // See the header: the vendor spellings, never the bare word.
  ["cursor (the vendor)", /@cursor\/|cursor-agent|cursor:\/\/|['"]cursor['"]/i],
  ["sdk.query", /sdk\.query/],
  ["canUseTool", /canUseTool/],
  ["permissionMode", /permissionMode/],
  ["app-server", /app-server/i],
];

// ⚠ THE FILES WHOSE EXTRACTION IS SCHEDULED, EACH WITH THE STEP THAT OWNS IT. This is a CENSUS,
// not an exemption list: every entry must still HAVE a hit (asserted below), so an entry cannot
// outlive the extraction it is waiting for, and a file that is not on it can never acquire one
// quietly. Delete the row in the same change that empties the file.
//
// ⚠ `session-grant-keys.js` IS THE ONE THAT IS NOT A WHOLE-MODULE MOVE. It names `Bash` and the
// web tools directly, to scope an edit / shell / fetch grant to the shape the operator was shown.
// Those are built-in names like any other and belong in a runtime's `tools.js`; the reason it is
// deferred rather than done is that the grant KEY is a durable string an operator's standing
// grants are stored against, so changing how one is minted is a data-migration question and not a
// refactor. It carries no forbidden token today, which is why it has no row here — recorded so
// the next reader knows it was seen and not missed.
// ⚠ EVERY ROW CARRIES THE STEP THAT OWNS IT AND THE DATE IT WAS LAST RE-MEASURED. A census with
// no date is a claim about a tree that has moved; a census with no owner is a to-do list.
//
// ── WHAT WAVE D CLOSED, 2026-08-31, AND WHY THOSE FOUR AND NOT THE OTHERS ────────────────────
//
// Four rows left this list in wave D. All four were **copy or a log line** — no wire, no store,
// no behaviour — which is exactly the test of whether a step-9 row can close EARLY:
//
//   `quit-guard.js`       "session(s) holding a claude child" -> "still holding a runtime". It
//                         was also becoming FALSE: one registered adapter runs IN DOPL'S OWN
//                         PROCESS and has no child to hold.
//   `trigger-outcomes.js` AUTH_HELD_REPLY, the one vendor string a PEER reads — closed by the
//                         constant's OWN rule ("no local detail leaks: it names the state, not
//                         the machine, the account, or the error"), since WHICH RUNTIME an
//                         operator's agents run on is local detail of precisely that kind.
//   `trigger.js`          the deferral diag, the `no-sdk` operator hint, and the reason string
//                         `'no-claude-runtime'` -> `'no-agent-runtime'`. ⚠ The last of those is
//                         a WIRE WORD on the cursor contract, and it moved only because both its
//                         producer and its consumer are in this tree and pinned in one file
//                         (`listener-cursor-advance.test.mjs`). `'no-sdk'` — the SKIP code — did
//                         NOT move and must not: `trigger.js` and the directive lane both branch
//                         on it and it names no vendor.
//
// ⚠ AND ONE ROW THAT LOOKED CLOSEABLE AND IS NOT. `channel-listener.js` was filed as "copy" and
// is not copy at all: its three hits are a `require` and two CALLS into `claude-runtime.js`, the
// startup runtime probe — which is a step-6 module. Its row is corrected below rather than
// closed, because a census that mis-describes a row is how the next reader closes the wrong one.
const DEFERRED = {
  // ── step 5 — THE MODEL ROSTER AS A CAPABILITY. Owner: the step-5 wave.
  // 24 code hits @ 2026-08-31, and every one is a frozen table entry (the id vocabulary, the
  // alias map, the context-window table). Not closeable by rewording: `descriptor.models` has to
  // become the source and `main/runtime/claude/models.js` the only copy, which is a data move
  // with six duplicated vocabularies behind it.
  "session-model.js": "step 5: the frozen model + context-window tables move to the adapter's models.js",
  // ── step 6 — THE CREDENTIAL + IPC DE-NAMING. Owner: the step-6 wave, and the design says to do
  // it ALONE. It is a wire rename across preload, bridge and SPA (`claude:signIn` ->
  // `runtime:signIn`, `claude` bridge namespace -> `runtime`) with THREE test pins that move in
  // the same commit and a written review paragraph `preload-parity.test.mjs`'s convention
  // requires for a changed op. Nothing here is copy; all of it is a credential lane.
  "claude-auth.js": "step 6: the interactive sign-in flow -> the adapter's credential.js",
  "claude-resolve.js": "step 6: the external-binary probe -> the adapter's credential.js",
  "claude-runtime.js": "step 6: sessionSpawnAvailable -> the adapter's available()/packaging",
  "claude-signin-op.js": "step 6: the sign-in op -> runtime:signIn, with the two test pins",
  "claude-token.js": "step 6: the stored-token keys -> the adapter's credential.js",
  "session-auth.js": "step 6: the credential probe + env keys (the HOLD bookkeeping stays core)",
  "session-auth-detect.js": "step 6: the sentinels + the operator copy travel with the credential lane",
  "session-ipc-ops.js": "step 6: the `claude:signIn` IPC channel is renamed with its two pins",
  "session-spawner.js": "step 6: the external-CLI facade -> the adapter's credential.js",
  "auth-state.js": "step 6: the stored-credential shape for this runtime",
  // ⚠ CORRECTED 2026-08-31 (wave D) — it was filed under step 9 as "operator-facing copy naming
  // the runtime", and it is not copy: `require('./claude-runtime')` plus `checkRuntimeAtStart`
  // and `spawner.claudeAvailable()`, the STARTUP probe. It closes when `claude-runtime.js` does,
  // behind `runtime.available()` — so its owner is step 6, not step 9.
  "channel-listener.js": "step 6: the startup runtime probe -> runtime.available(), with claude-runtime.js",
  // ── step 9 — THE PROSE LAYER. Owner: the step-9 wave. Two rows left, and neither is prose.
  // ⚠ `mcp-config.js` IS THE OPERATOR'S OWN MCP ENTRY, registered through the vendor's own CLI
  // (`spawner.getClaudeBinPath()` + `mcp-cli-add.js`). It closes behind `runtime.registerMcp`,
  // which two of the three adapters currently REFUSE rather than write a possibly-wrong entry
  // into a config file the operator owns (§5 items C27 / the Cursor twin). So this row cannot
  // close before those answer, and rewording it would hide that.
  "mcp-config.js": "step 9: the operator's own MCP entry, in that runtime's CLI vocabulary (gated on C27)",
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

// CORE is `main/**` MINUS the runtime tree. ⚠ RECURSIVE, because `main/` grew its first
// subdirectory on 2026-08-31 and a flat scan would silently stop covering everything that moves
// into a future one.
const coreFiles = () =>
  walk(MAIN).filter((f) => !f.startsWith(RUNTIME_DIR + "/")).sort();

/**
 * The file's CODE, comment-free, one entry per source line so a report can name it.
 *
 * ⚠ IT IS A SCANNER, NOT A PARSER, and it only has to be right about three things: a `//` inside
 * a string literal is not a comment (`'https://…'`), a `/* *\/` block is not code, and a trailing
 * comment does not take the code before it with it. Everything else it may over- or under-strip
 * without changing an answer, because the tokens it is looking for are words.
 */
function codeLines(src) {
  const out = [];
  let line = "";
  let quote = null;
  let inBlock = false;
  let inLine = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "\n") { out.push(line); line = ""; inLine = false; continue; }
    if (inLine) continue;
    if (inBlock) { if (c === "*" && d === "/") { inBlock = false; i += 1; } continue; }
    if (quote) {
      if (c === "\\") { i += 1; continue; }
      if (c === quote) quote = null;
      line += c;
      continue;
    }
    if (c === "/" && d === "/") { inLine = true; i += 1; continue; }
    if (c === "/" && d === "*") { inBlock = true; i += 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; line += c; continue; }
    line += c;
  }
  out.push(line);
  return out;
}

function hitsIn(file) {
  const lines = codeLines(readFileSync(file, "utf8"));
  const hits = [];
  lines.forEach((line, i) => {
    for (const [label, re] of FORBIDDEN) {
      if (re.test(line)) hits.push({ label, line: i + 1, text: line.trim().slice(0, 100) });
    }
  });
  return hits;
}

test("the scanner reads CODE only — the comment allowance is what makes this a checklist", () => {
  // Driven rather than described, because the whole value of this file rests on it.
  const lines = codeLines([
    "// a comment about claude may say claude",
    "/* and a block about anthropic too",
    "   still inside the block: permissionMode */",
    "const url = 'https://example.test/x'; // a // inside a string is not a comment",
    "const real = sdk.query({}); // this IS code",
  ].join("\n"));
  assert.equal(lines[0], "", "a whole-line comment contributes no code");
  assert.equal(lines[1], "", "a block comment opens and swallows the rest of its line");
  assert.equal(lines[2], "", "…and its continuation lines");
  assert.match(lines[3], /https:\/\/example\.test\/x/, "a `//` inside a string is NOT a comment");
  assert.ok(!/not a comment/.test(lines[3]), "…but the trailing comment after it is stripped");
  assert.match(lines[4], /sdk\.query/, "and the code before a trailing comment survives");
});

test("no core module names a runtime vendor on a CODE line", () => {
  const offenders = [];
  for (const file of coreFiles()) {
    const name = relative(MAIN, file);
    if (Object.prototype.hasOwnProperty.call(DEFERRED, name)) continue;
    for (const hit of hitsIn(file)) {
      offenders.push(`main/${name}:${hit.line}  [${hit.label}]  ${hit.text}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "core is naming a runtime. Either the code belongs in an adapter (move it), or the question "
    + "belongs to `main/runtime/index.js`, which answers with a descriptor field or a contract "
    + "method and names no vendor. Do NOT move the token into a comment:\n" + offenders.join("\n")
  );
});

test("every DEFERRED file still has a hit — the census may not outlive its extraction", () => {
  // ⚠ THE HALF THAT KEEPS THIS HONEST. Without it the list only ever grows, and a row for a file
  // that was cleaned up years ago reads as permission for the next one.
  const stale = [];
  for (const name of Object.keys(DEFERRED)) {
    const file = join(MAIN, name);
    let hits = [];
    try { hits = hitsIn(file); } catch (_) { stale.push(`${name} (gone from main/)`); continue; }
    if (!hits.length) stale.push(`${name} (clean now — delete its row)`);
  }
  assert.deepEqual(stale, [], "these DEFERRED rows no longer describe anything:\n" + stale.join("\n"));
});

test("the runtime tree is where the vocabulary BELONGS, so it is not scanned — and it is used", () => {
  // The inverse assertion, so a green scan cannot mean "the adapter tree is empty too".
  const adapterFiles = walk(RUNTIME_DIR);
  assert.ok(adapterFiles.length >= 10, "the runtime tree is suspiciously small");
  const named = adapterFiles.filter((f) => hitsIn(f).length > 0);
  assert.ok(named.length > 0, "no adapter names its own platform — the extraction moved nothing");
  // ⚠ AND EVERY FILE UNDER IT IS `.js`. The 500-line cap's glob is `main/**/*.js`, so a `.mjs` or
  // `.ts` file here would match NO eslint block and be UNCAPPED — in the one tree whose stated
  // invariant is that the cap has no exemptions.
  for (const entry of walk(RUNTIME_DIR, [])) {
    assert.ok(entry.endsWith(".js"), `${relative(MAIN, entry)} is not .js — it would be uncapped`);
  }
});
