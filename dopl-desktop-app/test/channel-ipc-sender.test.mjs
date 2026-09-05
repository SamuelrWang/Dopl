// H3 (2026-07-31) — SENDER BINDING on main/channel-dir-ipc.js.
// PHASE 10 (2026-08-18) — THE SUBJECT OF THAT BINDING WIDENED, DELIBERATELY.
//
// THE DEFECT H3 FIXED. Every handler in that file validated its PAYLOAD (channelId as a
// UUID, both permission modes against frozen enums) and never validated its CALLER, while
// the preload exposed all of them on a window that loaded REMOTE usedopl.com content. So
// any XSS, any compromised script, any injected third-party bundle on that origin could
// call them directly — and the worst was `channels:setPermissionPreset`, which armed the
// permission posture a spawned agent ran with. Chained with H2 (before it was fixed) that
// was zero-click local code execution.
//
// ⚠ THAT OP IS DELETED AND THE ARGUMENT IS NOT (2026-08-20, Samuel's ruling; INVARIANTS §14).
// The single-use permission arm went with its two handlers (`channels:getPermissionPreset` /
// `channels:setPermissionPreset`), so the OPS table below is two rows shorter. The
// worst-case op is now `channels:setLaunchPosture` — the DURABLE half of the same two axes,
// same validator, same UUID gate, and a longer-lived write than the arm ever had. Nothing
// about the binding weakened; the enumeration re-measured.
//
// ⚠ AND THE COUNT IS PART OF THE PIN. `no handler in the file skips the wrapper` asserts
// `ipcMain.handle` occurrences EQUAL `OPS.length`, so this table cannot drift from the file in
// either direction: a new op added without a row fails, and a row left behind for a deleted op
// fails too. Shrinking it is therefore a deliberate edit, made here, and not a silent one.
//
// WHAT PHASE 10 CHANGED, AND WHAT IT DID NOT. The binding's subject was "THE MAIN WINDOW"
// and is now "any window main itself registered at creation" — `main/app-windows.js`'s
// registry, which is the shell plus any POP-OUT THREAD WINDOW. Samuel's ruling, 2026-08-18,
// option (a): widen the guard rather than build the thread view a second time on the
// session-window renderer. Everything else is unchanged and this file is what says so:
//
//   1. the sender must be a REGISTERED webContents — and the registry is written only by
//      main, at window creation, so a renderer cannot enlarge the set it is judged against
//      (`test/app-windows.test.mjs` proves that half); AND
//   2. it must be that webContents' TOP FRAME, because a cross-origin iframe SHARES its
//      host's webContents and would otherwise pass check 1 unchallenged.
//
// ⚠ THE BOUND SENDERS ARE ENUMERATED HERE, NOT REMEMBERED. The plan asked for exactly
// that: a widened guard needs a test that lists who may call, rather than an editor's
// recollection of who may. `bootIpc` binds TWO windows (a shell and a pop-out) and every op
// is driven from both, from a THIRD unregistered window, from an iframe inside a bound one,
// and against an unbound surface — with the refusal VALUE pinned identical in every case.
//
// ⚠ ONE HARDENING RODE ALONG AND IS STATED RATHER THAN SMUGGLED (F-221): the frame check
// here read `if (frame && sender.mainFrame && frame !== sender.mainFrame)`, which WAVED
// THROUGH a `senderFrame` reading as null/undefined, while `main/ui-bridge.js`'s copy of
// "the same" predicate refused it. Two copies disagreeing, with the more privileged surface
// on the lenient side. Now fail-closed on both, and asserted below.
//
// Run: `node --test dopl-desktop-app/test/channel-ipc-sender.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  M, SRC, OPS_SRC, BOTH, BLOCK, isAppWindowSender, evalModule,
  mkWin, evt, idsOf, bootIpc, CH, PRESET, POPOUT_PAYLOAD,
} from "./_ipc-harness.mjs";

// ⚠ THE BOOT MACHINERY MOVED TO `_ipc-harness.mjs` ON 2026-08-20 (F-226). This suite crossed
// the cap when the split made it read two sources; the harness is shared rather than copied,
// so the two IPC suites cannot drift into booting different programs.


test("the guard ACCEPTS a registered window's own top frame", () => {
  const { webContents, mainFrame } = mkWin();
  assert.equal(isAppWindowSender(evt(webContents, mainFrame), idsOf(webContents)), true);
});

test("the guard ACCEPTS EVERY registered window — this is the Phase 10 widening", () => {
  // The whole point of the change: a pop-out thread window is as legitimate a caller as
  // the shell, because main registered both at creation.
  const shell = mkWin();
  const popout = mkWin();
  const bound = idsOf(shell.webContents, popout.webContents);
  assert.equal(isAppWindowSender(evt(shell.webContents, shell.mainFrame), bound), true,
    "the shell");
  assert.equal(isAppWindowSender(evt(popout.webContents, popout.mainFrame), bound), true,
    "the pop-out thread window");
});

test("the guard REFUSES a window that is NOT in the registry", () => {
  // A session window, a consent window, the update-required screen, or anything else main
  // did not bind — the widening admitted registered windows, not all windows.
  const shell = mkWin();
  const stranger = mkWin();
  assert.equal(
    isAppWindowSender(evt(stranger.webContents, stranger.mainFrame), idsOf(shell.webContents)),
    false
  );
});

test("the guard REFUSES a window that has LEFT the registry (a closed pop-out)", () => {
  const shell = mkWin();
  const popout = mkWin();
  // Its id fell out of the set when the window died; a stale id must not stay bound.
  assert.equal(
    isAppWindowSender(evt(popout.webContents, popout.mainFrame), idsOf(shell.webContents)),
    false
  );
});

test("the guard REFUSES an IFRAME inside a registered window (same webContents, different frame)", () => {
  // This is the check identity alone would miss, and it did NOT move in Phase 10: an
  // embedded cross-origin frame shares its host's webContents, so the id matches for it.
  const { webContents } = mkWin();
  const iframe = { name: "an-embedded-frame" };
  assert.equal(isAppWindowSender(evt(webContents, iframe), idsOf(webContents)), false);
});

test("the guard FAILS CLOSED on a missing / empty / non-Set registry", () => {
  const { webContents, mainFrame } = mkWin();
  const e = evt(webContents, mainFrame);
  assert.equal(isAppWindowSender(e, null), false, "register ran before any window existed");
  assert.equal(isAppWindowSender(e, undefined), false, "no accessor was supplied at all");
  assert.equal(isAppWindowSender(e, new Set()), false, "no window is bound yet");
  assert.equal(isAppWindowSender(e, {}), false, "not a Set — an unbound surface, not an open one");
  assert.equal(isAppWindowSender(e, [webContents.id]), false, "an array is not the contract");
});

test("the guard FAILS CLOSED on a DESTROYED sender whose id is still bound", () => {
  // The registry sweeps, but a webContents can die between the sweep and the call.
  const { webContents, mainFrame } = mkWin();
  webContents.isDestroyed = () => true;
  assert.equal(isAppWindowSender(evt(webContents, mainFrame), idsOf(webContents)), false);
});

test("the guard FAILS CLOSED on a senderFrame getter that THROWS (a detached frame)", () => {
  // Electron's `senderFrame` throws once the frame is gone. Reading it defensively must
  // refuse, never wave the call through.
  const { webContents } = mkWin();
  const hostile = { sender: webContents };
  Object.defineProperty(hostile, "senderFrame", {
    get() { throw new Error("frame detached"); },
  });
  assert.equal(isAppWindowSender(hostile, idsOf(webContents)), false);
});

test("F-221 — the guard FAILS CLOSED on an ABSENT frame, matching ui-bridge's copy", () => {
  // The pre-Phase-10 form here was `if (frame && sender.mainFrame && frame !== …)`, which
  // ADMITTED a null/undefined senderFrame while main/ui-bridge.js's copy refused it. This
  // file is the more privileged of the two (it arms permission presets), so the divergence
  // ran the wrong way. Closed in the same security change.
  const { webContents } = mkWin();
  const bound = idsOf(webContents);
  assert.equal(isAppWindowSender(evt(webContents, null), bound), false);
  assert.equal(isAppWindowSender(evt(webContents, undefined), bound), false);
  // …and a webContents with no mainFrame at all.
  const noMain = { id: 999, isDestroyed: () => false };
  assert.equal(isAppWindowSender(evt(noMain, {}), new Set([999])), false);
});

test("the guard FAILS CLOSED on a missing sender, a missing event, or a non-numeric id", () => {
  const { webContents } = mkWin();
  const bound = idsOf(webContents);
  for (const e of [null, undefined, {}, { sender: null }, { sender: undefined }]) {
    assert.equal(isAppWindowSender(e, bound), false, JSON.stringify(e));
  }
  const weird = { id: "1", mainFrame: {}, isDestroyed: () => false };
  assert.equal(isAppWindowSender(evt(weird, weird.mainFrame), new Set(["1"])), false,
    "a string id must not be admitted by a set that happens to hold the same string");
});


import { OPS, NO_BAD_PAYLOAD, OPERATOR_TURN_CAP, DEFAULT_TURN_CAP } from "./_ipc-ops-table.mjs";


test("every privileged op in the file is registered", () => {
  const { handlers } = bootIpc();
  for (const [name] of OPS) assert.equal(typeof handlers[name], "function", name);
});

test("every op REFUSES an unregistered sender, and does no work at all", async () => {
  for (const [name, payload, refusal] of OPS) {
    const ipc = bootIpc();
    assert.deepEqual(await ipc.handlers[name](ipc.foreign, payload), refusal, name);
    assert.deepEqual(ipc.writes, [], `${name} must not write`);
    assert.deepEqual(ipc.dialogs, [], `${name} must not pop a native dialog`);
    assert.deepEqual(ipc.reopens, [], `${name} must not open a session window`);
    assert.deepEqual(ipc.popouts, [], `${name} must not open a pop-out window`);
  }
});

test("every op REFUSES an iframe inside a registered window", async () => {
  for (const [name, payload, refusal] of OPS) {
    const ipc = bootIpc();
    assert.deepEqual(await ipc.handlers[name](ipc.iframe, payload), refusal, name);
    assert.deepEqual(ipc.writes, [], `${name} must not write for an iframe`);
    assert.deepEqual(ipc.dialogs, [], `${name} must not pop a dialog for an iframe`);
    assert.deepEqual(ipc.popouts, [], `${name} must not open a window for an iframe`);
  }
});

test("every op REFUSES when no registry accessor was supplied (an unbound surface)", async () => {
  // A mid-wave caller / a harness that forgets `getSenderIds` must get a DEAD surface,
  // not an open one — an unbound privileged handler is the bug, not a compatibility mode.
  const handlers = {};
  const stub = (id) => {
    if (id === "electron") return { ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    if (id === "./channel-prefs") return { getLaunchPosture: () => PRESET, setLaunchPosture: () => ({ ok: true }), launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }), getAutoSend: () => false, setAutoSend: () => true };
    // 2026-08-31 (port wave D) — the channel's RUNTIME pick and the adapter registry. They ride
    // the EXISTING posture pair rather than growing a fourth op (see `channel-dir-ipc.js`), so
    // there is no new row in the OPS table; what they need here is only to exist, because the
    // handler reads them on the SUCCESS path these cases must never reach.
    if (id === "./channel-runtime") return { getChannelRuntime: () => "", setChannelRuntime: () => "" };
    if (id === "./runtime") return { all: () => [], DEFAULT_ID: "claude" };
    // ⚠ `resolvedDirLabel` joined 2026-09-05 (task 15): the folder ops answer `{label, custom}`
    // now. Present only so the module loads — every call below is on an UNBOUND surface, so the
    // success path it backs is exactly what must never be reached.
    if (id === "./channel-dirs") return { liveChannelDirLabel: () => "x", resolvedDirLabel: () => "y", promptAndSetChannelDir: async () => {}, clearChannelDir: () => {} };
    if (id === "./session-engine") return { reopenByTask: () => ({ ok: true }) };
    if (id === "./deep-link-target") return { isSafeSegment: () => true };
    if (id === "./version-gate") return { isBlocked: () => false };
    if (id === "./popout-window") return { openThreadWindow: () => ({ ok: true }) };
    if (id === "./diag") return { diag: () => {} };
    // 2026-09-05 (the turn-cap pair): present only so the module loads — every call below is on
    // an UNBOUND surface, so the success path these back is exactly what must never be reached.
    if (id === "./settings") return { readTurnCapSetting: () => 7, setTurnCap: () => 7, normalizeTurnCapInput: () => undefined };
    if (id === "./session-state") return { OPERATOR_TURN_CAP, DEFAULT_TURN_CAP };
    if (id === "./ipc-guards") return guards;
    if (id === "./agent-id") return agentId;
    if (id === "./session-ipc-ops") return ops;
    throw new Error("unexpected require: " + id);
  };
  const guards = new Function(`${BLOCK}\n return { isAppWindowSender, isUuid, UUID_RE };`)();
  const agentId = { isAgentId: (v) => typeof v === "string" && /^[a-z][a-z0-9]{7}$/.test(v) };
  const ops = evalModule(OPS_SRC, stub);
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  mod.exports.register({}); // no getSenderIds — and the split half inherits the same absence
  const { webContents, mainFrame } = mkWin();
  for (const [name, payload, refusal] of OPS) {
    assert.deepEqual(await handlers[name](evt(webContents, mainFrame), payload), refusal, name);
  }
});

test("EVERY BOUND SENDER gets the real behaviour — the shell and the pop-out alike", async () => {
  // The enumeration, driven rather than remembered: whatever the registry holds must WORK,
  // or the widening bought a window that renders nothing (the failure Phase 10 exists to
  // prevent), and whatever it does not hold must not.
  for (const which of ["shell", "popout"]) {
    const ipc = bootIpc();
    const sender = ipc[which];
    // ⚠ A PAIR SINCE 2026-09-05 (task 15): the EFFECTIVE working directory, which is never
    // null, plus whether a per-channel dir is set. The single nullable label it replaced is
    // what made the Settings row print "Sandbox (default)" over a channel using ~/Downloads.
    // Both members are still abbreviations — the raw absolute path still never crosses.
    assert.deepEqual(await ipc.handlers["channels:getFolderLabel"](sender, CH),
      { label: "~/Downloads/effective-repo", custom: true }, which);
    // ⚠ REPOINTED FROM THE ARM'S OPS TO THE POSTURE'S (2026-08-20). This drove
    // `channels:get/setPermissionPreset` — the two most privileged ops in the file at the
    // time — precisely BECAUSE they were the worst case: a widening that admitted a window
    // but broke the write would be a Settings tab that renders and silently does nothing,
    // which is the failure Phase 10 exists to prevent. `setLaunchPosture` is the worst case
    // now, so it is the one driven positively here.
    // ⚠ THE READ CARRIES THREE MORE KEYS SINCE 2026-08-31 (the runtime-adapter port): the
    // channel's runtime pick, the frozen descriptor table the Settings picker renders, and the
    // default adapter's id. They ride this pair rather than a fourth op — `channel-dir-ipc.js`
    // carries why, and `renderer/app-preload.js` being at the §1 cap with no split seam is the
    // hard half of it. Asserted as the WHOLE reply rather than a subset, because what this case
    // is about is that a bound sender gets the real one.
    assert.deepEqual(await ipc.handlers["channels:getLaunchPosture"](sender, CH),
      { ...PRESET, runtime: "", runtimes: [], defaultRuntime: "claude" }, which);
    // ⚠ `applied` (2026-08-25) is the live fan-out's count — see test/channel-posture-live.test.mjs.
    // This harness binds no session engine, so a bound sender's write succeeds with nothing to
    // apply it to; what is being driven HERE is the sender binding, not the fan-out.
    assert.deepEqual(await ipc.handlers["channels:setLaunchPosture"](sender, { channelId: CH, preset: PRESET }), { ok: true, applied: 0, runtime: "" }, which);
    assert.deepEqual(ipc.writes, [{ channelId: CH, preset: PRESET }], `${which}: the legitimate write lands`);
    await ipc.handlers["channels:chooseFolder"](sender, CH);
    assert.equal(ipc.dialogs.length, 1, `${which}: the operator's own picker still opens`);
    assert.deepEqual(await ipc.handlers["sessions:reopen"](sender, { channelId: CH, taskId: "t1" }), { ok: true }, which);
    assert.deepEqual(await ipc.handlers["threads:openWindow"](sender, POPOUT_PAYLOAD), { ok: true }, which);
    assert.deepEqual(ipc.popouts, [POPOUT_PAYLOAD], `${which}: the pop-out target crosses whole`);
  }
});


test("a refusal is INDISTINGUISHABLE from a bad-payload rejection", async () => {
  // The refusal shape deliberately matches what a non-UUID id already returns, so a
  // hostile page cannot use the difference to probe which window it is running in.
  const ipc = bootIpc();
  for (const [name, payload, refusal, explicitBad] of OPS) {
    if (!NO_BAD_PAYLOAD.has(name)) {
      // ⚠ THE FOURTH SLOT IS THE OP'S OWN BAD PAYLOAD, for the ops that are not gated on a
      // `channelId`. Corrupting a key an op does not read would have driven a VALID payload
      // through this arm and asserted the refusal shape of a call that really succeeded.
      const badPayload = explicitBad !== undefined
        ? explicitBad
        : typeof payload === "string" ? "not-a-uuid" : { ...payload, channelId: "not-a-uuid" };
      assert.deepEqual(await ipc.handlers[name](ipc.shell, badPayload), refusal, `${name} bad payload`);
    }
    assert.deepEqual(await ipc.handlers[name](ipc.foreign, payload), refusal, `${name} bad sender`);
  }
  // ⚠ AND THE EXEMPTION IS NOT A HOLE: a BOUND sender really does get the real answer on both,
  // so the refusals above are the binding working rather than the ops being broken.
  assert.deepEqual(await ipc.handlers["orchestrator:getLaunchEnabled"](ipc.shell), { enabled: true });
  assert.deepEqual(await ipc.handlers["orchestrator:setLaunchEnabled"](ipc.shell, { enabled: true }),
    { ok: true, enabled: true });
  assert.deepEqual(ipc.writes, [{ orchestratorLaunch: true }], "the legitimate write lands");
  // ⚠ AND A FORGED `set` WROTE NOTHING. This is the assertion the toggle actually turns on: the
  // value is the standing consent for another agent to spawn sessions on this Mac, and the ONLY
  // writer is a bound app-window top frame (there is no route and no MCP op — §6).
  const clean = bootIpc();
  await clean.handlers["orchestrator:setLaunchEnabled"](clean.foreign, { enabled: true });
  assert.deepEqual(clean.writes, [], "an unbound sender cannot arm the launch lane");
});

// ── The turn cap's own gates (2026-09-05, task 9b) ───────────────────────────

test("an UNBOUND sender cannot move the turn cap — the brake has one writer", async () => {
  // ⚠ THE ASSERTION THE PAIR ACTUALLY EXISTS FOR, and a harder one than the toggles' because
  // `set(0)` REMOVES the loop-safety bound rather than arming a lane. `main/settings.js` is the
  // only writer of `sessionTurnCap` and this bridge is the only caller of it; a page that is not
  // a registered window's top frame must reach neither.
  {
    for (const forged of ["foreign", "iframe"]) {
      for (const payload of [{ cap: 0 }, { cap: 5000 }, { cap: null }]) {
        const ipc = bootIpc();
        assert.deepEqual(await ipc.handlers["settings:setTurnCap"](ipc[forged], payload), { ok: false });
        assert.deepEqual(ipc.writes, [], `${forged} ${JSON.stringify(payload)} reached the store`);
      }
      // …and the READ discloses nothing either: `cap: null` is what an unset machine answers,
      // so a rejected caller cannot tell this Mac's cap from a Mac that has never set one.
      const ipc = bootIpc();
      assert.deepEqual(await ipc.handlers["settings:getTurnCap"](ipc[forged]),
        { cap: null, operatorDefault: OPERATOR_TURN_CAP, agentDefault: DEFAULT_TURN_CAP });
    }
  }
});

test("a BOUND sender gets main's OWN value back, never an echo of the request", async () => {
  // ⚠ THE PROPERTY AN OPTIMISTIC CONTROL DEPENDS ON. Every answer carries the cap the store
  // really holds, so a rejected write puts the operator's box back to what is in force instead
  // of leaving a number on screen that nothing is enforcing.
  const ipc = bootIpc();
  assert.deepEqual(await ipc.handlers["settings:getTurnCap"](ipc.shell),
    { cap: 7, operatorDefault: OPERATOR_TURN_CAP, agentDefault: DEFAULT_TURN_CAP });

  assert.deepEqual(await ipc.handlers["settings:setTurnCap"](ipc.shell, { cap: 50 }),
    { ok: true, cap: 50, operatorDefault: OPERATOR_TURN_CAP, agentDefault: DEFAULT_TURN_CAP });
  // 0 is a REAL request and the machine really is unbounded afterwards — not a failed write.
  assert.deepEqual(await ipc.handlers["settings:setTurnCap"](ipc.shell, { cap: 0 }),
    { ok: true, cap: 0, operatorDefault: OPERATOR_TURN_CAP, agentDefault: DEFAULT_TURN_CAP });
  // …and `null` clears it, which is the only way back to the issuer-keyed defaults.
  assert.deepEqual(await ipc.handlers["settings:setTurnCap"](ipc.shell, { cap: null }),
    { ok: true, cap: null, operatorDefault: OPERATOR_TURN_CAP, agentDefault: DEFAULT_TURN_CAP });
});

test("junk answers ok:FALSE and leaves the cap where it was — it is not a silent unset", async () => {
  // ⚠ AN ABSENT `cap` IS THE ONE THAT MATTERS. A half-built caller sending `{}` must not clear
  // the operator's brake; only an EXPLICIT null does that, and the two are different requests.
  const ipc = bootIpc();
  await ipc.handlers["settings:setTurnCap"](ipc.shell, { cap: 30 });
  for (const payload of [{ cap: "x" }, { cap: -3 }, { cap: false }, { cap: {} }, {}, undefined]) {
    assert.deepEqual(await ipc.handlers["settings:setTurnCap"](ipc.shell, payload),
      { ok: false, reason: "store", cap: 30, operatorDefault: OPERATOR_TURN_CAP, agentDefault: DEFAULT_TURN_CAP },
      JSON.stringify(payload));
  }
});

// ── The pop-out op's own gates ───────────────────────────────────────────────

test("threads:openWindow character-checks the segment and the thread id, not just the channel", () => {
  // Both are interpolated into a router path. The channel is UUID-gated like every op
  // here; the other two go through the ONE character rule (deep-link-target ›
  // isSafeSegment), and a local regex in channel-dir-ipc.js would be a second answer to it.
  assert.match(OPS_SRC, /require\('\.\/deep-link-target'\)/, "the shared rule, required lazily");
  assert.match(OPS_SRC, /isSafeSegment\(p\.segment\)/);
  assert.match(OPS_SRC, /isSafeSegment\(p\.threadId\)/);
});

test("threads:openWindow refuses every unusable target in the SAME shape", async () => {
  const ipc = bootIpc();
  for (const bad of [
    undefined,
    {},
    { ...POPOUT_PAYLOAD, channelId: "not-a-uuid" },
    { ...POPOUT_PAYLOAD, segment: "../../etc" },
    { ...POPOUT_PAYLOAD, segment: "" },
    { ...POPOUT_PAYLOAD, threadId: "a/b" },
    { ...POPOUT_PAYLOAD, threadId: "%2e%2e" },
    { ...POPOUT_PAYLOAD, threadId: null },
  ]) {
    assert.deepEqual(await ipc.handlers["threads:openWindow"](ipc.shell, bad), { ok: false },
      JSON.stringify(bad));
  }
  assert.deepEqual(ipc.popouts, [], "nothing reached the window factory");
});

test("threads:openWindow refuses while the MIN-VERSION GATE is blocking", async () => {
  // `createShellWindow` is the gate's single enforcement point, so a second window factory
  // has to refuse on its own or the block stops being total. Same refusal shape.
  const ipc = bootIpc({ blocked: true });
  assert.deepEqual(await ipc.handlers["threads:openWindow"](ipc.shell, POPOUT_PAYLOAD), { ok: false });
  assert.deepEqual(ipc.popouts, [], "a blocked build must not mint a window");
});

// ── The wiring index.js is responsible for ───────────────────────────────────

test("index.js passes the LIVE registry, lazily (windows come and go)", () => {
  const INDEX = M("index.js");
  assert.match(INDEX, /channelDirIpc\.register\(\{[^}]*getSenderIds: \(\) => appWindows\.senderIds\(\)[^}]*\}\)/,
    "an accessor, not a snapshot: register() runs before any window exists, the shell is " +
      "rebuilt on reopen, and a pop-out can appear or close at any moment");
});

test("no handler in EITHER half skips the wrapper", () => {
  // Structural belt: every ipcMain.handle across BOTH files must go through appWindowOnly, so
  // a new op cannot be added unbound by simply forgetting to wrap it. ⚠ The wrap is written
  // literally at each registration site for exactly this reason — hiding it inside a
  // factory would pass review and silently disarm this check.
  // ⚠ READS THE CONCATENATION SINCE THE 2026-08-20 SPLIT (F-226). Counting one file would
  // have let the other half drift, which is precisely the cost a split must not have.
  const calls = BOTH.match(/ipcMain\.handle\(/g) || [];
  const wrapped = BOTH.match(/ipcMain\.handle\('[^']+', appWindowOnly\(/g) || [];
  assert.equal(calls.length, OPS.length, "the op count changed — update OPS above");
  assert.equal(wrapped.length, calls.length, "every registered handler is sender-bound");
  assert.equal(BOTH.match(/mainOnly\(/g), null,
    "`mainOnly(` is gone: the binding's subject is the app-window registry now, and a " +
      "surviving call site would be an op still bound to the main window alone");
});

test("the split did not fork the sender guard — both halves use the ONE shared predicate", () => {
  // ⚠ THE WHOLE POINT OF `main/ipc-guards.js`. Each half defines its own six-line
  // `appWindowOnly` wrapper (the structural belt above requires the wrap to be visible at
  // each site), but neither may define the PREDICATE — that is where the security content
  // lives and where the F-221 drift happened. A local `function isAppWindowSender` in either
  // file is a second answer to "who may call", which is the defect this extraction removed.
  for (const [name, src] of [["channel-dir-ipc.js", SRC], ["session-ipc-ops.js", OPS_SRC]]) {
    assert.match(src, /require\('\.\/ipc-guards'\)/, `${name} takes the shared guards`);
    assert.equal(/function isAppWindowSender\s*\(/.test(src), false,
      `${name} must not re-declare the predicate`);
    assert.equal(/UUID_RE\s*=\s*\//.test(src), false,
      `${name} must not re-declare the UUID rule`);
  }
});
