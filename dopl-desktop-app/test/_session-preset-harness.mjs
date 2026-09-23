// SHARED HARNESS for the H2 posture suites (`session-preset-start.test.mjs` and
// `session-posture-writers.test.mjs`).
//
// ⚠ WHY IT IS ITS OWN FILE (2026-09-22, §2). `session-preset-start.test.mjs` stood at 523 of the
// 500-line cap that `test/**/*.mjs` is linted under, so `cd dopl-desktop-app && npm run lint` —
// the CI `desktop` job — was red and neither of its two subjects could gain a case. Split on the
// seam INVARIANTS §1 names — one file per reason to change — rather than at the line the cap fell
// on. Same precedent as `_auth-hold-harness.mjs` / `_session-park-harness.mjs`: the extraction
// machinery is shared, the cases are split by subject.
//
// ⚠ THE SEAM IS READ SIDE vs WRITE SIDE, and it is a real pair of reasons to change. H2's rule
// has two halves: a posture may only travel as an explicit `spec.startModes` handed in by a
// caller executing a decision a human is making right now (the READ side — the construction
// site, the re-applying paths, the one consumer, the announcement), and nothing on the session
// path may WRITE a posture back (the write side, which is a directory CENSUS of `main/`). The
// read side changes when a spawn path changes; the census changes when a MODULE joins or leaves
// it — `channel-runtime.js` left on U5, `agent-defaults.js` joined 2026-09-18 — which is why it
// had grown to a third of the file on its own.
//
// Not a `*.test.mjs` name: the runner collects `test/**/*.test.mjs` only.
//
// ⚠ NOTHING HERE ASSERTS ANYTHING. It reads the shipped sources ONCE and hands them to both
// suites, so the two cannot drift onto different copies of `main/` — and `stripComments` is
// shared for the same reason: the absence assertions on both sides must mean the same thing by
// "the code says", or an excision note naming a deleted seam reads as the seam itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "..", "main");
export const M = (p) => join(MAIN, p);
export const read = (p) => readFileSync(M(p), "utf8");
export const ENGINE = read("session-engine.js");
export const LAUNCH = read("session-launch.js"); // the spawn funnel, split off the engine 2026-08-21
export const PARK = read("session-park.js");
export const TRIGGER = read("trigger.js");
export const CONTEXT = read("channel-context.js");
export const PREFS = read("channel-prefs.js");
// ⚠ REPOINTED 2026-08-20 (F-226): `sessions:launch` moved to `session-ipc-ops.js` when
// `channel-dir-ipc.js` was split off the 500-line cap. The record's ONE consumer did not
// change — only the file it lives in. `channel-dir-ipc.js` is still read below, because the
// "and by nothing else" half must keep covering the half that stayed.
// ⚠ REPOINTED AGAIN 2026-08-22 (the agent-identities wave): the `sessions:launch` BODY moved
// to `main/session-launch-op.js` in a §1 split, so the DURABLE POSTURE READ this file is a
// census of moved with it. `session-ipc-ops.js` still registers the op.
export const DIRIPC = read("session-launch-op.js");
export const CHANIPC = read("channel-dir-ipc.js");

export const { initialSessionState } = loadReducer();

export const WIDE = { tools: "bypass", messages: "auto_both" };

// Comments legitimately NAME the deleted seam (they explain why it is gone), so the
// absence assertions below scan CODE only.
export const stripComments = (src) => src.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); })
  .join("\n");

export { test, assert, readdirSync };
