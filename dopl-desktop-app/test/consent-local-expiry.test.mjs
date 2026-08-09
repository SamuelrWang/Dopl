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
//   2. `clearPermissionPreset` — so the posture the operator armed for a request they then
//      ignored stayed armed for the NEXT launch in that channel.
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
    "POLL_WINDOW_MS", "MAX_POLLS_PER_WINDOW", "consent", "mapStatus", "isHumanAllow",
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
    (s) => (s === "allowed" || s === "auto_allowed" ? "allow" : s === "denied" ? "deny" : s === "expired" ? "expire" : s === "pending" ? "pending" : "unknown"),
    (s) => s === "allowed"
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

test("C-7: that resolver is where closeConsentWindow and clearPermissionPreset live", () => {
  // The window and the preset are the two things the old `settleRequest`-and-return skipped.
  // Pinned against trigger-outcomes.js so a future edit that moves either one out of the
  // resolver has to come back here and say why.
  const body = OUTCOMES.slice(OUTCOMES.indexOf("async function inboundExpired("));
  assert.match(body, /sessionEngine\.closeConsentWindow\(rec\.key, 'expired'\)/,
    "a 24h-old window with a live Accept over an expired row is the visible half of C-7");
  assert.match(body, /channelPrefs\.clearPermissionPreset\(rec\.channelId\)/,
    "and an armed posture surviving into the NEXT launch is the invisible half");
});

test("C-7: a locally-expired OUTBOUND review is cancelled, not silently dropped", () => {
  // An await-outbound record holds a DRAFTED REPLY the operator never sent. Expiring it
  // through `outboundCancelled` posts the "Reply was not sent" echo; settling it in place
  // left the requester's card claiming the request was still being worked.
  const h = harness();
  const rec = h.add({ phase: "await-outbound" });
  h.setNow(rec.createdAt + DAY_MS + 1);
  return h.processRecord(rec.key).then(() => {
    assert.deepEqual(h.calls.resolved.map((r) => r.name), ["outboundCancelled"]);
  });
});

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

test("the ALLOW path still tells the resolver whether a HUMAN decided it (H2)", () => {
  for (const [status, humanAllowed] of [["allowed", true], ["auto_allowed", false]]) {
    const h = harness({ status });
    const rec = h.add({});
    h.setNow(rec.createdAt + 60_000);
    return h.processRecord(rec.key).then(() => {
      assert.deepEqual(h.calls.resolved[0].meta, { humanAllowed }, status);
    });
  }
});
