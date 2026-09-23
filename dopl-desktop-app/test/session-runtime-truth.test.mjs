// WHAT A RESUME RECORD CARRIES ABOUT ITS RUNTIME — `main/session-runtime-truth.js` and the round
// trip through `session-io.js › baseRecord` -> `session-store.js › saveRecord` ->
// `session-boot.js › parkedSessionFromRecord` (2026-09-21, U10).
//
// `runtimeId` says which ADAPTER owns the conversation (the handle itself lives in the resume map).
// What the record adds is whether this runtime's cumulative usage RESETS on a resume — the fact
// `session-park.js › resumeParked` decides the token baseline from.
//
// ⚠ AND THE REGRESSION HALF: A CLAUDE RECORD WRITTEN BEFORE THESE FIELDS MUST STILL READ. The
// plan asks for exactly that ("Claude metrics and resume records remain readable across the
// storage migration"), and the fail-closed member is `'unverified'` — the answer
// `capability.js › canResume` refuses on.
//
// Run: `node --test dopl-desktop-app/test/session-runtime-truth.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require_ = createRequire(import.meta.url);

// ⚠ REQUIRED, NOT SLICED: `session-runtime-truth.js` requires NOTHING, and a plain require in a
// plain Node test is the proof of that claim as much as it is a convenience.
const truth = require_(join(MAIN, "session-runtime-truth.js"));
const registry = require_(join(MAIN, "runtime/index.js"));

const IO = readFileSync(join(MAIN, "session-io.js"), "utf8");
const STORE = readFileSync(join(MAIN, "session-store.js"), "utf8");

// The SHIPPED projection and the SHIPPED whitelist, driven end to end.
const baseRecord = new Function(
  "runtimeRegistry", "runtimeTruth",
  `${fnOf(IO, "baseRecord")}\n return baseRecord;`
)(registry, truth);
const durableSessionRecord = new Function(
  `${fnOf(STORE, "durableName")}\n${fnOf(STORE, "durableSessionRecord")}\n return durableSessionRecord;`
)();

/** `saveRecord`'s own composition, which is where the U10 whitelist is applied (outside the PURE
 *  block, because `durableSessionRecord` is sliced by three suites with no injected free vars). */
const persist = (s) => ({ ...durableSessionRecord(baseRecord(s)), ...truth.durableRuntimeTruth(baseRecord(s)) });

const live = (over = {}) => ({
  key: "c1:t1:a1", sessionId: "s1", channelId: "c1", taskId: "t1", workspaceId: "w1",
  side: "responder", profile: "full", mode: "interactive", startedAt: 1,
  state: { phase: "running", turns: 0, toolMode: "manual" }, context: {}, ...over,
});

// ── 1. THE USAGE BASELINE ────────────────────────────────────────────────────────────────────

test("the usage baseline is the descriptor's tri-state, named so a record is readable", () => {
  assert.equal(truth.usageBaseline(registry.descriptorFor("claude")), "resets");
  // ⚠ `'continues'` SINCE 2026-09-22, MEASURED: Codex's cumulative total survives a
  // `thread/resume`, so the record names that rather than an absence of knowledge.
  assert.equal(truth.usageBaseline(registry.descriptorFor("codex")), "continues");
  assert.equal(truth.usageBaseline({ session: { usageResetsOnResume: false } }), "continues");
  assert.equal(truth.usageBaseline({ session: { usageResetsOnResume: "unverified" } }), "unverified");
  // ⚠ AN ABSENT DECLARATION IS `'unverified'`, the fail-closed member: `canResume` refuses
  // anything that is not a MEASURED answer, and a missing field must not read as one.
  assert.equal(truth.usageBaseline(null), "unverified");
  assert.equal(truth.usageBaseline({ session: {} }), "unverified");
});

test("CXP-4: the record's two measured words and `capability.js`'s copy of them are ONE spelling", () => {
  // 🔒 ⚠ **A DELIBERATE SECOND COPY, HELD EQUAL HERE RATHER THAN BY DISCIPLINE.** This module is
  // CORE — it owns what a durable record may say — and `main/runtime/capability.js` is the RUNTIME
  // layer, which may not depend on core; but `capability.js › resumeZeroesBaseline` is where a
  // record's persisted word overrides today's descriptor, so it needs the same two strings. It is
  // the `session-park.js › KNOWN_PROFILES` precedent and it carries the same hazard: a word that
  // drifts does NOT fail loudly. It falls through to the descriptor, which is exactly the silent
  // re-interpretation of a finished run that persisting the field was meant to prevent.
  assert.equal(registry.capability.USAGE_BASELINE_RESETS, truth.USAGE_RESETS);
  assert.equal(registry.capability.USAGE_BASELINE_CONTINUES, truth.USAGE_CONTINUES);
  // ⚠ AND THE OVERRIDE ITSELF, IN BOTH DIRECTIONS, driven with the words this module produces.
  const resetting = registry.descriptorFor("claude");
  const continuing = registry.descriptorFor("codex");
  assert.equal(registry.capability.resumeZeroesBaseline(resetting, null), true);
  assert.equal(registry.capability.resumeZeroesBaseline(continuing, null), false);
  assert.equal(registry.capability.resumeZeroesBaseline(resetting, truth.USAGE_CONTINUES), false,
    "the RECORD's word wins — a later build must not re-interpret a run that already happened");
  assert.equal(registry.capability.resumeZeroesBaseline(continuing, truth.USAGE_RESETS), true);
  // ⚠ `'unverified'` FALLS THROUGH TO THE DESCRIPTOR, and so does junk. Every record written
  // before U10 carries no baseline at all, so deciding those off the record would mis-bill every
  // pre-U10 session on disk; `capability.js › resumeRefusal` is what gates an unmeasured RUNTIME.
  for (const said of [truth.USAGE_UNVERIFIED, undefined, null, "", "RESETS", 1]) {
    assert.equal(registry.capability.resumeZeroesBaseline(resetting, said), true, JSON.stringify(said));
    assert.equal(registry.capability.resumeZeroesBaseline(continuing, said), false, JSON.stringify(said));
  }
});

test("CXP-4: a FOURTH adapter gets the right baseline by DECLARING it, never by its id", () => {
  // ⚠ THE RULE THIS WAVE IS MOST LIKELY TO LOSE. Nothing in core may key on `codex` — an adapter
  // nobody has written yet must get the carried baseline purely by saying its totals continue,
  // and the resume gate must open for it on the same word. Driven off synthetic descriptors for
  // exactly that reason; `runtime-contract.test.mjs` asserts the same rule over the REGISTERED
  // adapters and points here for these cases, being at its own 500-line cap.
  const cap = registry.capability;
  const continues = { session: { resume: true, usageResetsOnResume: false } };
  assert.equal(cap.canResume(continues), true, "a measured `false` is resumable");
  assert.equal(cap.resumeRefusal(continues), null);
  assert.equal(cap.resumeZeroesBaseline(continues, null), false, "…and its baseline is CARRIED");
  const resets = { session: { resume: true, usageResetsOnResume: true } };
  assert.equal(cap.canResume(resets), true);
  assert.equal(cap.resumeZeroesBaseline(resets, null), true, "…and a resetting one still zeroes");
  // ⚠ THE UNMEASURED ONE IS REFUSED, AND FAILS SAFE IF IT EVER REACHED THE ARITHMETIC ANYWAY:
  // PRESERVE, never zero. The two errors are not symmetric — preserving under-counts (clamped to
  // zero by `session-io.js`), zeroing RE-BILLS history the operator already paid for.
  const unmeasured = { session: { resume: true, usageResetsOnResume: "unverified" } };
  assert.equal(cap.canResume(unmeasured), false);
  assert.equal(cap.resumeZeroesBaseline(unmeasured, null), false);
  assert.equal(cap.resumeZeroesBaseline({ session: { resume: true } }, null), false, "absent reads the same");
});

test("a hostile or absent stored baseline lands on `unverified`, never on a flattering answer", () => {
  for (const junk of [undefined, null, "", "yes", 1, true, {}, [], "RESETS"]) {
    assert.equal(truth.durableRuntimeTruth({ usageBaseline: junk }).usageBaseline, "unverified",
      JSON.stringify(junk));
  }
  assert.equal(truth.durableRuntimeTruth({ usageBaseline: "resets" }).usageBaseline, "resets");
  assert.equal(truth.durableRuntimeTruth({ usageBaseline: "continues" }).usageBaseline, "continues");
});

// ── 2. THE ROUND TRIP A RESUME DEPENDS ON ────────────────────────────────────────────────────

test("a Codex session's record states its runtime and its baseline", () => {
  const rec = persist(live({ runtimeId: "codex", liveModel: "gpt-6-astra", state: { phase: "running", turns: 0, toolMode: "untrusted" } }));
  assert.equal(rec.runtimeId, "codex");
  assert.equal(rec.usageBaseline, "continues", "and the record says how a resume of it counts usage");
});

test("REGRESSION: a Claude record still round-trips, and the metrics beside it are untouched", () => {
  const rec = persist(live({
    runtimeId: "claude", model: "opus", liveModel: "claude-opus-5",
    state: { phase: "running", turns: 7, toolMode: "auto" },
    ownPostSeq: 3, sdkSessionId: "sdk-1",
  }));
  assert.equal(rec.model, "opus");
  assert.equal(rec.turns, 7);
  assert.equal(rec.ownPostSeq, 3);
  assert.equal(rec.usageBaseline, "resets");
});

test("P4-18: the RECORD's word survives a later save — a rebuilt session is never re-derived", () => {
  // `session-boot.js › parkedSessionFromRecord` restores `usageBaseline` from the record; the next
  // park re-saves through `baseRecord`, which used to answer off TODAY's descriptor instead.
  const rebuilt = live({ runtimeId: "claude", usageBaseline: "continues" });
  assert.equal(persist(rebuilt).usageBaseline, "continues");
  // Junk on the session is not a word: the descriptor answers, and the whitelist fail-closes.
  assert.equal(persist(live({ runtimeId: "claude", usageBaseline: "sure" })).usageBaseline, "resets");
});

test("REGRESSION: a record written BEFORE the field reads, and reads fail-closed", () => {
  const old = { key: "c1:t1:a1", channelId: "c1", runtimeId: "claude", model: "opus", phase: "parked" };
  assert.deepEqual(truth.durableRuntimeTruth(old), { usageBaseline: "unverified" });
  const kept = durableSessionRecord(old);
  assert.equal(kept.model, "opus");
  assert.equal(kept.runtimeId, "claude");
  assert.equal(kept.phase, "parked");
});

// ── 3. NOTHING ELSE MAY JOIN THIS SHAPE ──────────────────────────────────────────────────────

test("the record shape is exactly one field — anything else could only arrive by edit", () => {
  // 🔒 The durable record is written to `electron-store` in the clear. A whitelist that grew a
  // passthrough is how a prompt or a filesystem path reaches disk. P4-18 deleted the two display
  // fields (`effectiveModel`, `nativePolicy`) that nothing read back.
  const out = truth.durableRuntimeTruth({ effectiveModel: "m", nativePolicy: "p", secret: "sk-live", cwd: "/Users/x" });
  assert.deepEqual(Object.keys(out), ["usageBaseline"]);
  assert.deepEqual(Object.keys(truth.runtimeTruthFields(registry.descriptorFor("claude"), live({ liveModel: "m" }))), ["usageBaseline"]);
});
