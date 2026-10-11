// THE CONCURRENCY CEILING, RE-ASKED AFTER THE AWAITS (2026-10-11, release review item 1).
//
// THE DEFECT. `session-launch.js › launch` asked `liveCount(sessions) >= MAX_CONCURRENT_SESSIONS` ONCE,
// at the top, and then ran EIGHT awaits before it spawned anything — `acquireRuntime`, the credential
// probe, `refuseUnknownModel`, `refuseUnreadableProtocol`, `deliveryPath.deliveryBlockedReason` (which
// can do network work), `withRuntimeDefault`, `offeredDimensions`, `fetchOntologyReach` and
// `fetchRoomRoster` — and never asked again. The only post-await re-check was SLOT-scoped
// (`hasLiveSession`), and a fresh instance id never collides, so it could not catch this.
// `trigger.js` fires `void launchResponderSession(...)`, so two Allow clicks interleave through every
// one of those awaits: both passed a ceiling that was true when they asked, both spawned, and the
// machine ended up OVER `MAX_CONCURRENT_SESSIONS` with no refusal anywhere.
//
// `session-park.js › startResume` already re-asked after its one await — *"a racing launch may have
// taken either"* — which is the precedent this follows and the evidence that the ceiling expression
// being written out three times is what let one copy learn the lesson and the other not. It is now ONE
// helper (`capReached`), which this file also pins as the single spelling.
//
// HOW IT IS DRIVEN. `session-launch.js` is required for real (the engine harness primes electron, the
// electron-store file and the device token) and re-bound with the engine's own handle shapes faked, so
// `acquireRuntime` can be HELD mid-await per call. That makes the interleaving deterministic rather
// than a race the test hopes to lose.
//
// Run: `node --test dopl-desktop-app/test/session-launch-cap.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
// Imported for its side effects: electron / electron-store / api / the seeded device token. Every
// refusal `launch()` asks about before the cap has to answer "no" for this file's cases.
import { MAIN, CHANNEL, WORKSPACE, ME, launchArgs, settle } from "./_engine-harness.mjs";
import { codeOf } from "./helpers/source-probe.mjs";

const require_ = createRequire(import.meta.url);
const sessionLaunch = require_(join(MAIN, "session-launch.js"));
const windowless = require_(join(MAIN, "session-windowless.js"));
const registry = require_(join(MAIN, "runtime", "index.js"));

const MAX = windowless.MAX_CONCURRENT_SESSIONS;

function defer() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** The engine's handles, faked at the shapes `launch()` actually relies on. */
function bindFakes() {
  const sessions = new Map();
  const gates = [];
  let n = 0;
  sessionLaunch.bind({
    sessions,
    // HELD: each call parks on its own deferred, so the test chooses the interleaving.
    acquireRuntime: async (id) => {
      const g = defer();
      gates.push(g);
      await g.promise;
      return registry.acquire(id);
    },
    // ⚠ REGISTERS SYNCHRONOUSLY, like the real one (`session-engine.js › startSession` does
    // `sessions.set(s.key, s)` before its own first await). The post-await re-check is only sound
    // because of that, so a fake that registered later would make this file pass for the wrong reason.
    startSession: async (spec) => {
      n += 1;
      const s = { key: spec.key, sessionId: `sid-${n}`, settled: false, context: {} };
      sessions.set(spec.key, s);
      return s;
    },
    liveOnThread: () => [],
    sessionOn: () => null,
    selfUserId: () => ME,
  });
  /** Fill the registry to `count` unsettled sessions — what `liveCount` measures. */
  const fill = (count) => {
    for (let i = 0; i < count; i += 1) sessions.set(`filler-${i}`, { key: `filler-${i}`, settled: false });
  };
  return { sessions, gates, fill };
}

const args = (over) => launchArgs({ channelId: CHANNEL, workspaceId: WORKSPACE, ...over });

// ── the race ──────────────────────────────────────────────────────────────────

test("TWO CONCURRENT LAUNCHES AT CAP-1: the second is refused `cap`, not spawned", async () => {
  const h = bindFakes();
  h.fill(MAX - 1);
  assert.equal(windowless.liveCount(h.sessions), MAX - 1, "one slot left");

  // Both enter: both see MAX-1 at the top check, both park on `acquireRuntime`.
  const a = sessionLaunch.launch(args({ agentName: "First" }));
  const b = sessionLaunch.launch(args({ agentName: "Second" }));
  await settle();
  assert.equal(h.gates.length, 2, "both launches are past the cap check and inside the awaits");

  // The FIRST one takes the last slot. Everything after its gate is synchronous-to-registration.
  h.gates[0].resolve();
  const first = await a;
  assert.ok(first.sessionId, `the first launch spawns: ${JSON.stringify(first)}`);
  assert.equal(windowless.liveCount(h.sessions), MAX, "the machine is now AT the ceiling");

  // …and only now does the second one come back from its await. Before the fix it sailed through to
  // `startSession` on the strength of a cap check that was eight awaits stale.
  h.gates[1].resolve();
  const second = await b;
  assert.deepEqual(second, { skipped: "cap" }, "the ceiling is re-asked, so the second is refused");
  assert.equal(windowless.liveCount(h.sessions), MAX, "and the ceiling held — never MAX + 1");
});

test("the slot re-check cannot stand in for it: the two agents never collide on a slot", async () => {
  // Why the existing post-await re-check (`hasLiveSession`) could not catch the race: `launch()` mints
  // a FRESH instance id per spawn, so the three-part slot keys differ and `busy` is never the answer.
  const h = bindFakes();
  h.fill(MAX - 1);
  const a = sessionLaunch.launch(args());
  const b = sessionLaunch.launch(args());
  await settle();
  h.gates[0].resolve();
  const first = await a;
  h.gates[1].resolve();
  const second = await b;
  assert.notEqual(second.skipped, "busy", "a fresh id never collides — `busy` was never going to fire");
  assert.equal(second.skipped, "cap");
  assert.ok(first.agentId && first.agentId !== second.agentId);
});

test("a launch with the slot still free is spawned — the re-check refuses only AT the ceiling", async () => {
  // The guard must not become a second, stricter cap: one slot free is one launch allowed.
  const h = bindFakes();
  h.fill(MAX - 1);
  const only = sessionLaunch.launch(args());
  await settle();
  h.gates[0].resolve();
  const res = await only;
  assert.ok(res.sessionId, JSON.stringify(res));
});

// ── one spelling of the ceiling ───────────────────────────────────────────────

test("ONE SPELLING PER MODULE: no module compares the ceiling by hand more than once", () => {
  // THE DUPLICATION IS THE DEFECT, not a style point: there were THREE copies of
  // `liveCount(...) >= MAX_CONCURRENT_SESSIONS` across two files, and only the park's two ever learned
  // that the ceiling has to be re-asked after an await. Each side now asks a NAMED helper — `atCap()`
  // in `launch`, `atCap()` in `session-park.js › startResume` — so no call site can disagree with its
  // neighbour about what the ceiling means.
  //
  // ⚠ RESIDUAL, STATED RATHER THAN HIDDEN: the two helpers should be ONE shared export, and they are
  // not, because three test harnesses outside this wave's ownership evaluate these functions by slicing
  // them and injecting their bindings BY NAME — `_session-launch-funnel-harness.mjs` brace-matches
  // `launch` alone, `_session-park-harness.mjs` and `main-audit-resume-budget.test.mjs` slice
  // SESSION-PARK-PURE — so a module-level helper is undefined in all three, and
  // `session-park.test.mjs` additionally asserts on session-park.js's own source. Unifying them is a
  // four-file change.
  //
  // ⚠ OVER `codeOf`, NOT THE RAW SOURCE. A grep that reads comments is satisfied by a file that merely
  // DESCRIBES the expression, which is the fail-open shape this review round is clearing out — and it
  // caught this very case on its first run.
  const fs = require_("node:fs");
  const counts = new Map();
  for (const f of fs.readdirSync(MAIN).filter((x) => x.endsWith(".js"))) {
    const n = (codeOf(fs.readFileSync(join(MAIN, f), "utf8"))
      .match(/liveCount\([^)]*\)\s*>=\s*\w*\.?MAX_CONCURRENT_SESSIONS/g) || []).length;
    if (n) counts.set(f, n);
  }
  assert.deepEqual([...counts.entries()].sort(), [["session-launch.js", 1], ["session-park.js", 1]],
    "one named helper per module, and nothing else in the tree compares the ceiling by hand");
  // …and every ask site in each module goes through its helper, twice each (entry, then post-await).
  for (const f of ["session-launch.js", "session-park.js"]) {
    const src = codeOf(fs.readFileSync(join(MAIN, f), "utf8"));
    assert.equal((src.match(/if \(atCap\(\)\)/g) || []).length, 2, `${f}: both ask sites use the helper`);
  }
});

test("launch() asks the ceiling TWICE, and the second time is after the awaits", () => {
  const fs = require_("node:fs");
  const src = fs.readFileSync(join(MAIN, "session-launch.js"), "utf8");
  const body = src.slice(src.indexOf("async function launch(a)"), src.indexOf("/** The sentence refusing"));
  const asks = body.match(/if \(atCap\(\)\) return \{ skipped: 'cap' \};/g) || [];
  assert.equal(asks.length, 2, "once on entry, once before the spawn");
  // The second ask sits BELOW every await in the body — that is the whole property.
  const last = body.lastIndexOf("if (atCap()) return { skipped: 'cap' };");
  const spawn = body.indexOf("await deps.startSession(");
  assert.ok(last < spawn, "the re-check precedes the spawn");
  assert.equal(body.slice(last, spawn).includes("await "), false,
    "and NOTHING awaits between the re-check and the registration that answers it");
});
