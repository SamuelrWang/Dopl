// main/ui-sync.js — the JOIN LATCH's ownership rule and the replayable watch.
//
// Split out of ui-sync.test.mjs (at the 500-line cap). Both assertions come from the
// 2026-08-03 fleet audit and both are about the feed going quiet with nothing logged:
// a superseded connect attempt releasing a latch it no longer owns, and a watch that
// only main can put back after a sign-out.
//
// Run: `node --test dopl-desktop-app/test/ui-sync-latch.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf, orderOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "ui-sync.js"), "utf8");

test("only the attempt that TOOK the join latch may release it", () => {
  // Fleet audit 2026-08-03 (medium). onWake() force-clears `connecting` and starts a
  // NEWER connect while the pre-sleep token read is still pending (the 20s deadline
  // guarantees it resolves after wake). The unguarded `finally` then cleared the latch
  // the newer attempt held and ran the respawn check — spawning a THIRD connect whose
  // ++generation invalidated the healthy in-flight rejoin. Under uniform read latency
  // the chains keep invalidating each other and SUBSCRIBED never lands (repro: 120
  // generations, 119 token reads, zero subscribes).
  const fn = fnOf(SRC, "connect");
  assert.match(fn, /connectingGen = myGen/, "the attempt must record that it owns the latch");
  assert.ok(
    orderOf(fn, "connectingGen = myGen", "if (connectingGen !== myGen) return;", "connect"),
    "ownership is taken at the top and checked in the finally"
  );
  const fin = fn.slice(fn.indexOf(".finally("));
  assert.ok(
    orderOf(fin, "if (connectingGen !== myGen) return;", "connecting = false", "connect finally"),
    "a superseded attempt must release NOTHING — not the latch, not the respawn"
  );
  // `generation` cannot stand in for ownership: watch() bumps it too, so guarding on it
  // would leave the latch closed forever after a mid-flight workspace switch.
  assert.match(fnOf(SRC, "watch"), /generation \+= 1/);
  assert.ok(!/if \(myGen !== generation\) return;/.test(fin), "the finally must not guard on generation");
});

test("the watched workspace is readable, so a same-operator re-sign-in can replay it", () => {
  // stop() clears `watched` on purpose; the renderer's registry dedupes on its own
  // module state and never re-issues, so without this accessor a sign-out → sign-in
  // with the window open on a workspace page leaves the feed watching nothing forever.
  assert.match(fnOf(SRC, "watchedWorkspace"), /return watched;/);
  const at = SRC.indexOf("module.exports = {");
  assert.match(SRC.slice(at), /\bwatchedWorkspace\b[,:]/, "…and it must be exported");
});

