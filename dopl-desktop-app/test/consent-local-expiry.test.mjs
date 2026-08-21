// C-7 — AN EXPIRED CONSENT REQUEST MUST NOT LEAVE ITS WINDOW OPEN WITH A LIVE ALLOW.
//
// THE DEFECT (CHANNELS-AUDIT-2026-08-07 C-7). `processRecord` had two expiry paths and only
// one of them did any work:
//   · SERVER expiry — the row's status polls back `expired`, mapped to the `inboundExpired`
//     resolver, which closes the pre-consent window AND clears the operator's armed
//     permission preset before settling.
//   · LOCAL expiry — `now - rec.createdAt > MAX_WATCH_MS`, which called `settleRequest` and
//     RETURNED. No resolver, no window close, no preset clear.
// And the local one ALWAYS wins: `MAX_WATCH_MS` equals the server's own `CONSENT_TTL_MS`, and
// `rec.createdAt` is stamped AFTER the insert returns, so the local clock is strictly the
// earlier of the two. `inboundExpired` was therefore unreachable in practice, and two things
// live inside it:
//   1. `closeConsentWindow` — so a pre-consent window left open for 24h stayed open FOREVER,
//      with a live Accept button over a row the server had already expired.
//      ⚠ DELETED, NOT FIXED-AND-KEPT (2026-08-20, F-228): there is no pre-consent window and
//      no `closeConsentWindow` to call. Half of C-7's visible damage is unreachable by
//      construction now; the ROUTING this file is about is unchanged, and half 2 below is
//      what still makes an unrouted expiry a grant bug rather than a cosmetic one.
//   2. `clearPermissionPreset` — so the posture the operator armed for a request they then
//      ignored stayed armed for the NEXT launch in that channel.
//      ⚠ ALSO DELETED, NOT FIXED-AND-KEPT (2026-08-20, Samuel's ruling): the single-use
//      permission arm is gone, so there is no `clearPermissionPreset` either. BOTH of C-7's
//      named consequences have now outlived by deletion, within thirteen days of each other.
//
// ⚠ SO WHY THE FILE STILL EXISTS, STATED PLAINLY, BECAUSE THE OBVIOUS READ IS THAT IT SHOULD
// NOT. C-7 was never a finding about windows or about arms. It was a finding about ROUTING: two
// expiry paths, one of which ran a resolver and one of which did not, where the one that did not
// ALWAYS won. The two consequences were how the defect was DETECTED, not what it was. A resolver
// that never runs is a resolver whose contents nobody checks — and the next thing put inside
// `inboundExpired` inherits that, silently, unless the routing is pinned. It is pinned here.
//
// THE FIX IS ROUTING, NOT RE-IMPLEMENTING: whichever clock notices first, an expiry does the
// same thing, because there is one definition of what an expiry does.
//
// METHOD: `processRecord` is sliced out of main/consent-watcher.js by brace balancing and
// evaluated with every collaborator injected — so this drives the SHIPPED body without
// electron, electron-store or the network.
//
// Run: `node --test dopl-desktop-app/test/consent-local-expiry.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("consent-watcher.js");
const OUTCOMES = M("trigger-outcomes.js");

function extractAsyncFn(src, name) {
  const at = src.indexOf(`async function ${name}(`);
  assert.notEqual(at, -1, `async function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", at);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(at, i);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The real `processRecord`, over fake records / clock / resolvers / consent transport. */
function harness(over = {}) {
  const cfg = { status: "pending", ...over };
  const calls = { resolved: [], settled: [], polled: [], logged: [] };
  const records = new Map();
  const inFlight = new Set();
  let now = cfg.now || 1_000_000;

  const clock = { now: () => now };
  const consent = {
    pollStatus: async (ws, rowId) => { calls.polled.push(rowId); return cfg.status; },
  };
  const safeResolve = async (name, rec, meta) => {
    calls.resolved.push({ name, key: rec.key, meta: meta || null });
    // The REAL resolvers settle the record themselves (trigger-outcomes.inboundExpired ends
    // with watcher.settle), so the fake does too — otherwise the belt below would be tested
    // against a resolver shape that does not exist.
    if (cfg.resolverSettles !== false) { records.delete(rec.key); calls.settled.push([rec.key, name]); }
    if (cfg.resolverThrows) throw new Error("resolver blew up");
  };
  const settleRequest = (key, outcome) => { records.delete(key); calls.settled.push([key, outcome]); };

  const api = new Function(
    "inFlight", "records", "isSessionPhase", "clock", "isDue", "MAX_WATCH_MS", "diag",
    "safeResolve", "settleRequest", "pollAllowed", "recentPolls", "pollTimes", "cappedAt",
    // ⚠ `isHumanAllow` WAS INJECTED HERE AND IS NOT ANY MORE (2026-08-20). `processRecord` used
    // it to stamp `{ humanAllowed }` on the resolver call for the permission arm; the arm is
    // deleted and the body no longer names it. Left injected it would have been a free variable
    // nothing reads — and if a future edit puts the read back, the ReferenceError from this
    // harness is a LOUDER failure than a silently-satisfied stub, which is the direction to fail
    // in. See "H2's authority reading SURVIVES the arm" below for where the function itself is
    // pinned.
    "POLL_WINDOW_MS", "MAX_POLLS_PER_WINDOW", "consent", "mapStatus",
    `${extractAsyncFn(SRC, "processRecord")}\n return { processRecord };`
  )(
    inFlight, records,
    (phase) => phase === "session",
    clock,
    () => true, // always due; the cadence is consent-cadence.test.mjs's subject
    DAY_MS,
    (...a) => calls.logged.push(a.join(" ")),
    safeResolve, settleRequest,
    () => true, // never rate-capped here
    (t) => t, [], 0, 60_000, 30,
    consent,
    (s) => (s === "allowed" || s === "auto_allowed" ? "allow" : s === "denied" ? "deny" : s === "expired" ? "expire" : s === "pending" ? "pending" : "unknown")
  );

  return {
    ...api, records, calls,
    setNow: (v) => { now = v; },
    add: (rec) => {
      const r = { key: "chan:41", workspaceId: "ws", rowId: "row-1", phase: "await-inbound",
        createdAt: now, lastPolledAt: 0, ...rec };
      records.set(r.key, r);
      return r;
    },
  };
}

// ── THE LOCAL CLOCK REALLY IS THE ONE THAT FIRES ─────────────────────────────────────

test("MAX_WATCH_MS equals the server's own CONSENT_TTL_MS — this branch always wins", () => {
  const m = /const MAX_WATCH_MS = ([^;]+);/.exec(SRC);
  assert.ok(m, "MAX_WATCH_MS not found");
  assert.equal(new Function(`return (${m[1]});`)(), DAY_MS);
  // `createdAt` is stamped AFTER the insert returns (consent-watcher.register), so the local
  // clock starts LATER than the server's and therefore expires FIRST every time. That is why
  // routing — rather than raising this constant — is the fix: raising it would only change
  // which of two paths runs, and the whole defect was that they were not the same path.
  assert.match(SRC, /createdAt: rec\.createdAt \|\| Date\.now\(\)/);
});

// ── THE FIX ──────────────────────────────────────────────────────────────────────────

test("C-7: a locally-expired INBOUND record runs the inboundExpired resolver", () => {
  const h = harness();
  const rec = h.add({});
  h.setNow(rec.createdAt + DAY_MS + 1);
  return h.processRecord(rec.key).then(() => {
    assert.deepEqual(h.calls.resolved.map((r) => r.name), ["inboundExpired"],
      "the SAME resolver a server-side `expired` status dispatches");
    assert.deepEqual(h.calls.polled, [], "and it costs no request — the row is already dead");
    assert.equal(h.records.has(rec.key), false, "the record is retired either way");
  });
});

test("C-7: the resolver is REACHED, and both things it used to hold are gone from the tree", () => {
  // ⚠ REWRITTEN TWICE IN ONE DAY, AND BOTH TIMES BY A DELETION (INVARIANTS §14). This case named
  // the TWO things the old `settleRequest`-and-return skipped, and neither exists now:
  //   · `sessionEngine.closeConsentWindow(rec.key, 'expired')` closed the PRE-CONSENT WINDOW, the
  //     surface that showed a live Accept over a row the server had already expired. Deleted with
  //     `renderer/session/**` (F-228) — `openConsentWindow` / `decideConsent` / `closeConsentWindow`
  //     / `releaseConsentWindow` all went together.
  //   · `channelPrefs.clearPermissionPreset(rec.channelId)` dropped the posture the operator armed
  //     for a request they then ignored, so it could not survive into the NEXT launch in that
  //     channel — a grant nobody gave (H2). Deleted with the arm (Samuel's ruling): there is no
  //     stored pair a peer-driven launch can inherit at all, because an inbound request now
  //     carries NO tool posture and lands on the reducer's `manual`.
  //
  // ⚠ THE CASE IS KEPT BECAUSE C-7 IS THE ROUTING, NOT ITS TWO SYMPTOMS. What must stay true is
  // that `inboundExpired` is a REAL, REACHED resolver rather than a name the local branch skips —
  // whatever ends up inside it next. So this now asserts the resolver exists and is the one the
  // expiry branch dispatches to (driven in the case above), and asserts the ABSENCE of both
  // deleted families, because a resolver that quietly regrew either call is exactly the drift
  // this case was written to catch. An empty slice would pass every negative below, so the
  // slice's non-emptiness is checked first.
  const at = OUTCOMES.indexOf("async function inboundExpired(");
  assert.notEqual(at, -1, "the resolver still exists — a missing slice would pass everything below");
  const body = OUTCOMES.slice(at, OUTCOMES.indexOf("\n}", at));
  assert.ok(body.length > 0);
  assert.match(body, /watcher\.settle\(rec\.key, 'expired'\)/,
    "it is terminal in its own right, not a hook that only did work through what it called");
  assert.ok(!/closeConsentWindow|releaseConsentWindow|openConsentWindow/.test(OUTCOMES),
    "the consent-window family is deleted, not merely unused — a call here would not resolve");
  assert.ok(!/clearPermissionPreset|consumePermissionPreset|armPermissionPreset/.test(OUTCOMES),
    "the permission arm is deleted, not merely unused — a call here would not resolve");
  assert.ok(!/require\('\.\/channel-prefs'\)/.test(OUTCOMES),
    "…and the module is not even required any more, so a regrowth cannot be a one-line edit");
});

// ⚠ "C-7: a locally-expired OUTBOUND review is cancelled, not silently dropped" STOOD HERE AND IS
// DELETED (2026-08-20, Samuel's ruling). It added a record in the `await-outbound` phase, pushed
// the clock past MAX_WATCH_MS, and asserted the expiry routed to `outboundCancelled` — because an
// await-outbound record held a DRAFTED REPLY the operator never sent, and settling it in place
// left the requester's card claiming the request was still being worked.
//
// Both ends of it are gone. The phase's only writer was `consent-watcher.toOutbound`, called only
// by `trigger-headless.js › openOutboundReview`, and the `claude -p` lane that drafted a reply as
// a STRING for the desktop to post is deleted. `processRecord`'s expiry branch no longer has an
// `await-outbound` arm to route into, so the case would drive a phase the shipped body cannot
// reach and assert a resolver call it cannot make.
//
// ⚠ `trigger-outcomes.js › outboundCancelled` STILL EXISTS AND NOW HAS NO CALLER — recorded here
// because this file was its last test, and a resolver nobody dispatches is precisely the shape
// C-7 was filed about.
//
// ⚠ AND APPROVE-OUT IS NOT WHAT DIED. A windowless session's own-channel post still bridges to an
// `outbound` consent row and is answered in the thread view's send box; that row is polled by the
// SESSION (`session-windowless.js › watchRow`) and the AGENT posts its own bytes when its held
// tool call is released. There is no drafted string sitting in a watcher record to expire.

test("C-7: the record is ALWAYS retired — a missing or throwing resolver cannot strand it", () => {
  // The belt. Routing must not be able to turn "settled, but silently" into "never settled",
  // which would leave the watcher polling a dead row forever.
  for (const over of [{ resolverSettles: false }, { resolverSettles: false, resolverThrows: true }]) {
    const h = harness(over);
    const rec = h.add({});
    h.setNow(rec.createdAt + DAY_MS + 1);
    return h.processRecord(rec.key).then(() => {
      assert.equal(h.records.has(rec.key), false, JSON.stringify(over));
      assert.deepEqual(h.calls.settled.at(-1), [rec.key, "expired"], "the belt fires, once");
    });
  }
});

test("C-7: the expiry is re-entrancy guarded, like every other resolve", () => {
  const h = harness({ resolverSettles: false });
  const rec = h.add({});
  h.setNow(rec.createdAt + DAY_MS + 1);
  const body = SRC.slice(SRC.indexOf("async function processRecord("));
  const expiry = body.slice(body.indexOf("if (now - rec.createdAt > MAX_WATCH_MS)"));
  assert.ok(expiry.indexOf("inFlight.add(key)") < expiry.indexOf("safeResolve"),
    "the key is claimed before the await, so a second scan cannot double-resolve");
  assert.match(expiry, /inFlight\.delete\(key\)/, "…and released in a finally");
  return h.processRecord(rec.key).then(() => {
    assert.equal(h.calls.resolved.length, 1);
  });
});

test("C-7: it says so, naming the phase — a silent retirement is what hid this for months", () => {
  const h = harness();
  const rec = h.add({});
  h.setNow(rec.createdAt + DAY_MS + 1);
  return h.processRecord(rec.key).then(() => {
    const line = h.calls.logged.find((l) => l.includes("LOCAL expiry"));
    assert.ok(line, h.calls.logged.join(" | "));
    assert.ok(line.includes("await-inbound"), line);
  });
});

// ── EVERYTHING ELSE IS UNCHANGED ─────────────────────────────────────────────────────

test("a record INSIDE the window still polls the server, and a pending row keeps waiting", () => {
  const h = harness({ status: "pending" });
  const rec = h.add({});
  h.setNow(rec.createdAt + 60_000);
  return h.processRecord(rec.key).then(() => {
    assert.deepEqual(h.calls.polled, ["row-1"]);
    assert.deepEqual(h.calls.resolved, []);
    assert.equal(h.records.has(rec.key), true, "still watched");
  });
});

test("a SERVER `expired` status reaches the same resolver, by the other route", () => {
  const h = harness({ status: "expired" });
  const rec = h.add({});
  h.setNow(rec.createdAt + 60_000);
  return h.processRecord(rec.key).then(() => {
    assert.deepEqual(h.calls.resolved.map((r) => r.name), ["inboundExpired"],
      "one definition of what an expiry does, whichever clock notices it");
  });
});

test("an engine-owned session record is never polled and never locally expired", () => {
  const h = harness();
  const rec = h.add({ phase: "session" });
  h.setNow(rec.createdAt + DAY_MS + 1);
  return h.processRecord(rec.key).then(() => {
    assert.deepEqual(h.calls.resolved, []);
    assert.deepEqual(h.calls.settled, [], "the engine owns its lifecycle — settling would double-echo");
  });
});

test("BOTH allows reach the same resolver, and neither carries an authority verdict now", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). This read "the ALLOW
  // path still tells the resolver whether a HUMAN decided it (H2)" and asserted
  // `meta === { humanAllowed: true }` for `allowed` and `{ humanAllowed: false }` for
  // `auto_allowed`. The distinction existed for ONE reason: only a live human decision could
  // consume the single-use permission arm. The arm is deleted, so `processRecord` no longer
  // passes the flag and there is nothing downstream that would read it.
  //
  // ⚠ WHAT IS ASSERTED INSTEAD IS THE PROPERTY THAT OUTLIVED IT, and it is the sharper half:
  // `auto_allowed` — the server's STANDING trust, decided by rules with no card in front of
  // anyone — must still reach the SAME resolver and spawn identically. `mapStatus` collapses the
  // two deliberately, and if that ever stops being true, a trusted channel silently stops
  // answering its peers. The old case proved the two were TOLD APART; this proves they are
  // TREATED ALIKE, which is what the code now does and what the product depends on.
  const runs = [["allowed"], ["auto_allowed"]].map(([status]) => {
    const h = harness({ status });
    const rec = h.add({});
    h.setNow(rec.createdAt + 60_000);
    return h.processRecord(rec.key).then(() => {
      assert.deepEqual(h.calls.resolved.map((r) => r.name), ["inboundApproved"], status);
      return h.calls.resolved[0].meta;
    });
  });
  return Promise.all(runs).then(([human, standing]) => {
    assert.deepEqual(human, standing, "a person clicking and standing trust are handed the same thing");
    assert.ok(!human || !("humanAllowed" in human),
      "no authority verdict rides along — nothing reads one, and a stale flag would be read as truth");
  });
});

test("H2's authority reading SURVIVES the arm, unused and exported, and is not re-derived", () => {
  // ⚠ THE DELIBERATE LOOSE END, PINNED SO IT IS NOT TIDIED AWAY AS DEAD CODE. `isHumanAllow` has
  // no production caller since the arm went. It is kept because the server still makes the
  // distinction — `allowed` is a person clicking Allow on a card; `auto_allowed` is standing
  // trust decided earlier by rules — and this is the ONE statement of how to read it. The next
  // thing that needs "was a human looking at this" must import it rather than re-deriving it
  // from a status string, which is how two answers to one question get written.
  assert.match(SRC, /function isHumanAllow\(status\) \{\s*return String\(status \|\| ''\) === 'allowed';/);
  assert.match(SRC, /isHumanAllow,/, "and it is exported, or the next caller cannot reach it");
  // …and it must NOT have quietly re-acquired a caller inside the watcher, which would mean the
  // distinction came back without the review that removing it got.
  const body = SRC.slice(SRC.indexOf("async function processRecord("));
  assert.ok(!/isHumanAllow\(/.test(body.slice(0, body.indexOf("async function safeResolve"))),
    "processRecord passes no authority verdict — see the case above for why");
});
