// EVERY TERMINAL OF `trigger.inboundApproved` SETTLES THE REQUEST OR LAUNCHES IT. NOTHING
// FALLS OFF THE END.
//
// ⚠ RENAMED AND REWRITTEN DOWN 2026-08-20 (was `consent-window-release.test.mjs`, §14's
// mixed-file rule). It was filed as C-9: an ACCEPTED pre-consent entry stayed in the registry
// so `startSession`'s `takeForAdopt` could reuse its WINDOW, adoption happened on exactly one
// branch, and every other exit leaked one of six window slots forever. That whole mechanism —
// the pre-consent registry, `releaseConsentWindow`, `atWindowCap`, `evictIdleShell` — is
// deleted with the session window (F-228). HALF 1 of this file drove the registry and is gone.
//
// ⚠ WHAT SURVIVED IS THE SHAPE C-9 TAUGHT, AND IT OUTLIVES ITS CAUSE: the caller KNOWS why a
// launch did not happen, because it is holding the skip reason, so every terminal states its
// outcome rather than leaving the request in an unnamed state. That is now a claim about
// SETTLEMENT rather than about window slots, and it is what stops a peer waiting on a reply
// that is never coming.
//
// METHOD: `trigger.inboundApproved` / `launchResponderSession` are brace-balanced out of the
// source and driven with a fake engine, so this exercises the SHIPPED bodies.
//
// Run: `node --test dopl-desktop-app/test/inbound-approved-terminals.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const TRIGGER = M("trigger.js");

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
  const calls = { settled: [], headless: [], courtesy: [], toSession: [] };
  const api = new Function(
    "refetchMessage", "watcher", "settings", "channelPrefs", "sessionEngine", "targeting",
    "runHeadlessApproved", "postCourtesy", "queued", "notifyLocal", "AUTH_HELD_REPLY", "RESEND", "diag",
    `${fnOf(TRIGGER, "entryFromRecord")}\n${fnOf(TRIGGER, "msgFromRecord")}\n${fnOf(TRIGGER, "taskIdFor")}\n` +
      `${braced(TRIGGER, "launchResponderSession")}\n` +
      `${braced(TRIGGER, "inboundApproved")}\n return { inboundApproved };`
  )(
    async () => cfg.fetched,
    {
      setPhase: () => {},
      settle: (key, outcome) => calls.settled.push(outcome),
      toSession: (key, a) => calls.toSession.push(a),
    },
    { getWindowMode: () => cfg.windowMode },
    // ⚠ `windowlessMessageMode` JOINED 2026-08-20 and is the REAL rule, not a stub
    // returning a constant: it is the ONE derivation of the windowless message axis
    // and `channel-dir-ipc.js › sessions:launch` calls the same function. A fake here
    // would let this suite stay green while the two lanes drifted apart, which is the
    // exact failure the shared function removes.
    {
      consumePermissionPreset: () => null,
      getAutoSend: () => cfg.autoSend === true,
      windowlessMessageMode: (_channelId, picked) =>
        (cfg.autoSend === true || picked === "auto_outbound" || picked === "auto_both")
          ? "auto_both"
          : "auto_inbound",
    },
    { launchResponderSession: async () => cfg.launch },
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

test("LAUNCHED: a real session takes ownership and nothing else fires", async () => {
  const a = approver();
  await a.inboundApproved(rec, { humanAllowed: true });
  assert.equal(a.calls.toSession.length, 1, "the watcher hands lifecycle to the engine");
  assert.deepEqual(a.calls.settled, [], "a live session settles later, on its own terms");
  assert.equal(a.calls.headless.length, 0);
});

test("RETRY: a transient refetch failure settles NOTHING — the next poll may still launch", async () => {
  const a = approver({ fetched: { retry: true } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, [], "still await-inbound");
  assert.equal(a.calls.headless.length, 0);
});

test("GONE: a message that no longer exists settles, and answers nobody", async () => {
  const a = approver({ fetched: { gone: true } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, ["gone"]);
});

test("BUSY: the peer is asked to resend, and the request is settled here", async () => {
  const a = approver({ launch: { skipped: "busy" } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, ["busy"]);
  assert.equal(a.calls.courtesy.length, 1, "the peer is TOLD, not left waiting");
  assert.equal(a.calls.headless.length, 0, "handled — it must not also run headless");
});

test("AUTH-HOLD: answered honestly and settled, never retried into the same dead slot", async () => {
  const a = approver({ launch: { skipped: "auth-hold" } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, ["auth-hold"]);
  assert.equal(a.calls.courtesy.length, 1);
  assert.equal(a.calls.headless.length, 0);
});

test("ENGINE SKIP: cap / no-sdk / disabled all fall through to the headless answer", async () => {
  // ⚠ THIS IS THE LANE SAMUEL'S RULING RETIRES IN THE NEXT WAVE. Pinned here as it stands so
  // the change is a visible edit to a green test rather than a silent behaviour drift.
  for (const skipped of ["cap", "no-sdk", "disabled"]) {
    const a = approver({ launch: { skipped } });
    await a.inboundApproved(rec, {});
    assert.equal(a.calls.headless.length, 1, `${skipped} must still answer the request`);
    assert.deepEqual(a.calls.settled, [], `${skipped}: the headless lane settles it itself`);
  }
});

test("NO SWITCH IS CONSULTED — the windowless launch is the only shape (2026-08-20)", async () => {
  const a = approver({ windowMode: false });
  await a.inboundApproved(rec, {});
  assert.equal(a.calls.toSession.length, 1);
  assert.equal(a.calls.headless.length, 0);
});
