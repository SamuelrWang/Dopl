// THE REQUEST LIFECYCLE STRIP — A DISARMED GUARD. Nothing here drives code any more; this file
// is now the regrowth guard for a surface that was deleted twice over.
//
// WHAT THE STRIP WAS. One line in the requester window's chrome saying what happened to the
// request the operator TYPED: Sent -> Accepted / Declined / Replied. It existed because those
// outcomes are invisible to the running agent — the peer's Accept and Decline arrive as
// `task_started` / `task_failed` MILESTONES and every listener route gates on
// `kind === 'message'`, so nothing feeds them to the session. Only the strip could say them.
//
// ⚠ IT IS DELETED — 2026-08-20, F-228, and this file lost eleven tests with it.
// `session-park.armRequestStatus` / `noteRequestStatus` maintained WINDOW CHROME, emitted as a
// `request_status` payload into `renderer/session/**`. That renderer is deleted, no session has
// a webContents, and both of the strip's callers (session-dispatch routes 2 and 4) went in the
// same change. What the strip reported is on the channels page now: the thread card carries the
// peer's decision as a RECEIPT ROW (INVARIANTS §5), which is a shared statement rather than one
// machine's chrome — and receipts are pinned on the channels surfaces, not from here.
//
// ⚠ THE STRIP HAD ALREADY OUTLIVED ONE SHELL BEFORE THIS (2026-08-05, rollback §3.4):
// `session-park.openRequesterShell` opened a DORMANT window for the operator's typed request
// because that post carried no runtime stamp and could not be told from an external agent's
// create. `main/ui-bridge.js` stamps `desktop-ui`, so the request opened a FULL requester
// session and the shell entry point went. THAT is the pattern this file is here to refuse: a
// deleted spawn surface that grows back a caller because its name is still pronounceable.
//
// ⚠ WHY A REGROWTH GUARD AT ALL, WHEN THE FUNCTIONS ARE SIMPLY ABSENT. Same argument
// test/removed-vocabulary.test.mjs makes one tier up, at module granularity: `module.exports` is
// EVALUATED, so a stale reference is not a dead branch, and the desktop has already shipped one
// `ReferenceError` from exactly this (`session-engine.js`'s export list, F-141). A negative is
// cheap; the failure it catches takes the whole engine down at load.
//
// ⚠ ONE ASSERTION BELOW IS DUPLICATED ON PURPOSE. test/operator-typed-request.test.mjs also
// refuses `async function openRequesterShell` — it is the suite that owns the §3.4 story. This
// file keeps it because the two deletions are one lane and a guard split across two files that
// each assume the other has it is how a guard goes missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const RENDERER = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer");
const PARK_SRC = readFileSync(join(MAIN, "session-park.js"), "utf8");

const GONE = ["armRequestStatus", "noteRequestStatus", "openRequesterShell"];

const mainSources = () =>
  readdirSync(MAIN)
    .filter((f) => f.endsWith(".js"))
    .sort()
    .map((f) => [`main/${f}`, readFileSync(join(MAIN, f), "utf8")]);

function rendererSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) rendererSources(full, out);
    else if (/\.(js|html)$/.test(entry.name)) out.push([full.slice(full.indexOf("renderer/")), readFileSync(full, "utf8")]);
  }
  return out;
}

test("the strip and the requester shell are DECLARED nowhere and EXPORTED nowhere", () => {
  const offenders = [];
  for (const [name, src] of mainSources()) {
    for (const gone of GONE) {
      // A declaration or a re-export — the two shapes a revival takes. A MENTION in prose is
      // legal and expected (the deletion comments name what they removed); tier 3 below is what
      // keeps those honest.
      if (new RegExp(`function\\s+${gone}\\s*\\(`).test(src)) offenders.push(`${name}: declares ${gone}`);
      if (new RegExp(`(^|[\\s{,])${gone}\\s*[,:]`, "m").test(src)) offenders.push(`${name}: exports/binds ${gone}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
  // session-park's own export list, stated positively: the RESUME family and nothing else.
  const exports = (PARK_SRC.match(/module\.exports = \{([\s\S]*?)\};/) || [])[1] || "";
  assert.deepEqual(
    exports.split(",").map((s) => s.trim()).filter(Boolean),
    ["bind", "resumeParked", "offerResume", "startResume", "resume"],
    "session-park exports the resume family only — every window-minting export is gone"
  );
});

test("nothing in main/ CALLS the strip or the shell", () => {
  const offenders = [];
  for (const [name, src] of mainSources()) {
    for (const gone of GONE) {
      if (new RegExp(`${gone}\\s*\\(`).test(src)) offenders.push(`${name} -> ${gone}(`);
    }
  }
  assert.deepEqual(offenders, [], `a deleted entry point has grown a caller:\n${offenders.join("\n")}`);
});

test("the `request_status` WIRE PAYLOAD is gone from main and from the renderer", () => {
  // The strip's other half: a payload type a renderer rendered. Refusing the emit AND the
  // reader is what stops half of it coming back and looking wired.
  const offenders = [];
  for (const [name, src] of [...mainSources(), ...rendererSources(RENDERER)]) {
    if (/request_status/.test(src)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `the deleted strip payload is referenced in:\n${offenders.join("\n")}`);
});

test("session-park's surviving mention of the strip is annotated as HISTORY, not stated as live", () => {
  // The removed-vocabulary tier-3 rule, applied to the two names this file owns. A paragraph
  // that names `armRequestStatus` without saying it is gone is a confident wrong answer waiting
  // to be acted on — in this codebase an agent reads the comment instead of the source.
  const lines = PARK_SRC.split("\n");
  const hits = lines
    .map((line, i) => [line, i])
    .filter(([line]) => /armRequestStatus|noteRequestStatus/.test(line));
  assert.ok(hits.length > 0, "the deletion is documented in session-park.js, not silently absent");
  for (const [line, i] of hits) {
    assert.ok(/^\s*\/\//.test(line), `main/session-park.js:${i + 1} names the strip on a CODE line`);
    let start = i;
    while (start > 0 && /^\s*\/\//.test(lines[start - 1])) start -= 1;
    let end = i;
    while (end < lines.length - 1 && /^\s*\/\//.test(lines[end + 1])) end += 1;
    const block = lines.slice(start, end + 1).join("\n");
    assert.match(block, /\b(deleted|gone|went with|no longer|removed)\b/i,
      `main/session-park.js:${i + 1} names the strip in a block that never says it is gone`);
  }
});
