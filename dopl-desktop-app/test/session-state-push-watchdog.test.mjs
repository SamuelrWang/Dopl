// THE WRITER'S SINGLE-FLIGHT GUARD HAS A DEADLINE (2026-09-14, F-698 — the other half of Samuel's
// "@prime" report).
//
// `schedule` sets `running = true` and every later call returns while it holds. The 09:11:00Z boot
// cycle awaited a token refresh that hung ~25 minutes (`auth-refresh-transport.js` carries that
// half), and nothing ever cleared the guard: for nine hours every state change — including the
// spawn of agent `shyu9bzg` at 18:28:23Z — was queued behind a cycle that was never coming back,
// `channel_sessions` held one row stamped 01:22Z, and the server could not resolve `@prime`
// because the row that would have named it was never written. The lane logged NOTHING in either
// direction, which is the second thing this suite pins: a landed push now says so.
//
// Run: `node --test dopl-desktop-app/test/session-state-push-watchdog.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { armed, drained, entry, heal } from "./_session-state-push-harness.mjs";

/** A `heal` whose watchdog a case fires by hand, wrapped around the REAL `watchPass` so the
 *  race/clear mechanics under test are the shipped ones — only the clock is the case's. */
function handHeal() {
  const deadlines = [];
  const timers = {
    setTimeout: (fn, ms) => { const t = { fn, ms, unref() {} }; deadlines.push(t); return t; },
    clearTimeout: (t) => { const i = deadlines.indexOf(t); if (i >= 0) deadlines.splice(i, 1); },
  };
  return {
    watchPass: (pass, onDeadline, ms) => heal.watchPass(pass, onDeadline, ms, timers),
    fire: async () => { const t = deadlines.shift(); assert.ok(t, "no watchdog armed"); t.fn(); await drained(); },
    armedMs: () => deadlines.map((t) => t.ms),
  };
}

test("a cycle that never settles releases the guard at the deadline, and the NEXT state change pushes", async () => {
  const h = handHeal();
  let hang = true;
  const server = () => (hang ? { hang: true } : { ok: true, status: 200 });
  const { m, summary } = armed({ heal: h, server });
  const origFetch = m.posts;
  summary.emit([entry()]);
  await drained();
  assert.equal(origFetch.length, 1, "the boot cycle went to the wire once");
  assert.deepEqual(h.armedMs(), [20 * 60 * 1000], "the watchdog is armed for the cycle");
  // A state change while the cycle hangs: coalesced, not run — that is the guard working.
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(origFetch.length, 1, "no second write while the guard holds");
  // The deadline: the guard releases, loudly.
  await h.fire();
  assert.ok(m.logged.some((l) => l.includes("cycle still running after") && l.includes("RELEASING")),
    "the release is logged as a defect, not a diag-if-enabled");
  // …and the next state change runs a fresh cycle instead of queueing behind the dead one.
  hang = false;
  summary.emit([entry({ state: "idle" })]);
  await drained();
  assert.equal(origFetch.length, 2, "the writer is alive again");
  assert.equal(origFetch[1].options.body.sessions[0].state, "idle");
});

test("a landed push is logged — the lane is no longer silent on success", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.ok(m.logged.some((l) => /session-state push: stored 1 row\(s\) ws ws-1/.test(l)), m.logged.join("\n"));
});

test("a healthy cycle disarms its watchdog — no deadline outlives the cycle it guarded", async () => {
  const h = handHeal();
  const { summary } = armed({ heal: h });
  summary.emit([entry()]);
  await drained();
  assert.deepEqual(h.armedMs(), [], "cleared on settle");
});
