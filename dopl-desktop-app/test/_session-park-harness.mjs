// SHARED HARNESS for the RESUME suites (`main/session-park.js`'s SESSION-PARK-PURE block).
//
// ⚠ WHY IT IS ITS OWN FILE (2026-09-21, U10). `session-park.test.mjs` stood at 435 of the
// 500-line cap that `test/**/*.mjs` is linted under, and U10 owes this lane a section of its own:
// the Codex resume refusal is the plan's "Usage on resume" OPEN QUESTION, and the cases that keep
// it from being enabled without a measurement belong beside the ones that prove the Claude resume
// still works. Split on the seam INVARIANTS §1 names — one file per reason to change — rather
// than at the moment a lint failed (F-226). Same precedent as `_auth-hold-harness.mjs` and
// `_session-boot-harness.mjs`: the extraction machinery is shared, the cases are split by subject.
//
// ⚠ NOT A `*.test.mjs` NAME ON PURPOSE — the runner collects `test/**/*.mjs`, and a leading
// underscore is this tree's convention for a harness that is imported and never collected.
//
// Tests for the RESUME machinery (main/session-park.js) — P1: the in-place resume of a session
// whose SDK query was torn down at park, plus startResume's check-then-act guard.
//
// SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-PARK-PURE block references its leaf
// deps (io / store / crypto / Notification / diag) as free vars (required at the module top,
// like session-dispatch.js) plus a bind()-set `deps` for the engine handles. We slice the block,
// prove it is electron/require-free, inject fakes, and pin the ONE property the lane exists for:
// resumeParked rebuilds the query THROUGH buildLaunchSpec (the v1.9 security path) with
// options.resume = the retained sdkSessionId — no divergent option assembly, no new
// auto-approval — and it does so SYNCHRONOUSLY, so the effect the reducer queues right behind it
// lands on the FRESH iterator.
//
// ⚠ THE P2 SHELL-RECREATE HALF OF THIS FILE IS DELETED — 2026-08-20, F-228. Five session-park
// exports went with it (`recreateParkedShell`, `openFromChannel`, `emitParkedShell`,
// `evictIdleShell`, `atCapAfterEvict`), and every one of them existed to OPEN, PAINT or MAKE
// ROOM FOR a v1 SESSION WINDOW — a surface that no longer exists anywhere in the tree (the whole
// `renderer/session/**` tree and `main/session-window.js` are gone; agents run WINDOWLESS on the
// SDK engine). Its four injected handles left too: bind() no longer takes `windowFactoryReady`,
// `atWindowCap`, `loadHistory` or `settleSession`.
//
// ⚠ EVERY REMOVED SECTION IS NAMED IN PLACE BELOW, NOT SILENTLY DROPPED (INVARIANTS §14). A test
// file that loses a section without saying which one is a file nobody can audit against the next
// wave — and twice now a whole-file deletion has taken an unrelated live guard with it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-park.js"), "utf8");
// ⚠ INJECTED REAL (2026-08-22). `startResume` is the ONE spawn that does not go through
// `session-launch.js › launch`, so it mints its own instance id — and a FAKE mint would let the
// charset drift away from what `channel_sessions.name`'s CHECK accepts, which is the exact
// failure this wave fixed. Same discipline the summary harness follows for `session-pill.js`.
const agentId = createRequire(import.meta.url)(join(HERE, "..", "main", "agent-id.js"));
// ⚠ THE REAL REGISTRY (2026-08-31, port wave D). `resumeParked` / `startResume` now REFUSE a
// resume on a runtime whose `session.usageResetsOnResume` is `'unverified'` — a runtime that
// CONTINUES the cumulative total makes every cost delta negative, clamps it to zero, and stops
// the cost cap ever firing with no symptom until a bill arrives. The real registry loads cleanly
// here (every adapter defers its platform binding), so what these cases drive is the predicate
// the app applies rather than a stub that agrees with itself.
const RUNTIME = createRequire(import.meta.url)(join(HERE, "..", "main", "runtime", "index.js"));

// ⚠ AND THE FAKE `slotKey` IS THE REAL THREE-PART SHAPE. It mirrored the deleted D2 CHOICE
// (`agentId` OR `taskId`), which stopped being what `main/session-store.js › slotKey` does when
// multiplayer blended all three — so a case could pass here against a key production never builds.
const fakeSlotKey = (a) => `${(a && a.channelId) || ""}:${(a && a.taskId) || ""}:${(a && a.agentId) || ""}`;

const BEGIN = "// ─── BEGIN SESSION-PARK-PURE";
const END = "// ─── END SESSION-PARK-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-PARK-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-PARK-PURE sentinel missing");
assert.ok(to > from, "session-park sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The purity assertion is UNCHANGED by the retirement and is the reason the block can be sliced
// at all: the resume family must stay reachable from a plain `new Function`, so a future edit
// cannot quietly re-import electron into the one path a crash recovery runs through.
for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-PARK-PURE block must not reference ${banned}`);
}

const flush = () => new Promise((r) => setImmediate(r));

// ⚠ THE CEILING, READ OUT OF THE FILE THAT OWNS IT (2026-08-22, F-272). `session-windowless.js`
// is not sliceable — it requires consent/targeting/channel-post — so the harness stubs it; taking
// the NUMBER from its source is what stops the stub becoming a second, agreeing-with-itself
// ceiling while production enforces a different one. That is exactly the failure C-2 caught on
// the other side of this tree.
const WINDOWLESS_SRC = readFileSync(join(HERE, "..", "main", "session-windowless.js"), "utf8");
const REAL_MAX = Number((WINDOWLESS_SRC.match(/MAX_CONCURRENT_SESSIONS = (\d+)/) || [])[1]);
assert.ok(REAL_MAX > 0, "MAX_CONCURRENT_SESSIONS not found in session-windowless.js");

function harness(over = {}) {
  const cfg = { gateSdk: null, ...over };
  const calls = { buildLaunchSpec: [], consume: [], dispatch: [], startSession: [], query: [], acquired: [], diag: [] };

  const io = {
    makePushIterator: () => ({ __iter: true, pushed: [], push(m) { this.pushed.push(m); }, close() { this.closed = true; } }),
  };
  const sessions = new Map();
  const store = {
    // session-park resumes on the record's OWN slot — all three parts, exactly as
    // `main/session-store.js › slotKey` composes them. It is the ONE store call the surviving
    // block makes — `getRecord` / `getSdkSessionId` went with the shell-recreate lane, which read
    // a durable record to rebuild a window from.
    slotKey: fakeSlotKey,
  };
  const crypto = { randomBytes: () => ({ toString: () => "deadbeef" }) };
  const Notification = null; // offerResume is exercised elsewhere; not under test here
  // ⚠ CAPTURED, NOT DISCARDED (2026-08-31, port wave D). One line this module emits is
  // load-bearing enough to assert: a resume refused on capability grounds has to say WHY in a
  // sentence an operator can read, because a refusal they cannot read is one they work around.
  const diag = (...parts) => calls.diag.push(parts.join(" "));

// ⚠ 2026-08-31 (runtime-adapter port): `acquireRuntime` became `acquireRuntime` and the assembled
// options became an OPAQUE launch spec the runtime itself starts. The await this harness
// drives is the same one, in the same place; only the name and the shape moved.
  const fakeRuntime = { resume: (spec) => { calls.query.push(spec); return { __query: true }; } };
  const deps = {
    sessions,
    // `gateSdk` (a deferred) lets a test hold acquireRuntime mid-await to drive the check-then-act race.
    // ⚠ AND IT RECORDS WHICH RUNTIME IT WAS ASKED FOR (2026-08-31, port wave D). A park must not
    // land a conversation on a different vendor: `s.runtimeId` / `rec.runtimeId` is stamped at
    // spawn, persisted by `session-store.js › durableSessionRecord`, and handed back here.
    acquireRuntime: async (runtimeId) => {
      calls.acquired.push(runtimeId);
      if (cfg.gateSdk) await cfg.gateSdk;
      return fakeRuntime;
    },
    // ⚠ THE SPEC IS OPAQUE TO CORE and this fake mirrors that: it carries the prompt the
    // lifecycle just built plus whatever the runtime needs, and core never looks inside. The two
    // properties this file pins — the SAME fresh iterator drives the resumed run, and the
    // conversation id is the only field that differs from a cold launch — are both on it.
    buildLaunchSpec: (s) => { calls.buildLaunchSpec.push(s); return { prompt: s.pushIterator, options: { resume: s.resumeSdkId, settingSources: [] } }; },
    consume: (s, q) => calls.consume.push({ s, q }),
    dispatch: (s, ev) => calls.dispatch.push({ s, ev }),
    // Real startSession sets the Map entry SYNCHRONOUSLY (before its own first await); the fake
    // mirrors that, so a re-check sees a session created during a acquireRuntime await.
    startSession: async (spec) => { calls.startSession.push(spec); const sess = { key: spec.key, settled: false, ...spec }; sessions.set(spec.key, sess); return sess; },
    hasLiveSession: (a) => { const s = sessions.get(store.slotKey(a)); return !!(s && !s.settled); },
    emit: () => {},
  };

  // ⚠ `privateTurn` JOINED THE INJECTED SET ON 2026-08-22 (Samuel's private-turn depth ruling):
  // a resume REBUILDS the query, so the `result` events the old one still owed die with it and
  // the private-turn depth they would have spent must be reset, or the next private turn opens on
  // top of a surplus and withdraws Axis B's outbound widening for turns nobody made private. The
  // REAL module is injected rather than a stub — it is pure, and the reset is the behaviour.
  // ⚠ `sessionWindowless` JOINED THE INJECTED SET ON 2026-08-22 (F-272): `startResume` enforces
  // `MAX_CONCURRENT_SESSIONS`, which it did not before — a resume could reach seven. It is a
  // STUB rather than the real module because `session-windowless.js` requires consent/targeting/
  // channel-post and is not sliceable — but the NUMBER is read out of that file's source below,
  // so the stub cannot drift from the ceiling it is standing in for. `liveCount` is the real
  // one-liner (unsettled sessions in the registry), restated.
  const sessionWindowless = {
    MAX_CONCURRENT_SESSIONS: cfg.cap === undefined ? REAL_MAX : cfg.cap,
    liveCount: (map) => { let n = 0; for (const s of map.values()) if (!s.settled) n += 1; return n; },
  };
  const api = new Function(
    "io", "store", "crypto", "newAgentId", "isAgentId", "Notification", "privateTurn",
    // ⚠ `directedTurn` JOINED THE INJECTED SET ON 2026-08-31 (the private direct lane).
    // `resumeParked` drops a DIRECTED capture for the same reason it zeroes the private
    // depth: a rebuilt query owes no results, so a capture carried across a resume would
    // attach the NEXT turn's text to a direction that never got one. The REAL module is
    // injected rather than a stub — it is pure, and the reset is the behaviour.
    "directedTurn",
    "sessionWindowless", "diag", "sessionCredential", "runtimeRegistry", "runtimeCapability",
    `${BLOCK}\n return { bind, resumeParked, startResume };`
  )(io, store, crypto, agentId.newAgentId, agentId.isAgentId, Notification,
    createRequire(import.meta.url)(join(HERE, "..", "main", "session-private.js")),
    createRequire(import.meta.url)(join(HERE, "..", "main", "session-directed.js")),
    sessionWindowless, diag,
    // 🔒 THE CONTAINER LOCK (plan §4.4 B1). Stubbed to a no-op mint: this harness is about the
    // RESUME path, and the credential's own behaviour is pinned in
    // `session-audience-ceiling.test.mjs`. What matters here is that the resume still assembles
    // its spec through the shared `buildLaunchSpec` afterwards.
    { ensureContainerCredential: async () => null, sessionBearer: () => "" },
    RUNTIME, RUNTIME.capability);
  api.bind(deps);
  return { ...api, deps, sessions, calls, cfg, store };
}

export { test, assert, harness, flush, agentId, RUNTIME, fakeSlotKey, REAL_MAX, BLOCK, SRC, HERE, join };
