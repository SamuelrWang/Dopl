// AUDIT D4 — FIX #7's LRU eviction must serve the two paths its own comment names.
//
// FIX #7 documented the starvation exactly: the inbound gate creates a parked shell from an
// inbound message alone, a recreated shell never leaves the registry on its own, so six peer
// replies to six old threads could own the whole MAX_WINDOWS budget permanently, "after which
// launches and consent windows degraded to cap-skips". But evictIdleShell's only caller was
// recreateParkedShell — the path that CREATES the starvation. session-engine's launch() (a real
// inbound trigger) and openConsentWindow() (its pre-consent window) still returned
// {skipped:'cap'} with no eviction attempt, so a genuine trigger degraded to headless with no
// pre-consent window while six untouched dormant windows sat there.
//
// The fix is one shared helper, session-park.atCapAfterEvict: TRUE means the budget is still
// spent AFTER an eviction attempt, so every caller keeps its existing fail-restrictive skip.
// Behavior is pinned against the park PURE block; the two engine call sites are pinned against
// the real source (session-engine.js is electron-bound and has no extractable block).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PARK_SRC = readFileSync(join(HERE, "..", "main", "session-park.js"), "utf8");
const ENGINE_SRC = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");

const from = PARK_SRC.indexOf("// ─── BEGIN SESSION-PARK-PURE");
const to = PARK_SRC.indexOf("// ─── END SESSION-PARK-PURE");
assert.ok(from !== -1 && to > from, "SESSION-PARK-PURE sentinels missing or out of order");
const BLOCK = PARK_SRC.slice(from, to);

const MAX = 3; // a small stand-in for MAX_SESSION_WINDOWS

function harness() {
  const calls = { settled: [] };
  const sessions = new Map();
  const io = { makePushIterator: () => ({ push() {}, close() {} }), noteGatedBody: () => {} };
  const store = {
    sessionKey: (c, t) => `${c}:${t}`, getRecord: () => null, getSdkSessionId: () => null,
    // D2: session-park resumes on the record's OWN slot (agent for a TEAM record,
    // thread for every other), so the fake mirrors the real store's slotKey too.
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
  };
  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${BLOCK}\n return { bind, atCapAfterEvict, evictIdleShell };`
  )(io, store, { randomBytes: () => ({ toString: () => "beef" }) }, null, () => {});
  api.bind({
    sessions,
    atWindowCap: () => sessions.size >= MAX,
    settleSession: (s) => { calls.settled.push(s.key); s.settled = true; sessions.delete(s.key); },
    getSdk: async () => ({ query: () => ({}) }),
    startSession: async () => null,
    hasLiveSession: () => false,
    windowFactoryReady: () => true,
    emit: () => {},
  });
  return { ...api, sessions, calls };
}

// A dormant, untouched shell (evictable) unless told otherwise.
function shell(key, over = {}) {
  return {
    key, settled: false, startedAt: over.startedAt || 1,
    state: { parked: true, hasPendingInbound: false, ...(over.state || {}) },
    pendingInbound: over.pendingInbound || [],
    operatorTouched: over.operatorTouched === true,
  };
}

const fill = (h, shells) => shells.forEach((s) => h.sessions.set(s.key, s));

// ── the helper both engine paths now call ────────────────────────────────────────

test("D4: below the cap, nothing is evicted and nothing is refused", () => {
  const h = harness();
  fill(h, [shell("c:1")]);
  assert.equal(h.atCapAfterEvict(), false);
  assert.deepEqual(h.calls.settled, [], "an eviction is attempted ONLY at the cap");
});

test("D4: at the cap with an idle shell, one slot is freed and the caller proceeds", () => {
  const h = harness();
  fill(h, [shell("c:1", { startedAt: 10 }), shell("c:2", { startedAt: 5 }), shell("c:3", { startedAt: 20 })]);
  assert.equal(h.atCapAfterEvict(), false, "the budget is no longer spent, so the launch goes ahead");
  assert.deepEqual(h.calls.settled, ["c:2"], "LRU: the oldest untouched dormant shell");
  assert.equal(h.sessions.size, MAX - 1);
});

test("D4: FAIL RESTRICTIVE — nothing evictable still refuses", () => {
  const h = harness();
  fill(h, [
    shell("c:1", { operatorTouched: true }), // the operator used this window
    shell("c:2", { state: { parked: true, hasPendingInbound: true } }), // holding a card
    shell("c:3", { state: { parked: false } }), // live, not dormant
  ]);
  assert.equal(h.atCapAfterEvict(), true, "a cap skip, exactly as before FIX #7");
  assert.deepEqual(h.calls.settled, []);
  assert.equal(h.sessions.size, MAX, "and no window was taken from the operator");
});

test("D4: a shell with a reply QUEUED behind the head is never evicted (memory-only queue)", () => {
  const h = harness();
  fill(h, [shell("c:1", { pendingInbound: [{ pendingId: "p1" }] }), shell("c:2", { operatorTouched: true }), shell("c:3", { state: { parked: false } })]);
  assert.equal(h.atCapAfterEvict(), true);
  assert.deepEqual(h.calls.settled, []);
});

test("D4: an eviction that does not clear the cap still refuses (never over budget)", () => {
  const h = harness();
  fill(h, [shell("c:1"), shell("c:2"), shell("c:3"), shell("c:4")]); // 4 shells, cap 3
  assert.equal(h.atCapAfterEvict(), true, "still at 3 after freeing one, so still a cap skip");
  assert.deepEqual(h.calls.settled, ["c:1"], "exactly ONE eviction is attempted per call");
  assert.equal(h.sessions.size, 3);
});

test("D4: a mid-wave engine that wired no settle refuses rather than half-settling", () => {
  const h = harness();
  fill(h, [shell("c:1"), shell("c:2"), shell("c:3")]);
  h.bind({ sessions: h.sessions, atWindowCap: () => true }); // no settleSession
  assert.equal(h.atCapAfterEvict(), true);
});

// ── the two engine call sites ────────────────────────────────────────────────────

function fnBody(name) {
  const at = ENGINE_SRC.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} not found in session-engine.js`);
  return ENGINE_SRC.slice(at, ENGINE_SRC.indexOf("\n}", at));
}

test("D4: launch()'s cap branch attempts an eviction before skipping", () => {
  const body = fnBody("launch");
  assert.ok(body.includes("sessionPark.atCapAfterEvict()"), "launch must try to free a slot at the cap");
  assert.ok(body.includes("skipped: 'cap'"), "and still fail restrictive when it cannot");
  assert.ok(
    !/sessions\.size \+ sessionConsent\.count\(\) >= MAX_WINDOWS/.test(body),
    "no raw cap comparison may remain in launch: that is the branch that skipped eviction"
  );
});

test("D4: openConsentWindow()'s cap branch attempts an eviction before skipping", () => {
  const body = fnBody("openConsentWindow");
  assert.ok(body.includes("sessionPark.atCapAfterEvict()"), "a pre-consent window must try to free a slot too");
  assert.ok(body.includes("skipped: 'cap'"));
  assert.ok(
    !/sessions\.size \+ sessionConsent\.count\(\) >= MAX_WINDOWS/.test(body),
    "no raw cap comparison may remain in openConsentWindow"
  );
});

test("D4: recreateParkedShell still enforces the same shared budget through the helper", () => {
  const at = PARK_SRC.indexOf("async function recreateParkedShell(");
  const body = PARK_SRC.slice(at, PARK_SRC.indexOf("\n}", at));
  assert.ok(body.includes("atCapAfterEvict()"), "the original FIX #7 caller uses the shared helper too");
  assert.ok(body.includes("return { ok: false }"), "and is still fail-restrictive");
});
