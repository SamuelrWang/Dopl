// C-9 — AN ACCEPTED CONSENT ENTRY THAT NO SPAWN ADOPTS MUST GIVE ITS SLOT BACK.
//
// THE DEFECT (CHANNELS-AUDIT-2026-08-07 C-9). `session-consent.decide()` marks the entry
// `decided` and deliberately LEAVES it in the registry: the window is about to be reused, and
// `session-engine.startSession`'s `takeForAdopt` is what removes it. But adoption happens on
// exactly ONE branch. Every other exit from `trigger.inboundApproved` left the entry there
// forever:
//   `{skipped:'busy'}` · `'auth-hold'` · `'cap'` · `'no-sdk'` · `'disabled'` · the refetch's
//   `gone` (trigger.js:243).
// `session-consent.count()` feeds `atWindowCap` (live sessions + open consent windows vs
// MAX_WINDOWS = 6), so every leak permanently spent one of six slots. And the one mechanism
// built to reclaim slots — `session-park.evictIdleShell` — walks only `deps.sessions`, so a
// leaked consent entry is not evictable BY CONSTRUCTION. Six accepted requests that did not
// become sessions and the desktop opens nothing, ever again, until it is restarted.
//
// THE FIX IS A RELEASE AT EVERY TERMINAL, NOT A SWEEPER. A timer or an LRU over decided
// entries would be guessing at when the adopt is not coming; the caller KNOWS — it is holding
// the skip reason. So `trigger.js` says so at each terminal and `takeForAdopt` stays the ONE
// path that keeps a window alive.
//
// METHOD: both halves are source-extracted. `session-consent.js`'s registry tail is sliced
// and driven with fakes (no electron, no window factory beyond a stub), and
// `trigger.inboundApproved` / `launchResponderSession` are brace-balanced out and driven with
// a fake engine — so this exercises the SHIPPED bodies of both sides of the seam.
//
// Run: `node --test dopl-desktop-app/test/consent-window-release.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const CONSENT = M("session-consent.js");
const TRIGGER = M("trigger.js");
const PARK = M("session-park.js");

// ── HALF 1: the registry itself ──────────────────────────────────────────────────────

const PURE = CONSENT.slice(
  CONSENT.indexOf("// ─── BEGIN SESSION-CONSENT"),
  CONSENT.indexOf("// ─── END SESSION-CONSENT")
);
const TAIL = CONSENT.slice(CONSENT.indexOf("const CLOSE_LINGER_MS"), CONSENT.indexOf("module.exports = {"));

function registry() {
  const sent = [];
  const decided = [];
  const destroyed = [];
  const timers = [];
  const win = () => ({
    isDestroyed() { return this.dead === true; },
    destroy() { this.dead = true; destroyed.push(this); },
    webContents: {
      id: 1,
      isLoading: () => false,
      on() {},
      removeListener() {},
      send(_ch, payload) { sent.push(payload); },
    },
    on() {}, removeListener() {},
  });
  const api = new Function(
    "store", "consent", "watcher", "channelDirs", "replay", "diag", "setTimeout",
    `${PURE}\n${TAIL}\n return { setWindowFactory, open, decide, close, release, has, count,
                                 takeForAdopt, getByWatcherKey, registry };`
  )(
    { sessionKey: (c, t) => `${c}:${t}` },
    { patchDecision: (ws, rowId, d) => decided.push([rowId, d]) },
    { poke: () => {} },
    { resolvedDirLabel: () => "~/Downloads" },
    { createReplay: (wc, send) => ({ deliver: send, onReload() {}, onLoad() {} }) },
    () => {},
    (fn) => { timers.push(fn); return 0; }
  );
  api.setWindowFactory(win);
  return { ...api, sent, decided, destroyed, timers, runTimers: () => timers.splice(0).forEach((f) => f()) };
}

const spec = (over = {}) => ({
  channelId: "c1", taskId: "t1", workspaceId: "w1", rowId: "row-1",
  watcherKey: "c1:41", sessionId: "s1", requesterName: "David", summary: "look at X",
  ...over,
});

test("THE LEAK: an accepted entry stays in the registry, which is what the adopt needs", () => {
  const r = registry();
  r.open(spec());
  assert.equal(r.count(), 1);
  r.decide({ id: 1 }, "accept");
  assert.equal(r.count(), 1, "still counted — takeForAdopt is meant to be the remover");
  assert.deepEqual(r.decided, [["row-1", "allow"]]);
});

test("the ADOPT path removes it, exactly as before — nothing about that changed", () => {
  const r = registry();
  r.open(spec());
  r.decide({ id: 1 }, "accept");
  const adopted = r.takeForAdopt("c1:t1");
  assert.ok(adopted && adopted.win, "the live session inherits the window");
  assert.equal(r.count(), 0);
  assert.equal(r.destroyed.length, 0, "an adopted window is NOT destroyed");
});

test("THE FIX: release() hands the slot back when no spawn will adopt", () => {
  const r = registry();
  r.open(spec());
  r.decide({ id: 1 }, "accept");
  assert.equal(r.release("c1:41", "busy"), true);
  assert.equal(r.count(), 0, "the window budget is given back");
  r.runTimers();
  assert.equal(r.destroyed.length, 1, "…and the window really goes, after the linger");
});

test("release sends NO consent_resolved — the operator's Accept is not being refused", () => {
  const r = registry();
  r.open(spec());
  r.decide({ id: 1 }, "accept");
  const before = r.sent.length;
  r.release("c1:41", "headless-fallback");
  assert.equal(r.sent.length, before,
    "the card already painted Accepted; 'denied' is the only other value close() can express");
  // …whereas the DENY path does send one, unchanged.
  const d = registry();
  d.open(spec());
  d.close("c1:41", "denied");
  assert.ok(d.sent.some((p) => p.type === "consent_resolved" && p.decision === "denied"));
});

test("release is idempotent and safe on a key with no entry — callers need no guard", () => {
  const r = registry();
  assert.equal(r.release("nope", "busy"), false);
  r.open(spec());
  r.decide({ id: 1 }, "accept");
  assert.equal(r.release("c1:41", "busy"), true);
  assert.equal(r.release("c1:41", "busy"), false, "a second call changes nothing");
  assert.equal(r.count(), 0);
});

test("close() and release() share ONE teardown — a second copy is how the leak hid", () => {
  assert.match(CONSENT, /function drop\(e\) \{/);
  for (const fn of ["function close(", "function release("]) {
    const body = CONSENT.slice(CONSENT.indexOf(fn), CONSENT.indexOf(fn) + 700);
    assert.match(body, /drop\(e\)/, `${fn} must go through the shared teardown`);
  }
});

// ── HALF 2: every terminal in trigger.js says so ─────────────────────────────────────

// Brace-balance a function out of the source. The BODY brace is found AFTER the parameter
// list closes, not with a bare `indexOf("{")` — `launchResponderSession(entry, m, rec,
// { taskId, startModes })` destructures its last parameter, and the naive form stops on that
// brace and yields a syntactically broken slice.
function extract(src, name) {
  const at = src.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(at, -1, `function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("(", at);
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) { i++; break; }
  }
  depth = 0;
  i = src.indexOf("{", i);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(at, i);
}
const braced = extract;
const fnOf = extract;

/** The REAL inboundApproved + launchResponderSession, over a fake engine. */
function approver(over = {}) {
  const cfg = { fetched: { m: { body: "hi", authorUserId: "peer", seq: 41 } }, launch: { sessionId: "s-1" }, windowMode: true, ...over };
  const calls = { released: [], settled: [], headless: [], courtesy: [], toSession: [] };
  const api = new Function(
    "refetchMessage", "watcher", "settings", "channelPrefs", "sessionEngine", "targeting",
    "runHeadlessApproved", "postCourtesy", "queued", "notifyLocal", "AUTH_HELD_REPLY", "RESEND", "diag",
    `${fnOf(TRIGGER, "entryFromRecord")}\n${fnOf(TRIGGER, "msgFromRecord")}\n${fnOf(TRIGGER, "taskIdFor")}\n` +
      `${fnOf(TRIGGER, "releaseConsentWindow")}\n${braced(TRIGGER, "launchResponderSession")}\n` +
      `${braced(TRIGGER, "inboundApproved")}\n return { inboundApproved, releaseConsentWindow };`
  )(
    async () => cfg.fetched,
    {
      setPhase: () => {},
      settle: (key, outcome) => calls.settled.push(outcome),
      toSession: (key, a) => calls.toSession.push(a),
    },
    { getWindowMode: () => cfg.windowMode },
    { consumePermissionPreset: () => null },
    {
      launchResponderSession: async () => cfg.launch,
      releaseConsentWindow: (key, reason) => calls.released.push(reason),
    },
    { metaStr: () => null },
    async () => { calls.headless.push(true); },
    async () => { calls.courtesy.push(true); },
    { announce: async () => {} },
    () => {},
    "auth held", "resend",
    () => {}
  );
  return { ...api, calls };
}

const rec = { key: "c1:41", channelId: "c1", channelName: "DM", workspaceId: "w1", seq: 41, requesterName: "David", toolProfile: "full" };

test("ADOPTED: a real session launch releases NOTHING — the window is being reused", async () => {
  const a = approver();
  await a.inboundApproved(rec, { humanAllowed: true });
  assert.deepEqual(a.calls.released, [], "takeForAdopt is the remover on this branch");
  assert.equal(a.calls.toSession.length, 1);
});

test("RETRY: a transient refetch failure releases NOTHING — the next poll may still adopt", async () => {
  const a = approver({ fetched: { retry: true } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.released, []);
  assert.deepEqual(a.calls.settled, [], "still await-inbound");
});

test("GONE: a message that no longer exists releases the window it will never use", async () => {
  const a = approver({ fetched: { gone: true } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.released, ["gone"]);
  assert.deepEqual(a.calls.settled, ["gone"]);
});

test("BUSY: the peer is asked to resend, and the card is over — so is its slot", async () => {
  const a = approver({ launch: { skipped: "busy" } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.released, ["busy"]);
  assert.deepEqual(a.calls.settled, ["busy"]);
});

test("AUTH-HOLD: settled here, so nothing will ever adopt that card", async () => {
  const a = approver({ launch: { skipped: "auth-hold" } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.released, ["auth-hold"]);
  assert.deepEqual(a.calls.settled, ["auth-hold"]);
});

test("HEADLESS FALLBACK: cap / no-sdk / disabled all answer headlessly, so all three release", async () => {
  for (const skipped of ["cap", "no-sdk", "disabled"]) {
    const a = approver({ launch: { skipped } });
    await a.inboundApproved(rec, {});
    assert.deepEqual(a.calls.released, ["headless-fallback"], skipped);
    assert.equal(a.calls.headless.length, 1, `${skipped} must still answer the request`);
  }
});

test("WINDOW MODE OFF: the release is a harmless no-op (no card was ever opened)", async () => {
  const a = approver({ windowMode: false });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.released, ["headless-fallback"]);
  assert.equal(a.calls.headless.length, 1);
});

test("the release can never break the request: it is wrapped, and it is the engine's call", () => {
  const body = fnOf(TRIGGER, "releaseConsentWindow");
  assert.match(body, /try \{ sessionEngine\.releaseConsentWindow\(rec\.key, reason\); \} catch/,
    "a failing release must not take the approval down with it");
});

// ── WHY A SWEEPER WAS NOT THE ANSWER ─────────────────────────────────────────────────

test("the eviction path still cannot see consent entries — which is why release() must be exact", () => {
  // `atWindowCap` counts sessions + consent entries, but `evictIdleShell` walks ONLY the
  // session registry. That asymmetry is what turned a leak into a permanent cap, and it is
  // unchanged: the fix is that nothing leaks, not that leaks get collected.
  const evict = PARK.slice(PARK.indexOf("function evictIdleShell()"));
  assert.match(evict, /for \(const s of deps\.sessions\.values\(\)\)/);
  assert.ok(!/sessionConsent|consentRegistry/.test(evict),
    "session-park must not grow a second registry to walk");
});
