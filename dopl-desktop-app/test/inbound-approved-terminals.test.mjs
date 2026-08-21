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
// ⚠ AND ON 2026-08-20 THAT SHAPE ATE THE LAST EXCEPTION TO IT (Samuel's ruling, the `claude -p`
// HEADLESS deletion). Until this wave, `cap` / `no-sdk` / `disabled` did NOT state an outcome —
// they FELL THROUGH to a second executor, which owned the answer from there. `busy` and
// `auth-hold` were terminals precisely because headless would have failed on the same
// condition, so there was nothing to fall through TO. With the lane deleted that is true of
// every skip, and all three became terminals of the same construction: a LOCAL notification
// naming what the operator can do (`skippedHint`), a peer-facing `CANNOT_RUN` courtesy, and a
// `watcher.settle`. `launchResponderSession` now always returns true, because there is no
// caller-side fallback for a `false` to select.
//
// ⚠ `CANNOT_RUN` IS NOT `RESEND`, AND THE DIFFERENCE IS THE POINT. `busy` frees itself when a
// session ends, so its copy invites a resend; a spent cap and a missing runtime do not, so
// `CANNOT_RUN` says the request was not answered and does NOT invite one. Which of the two it
// was — and what to do about it — is the LOCAL notice's job; the peer is told the outcome and
// nothing about this machine.
//
// METHOD: `trigger.inboundApproved` / `launchResponderSession` are brace-balanced out of the
// source and driven with a fake engine, so this exercises the SHIPPED bodies. `skippedHint` is
// sliced in TOO rather than stubbed — it is the local copy, and a stub would let this suite stay
// green while the operator's only actionable line said the wrong thing.
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

/** The REAL inboundApproved + launchResponderSession + skippedHint, over a fake engine. */
function approver(over = {}) {
  const cfg = { fetched: { m: { body: "hi", authorUserId: "peer", seq: 41 } }, launch: { sessionId: "s-1" }, ...over };
  // ⚠ `headless` IS GONE FROM THIS LEDGER (2026-08-20) — there is no second executor to record a
  // call into. `notices` replaces it: the LOCAL notification is now how a skip becomes visible to
  // the operator, and it is the half `CANNOT_RUN` deliberately does not tell the peer.
  const calls = { settled: [], courtesy: [], toSession: [], notices: [], queued: [] };
  const api = new Function(
    "refetchMessage", "watcher", "channelPrefs", "sessionEngine", "targeting",
    "postCourtesy", "queued", "notifyLocal", "AUTH_HELD_REPLY", "RESEND", "CANNOT_RUN", "diag",
    `${fnOf(TRIGGER, "entryFromRecord")}\n${fnOf(TRIGGER, "msgFromRecord")}\n${fnOf(TRIGGER, "taskIdFor")}\n` +
      // ⚠ THE REAL `skippedHint`, sliced not stubbed: it is the operator's only actionable line,
      // and the three branches it distinguishes are the three this suite drives.
      `${fnOf(TRIGGER, "skippedHint")}\n` +
      `${braced(TRIGGER, "launchResponderSession")}\n` +
      `${braced(TRIGGER, "inboundApproved")}\n return { inboundApproved };`
  )(
    async () => cfg.fetched,
    {
      setPhase: () => {},
      settle: (key, outcome) => calls.settled.push(outcome),
      toSession: (key, a) => calls.toSession.push(a),
    },
    // ⚠ `windowlessMessageMode` JOINED 2026-08-20 and is the REAL rule, not a stub
    // returning a constant: it is the ONE derivation of the windowless message axis
    // and `channel-dir-ipc.js › sessions:launch` calls the same function. A fake here
    // would let this suite stay green while the two lanes drifted apart, which is the
    // exact failure the shared function removes.
    // ⚠ `consumePermissionPreset` IS GONE FROM THIS STUB: the single-use arm is deleted, and
    // `inboundApproved` now hard-codes `const startModes = null;`, so an inbound request carries
    // NO tool posture and lands on the reducer's `manual`. A stub that still answered would hide
    // a re-introduced consumption.
    {
      getAutoSend: () => cfg.autoSend === true,
      windowlessMessageMode: (_channelId, picked) =>
        (cfg.autoSend === true || picked === "auto_outbound" || picked === "auto_both")
          ? "auto_both"
          : "auto_inbound",
    },
    { launchResponderSession: async () => cfg.launch },
    { metaStr: () => null },
    async (_entry, _m, text) => { calls.courtesy.push(text); },
    { announce: async () => { calls.queued.push(true); } },
    (title, body) => { calls.notices.push({ title, body }); },
    "auth held", "resend", "cannot run",
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
  assert.deepEqual(a.calls.courtesy, [], "and the peer is told nothing — the reply IS the answer");
  assert.deepEqual(a.calls.notices, []);
});

test("RETRY: a transient refetch failure settles NOTHING — the next poll may still launch", async () => {
  const a = approver({ fetched: { retry: true } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, [], "still await-inbound");
  assert.deepEqual(a.calls.courtesy, [], "and nothing is said to the peer about a retryable blip");
});

test("GONE: a message that no longer exists settles, and answers nobody", async () => {
  const a = approver({ fetched: { gone: true } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, ["gone"]);
  assert.deepEqual(a.calls.courtesy, []);
});

test("BUSY: the peer is asked to RESEND, and the request is settled here", async () => {
  const a = approver({ launch: { skipped: "busy" } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, ["busy"]);
  // ⚠ THE COPY IS ASSERTED, NOT JUST THE COUNT. `busy` is the ONE skip that frees itself, so it
  // is the one that may invite a resend — and the terminal below must not borrow that invitation.
  assert.deepEqual(a.calls.courtesy, ["resend"], "the peer is TOLD, not left waiting");
  assert.deepEqual(a.calls.queued, [true], "…and the in-thread milestone lands first");
  assert.deepEqual(a.calls.notices, [], "a busy machine is not something the operator must act on");
});

test("AUTH-HOLD: answered honestly and settled, never retried into the same dead slot", async () => {
  const a = approver({ launch: { skipped: "auth-hold" } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, ["auth-hold"]);
  assert.deepEqual(a.calls.courtesy, ["auth held"], "the honest copy, not the resend one");
  assert.deepEqual(a.calls.queued, [], "nothing is queued behind a slot that will not free itself");
});

test("ENGINE SKIP: cap / no-sdk / disabled are LOUD TERMINALS — settle, tell the peer, tell me", async () => {
  // ⚠ REWRITTEN FROM "…all fall through to the headless answer" (2026-08-20, Samuel's ruling;
  // INVARIANTS §14). The old case asserted `headless.length === 1` and `settled === []`, with a
  // note that it pinned "the lane Samuel's ruling retires in the next wave" so the change would
  // be a visible edit rather than a silent drift. This is that edit.
  //
  // The lane is deleted, so there is nothing to fall through TO, and every one of these three
  // now takes the SAME shape `busy` and `auth-hold` already had — for the reason those two
  // always had it: the caller is holding the skip reason, so it is the only layer that can say
  // what happened. A request reaching this line is ANSWERED, never left pending against a
  // machine that is not going to run it.
  for (const skipped of ["cap", "no-sdk", "disabled"]) {
    const a = approver({ launch: { skipped } });
    await a.inboundApproved(rec, {});
    assert.deepEqual(a.calls.settled, [skipped],
      `${skipped}: settled under its OWN reason, so the log says which of the three it was`);
    assert.deepEqual(a.calls.courtesy, ["cannot run"],
      `${skipped}: CANNOT_RUN, not RESEND — a resend into a spent cap or a missing runtime fails identically`);
    assert.deepEqual(a.calls.queued, [],
      `${skipped}: nothing is "queued", because nothing is going to pick it up`);
    assert.equal(a.calls.notices.length, 1, `${skipped}: the operator is told locally, exactly once`);
  }
});

test("…and the LOCAL notice names the machine's state, which the peer's copy must not", async () => {
  // The split is the whole design of this terminal: `CANNOT_RUN` says the outcome and nothing
  // about this machine; `skippedHint` says what the operator can do about it. Driving the REAL
  // hint (sliced, not stubbed) is what makes that assertable rather than aspirational.
  const cap = approver({ launch: { skipped: "cap" } });
  await cap.inboundApproved(rec, {});
  assert.match(cap.calls.notices[0].title, /session limit/i, "cap gets its own title");
  assert.match(cap.calls.notices[0].body, /end one and ask them to resend/i);

  const noSdk = approver({ launch: { skipped: "no-sdk" } });
  await noSdk.inboundApproved(rec, {});
  assert.match(noSdk.calls.notices[0].title, /cannot run this request/i);
  assert.match(noSdk.calls.notices[0].body, /Claude Code is not available on this machine/i);

  const other = approver({ launch: { skipped: "disabled" } });
  await other.inboundApproved(rec, {});
  assert.match(other.calls.notices[0].body, /could not be started/i, "the generic fallback");

  // ⚠ EVERY local body names the CHANNEL, because the notice is the operator's only clue about
  // which peer went unanswered — and every one of them is local-only, so it may.
  for (const a of [cap, noSdk, other]) {
    assert.match(a.calls.notices[0].body, /"DM"/, a.calls.notices[0].body);
  }
});

test("AN UNKNOWN SKIP IS STILL A TERMINAL — the default is answered, not silent", async () => {
  // ⚠ THE BRANCH THE OLD FALL-THROUGH HID. A skip reason nobody has enumerated used to reach
  // headless like the other three; now it must reach the same terminal, because the failure
  // direction of "an unrecognized skip" has to be a peer who is told, not a peer who waits.
  const a = approver({ launch: { skipped: "something-new" } });
  await a.inboundApproved(rec, {});
  assert.deepEqual(a.calls.settled, ["something-new"]);
  assert.deepEqual(a.calls.courtesy, ["cannot run"]);
  // …and an engine that answers with no shape at all (null / undefined / {}) is the same.
  for (const launch of [null, undefined, {}]) {
    const b = approver({ launch });
    await b.inboundApproved(rec, {});
    assert.deepEqual(b.calls.settled, ["unknown"], JSON.stringify(launch));
    assert.deepEqual(b.calls.courtesy, ["cannot run"], JSON.stringify(launch));
  }
});

test("NO SWITCH IS CONSULTED — the windowless launch is the only shape (2026-08-20)", async () => {
  // ⚠ THE `settings` INJECTION WENT WITH THIS CASE'S SUBJECT. It used to hand in
  // `{ getWindowMode: () => cfg.windowMode }` and drive it false, to show the approval path
  // ignored the master switch. `inboundApproved` no longer requires `settings` at all, so the
  // read cannot exist to be ignored — the strongest form of the claim, asserted structurally.
  const body = braced(TRIGGER, "inboundApproved") + braced(TRIGGER, "launchResponderSession");
  assert.ok(!/getWindowMode|getPreConsentWindow/.test(body),
    "no master-switch read on the approval path — the engine owns its own gate");
  const a = approver();
  await a.inboundApproved(rec, {});
  assert.equal(a.calls.toSession.length, 1);
});
