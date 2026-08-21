// THE SHARED PRESET VALIDATOR (main/channel-prefs.js) and the IPC handlers that expose
// the record it guards (main/channel-dir-ipc.js). The SENDER BINDING on those handlers
// (H3) is pinned separately in test/channel-ipc-sender.test.mjs.
//
// WHAT IT COSTS WHEN THIS IS WRONG. The pair stored here decides what a spawned agent
// may do on THIS machine. The app window hosts REMOTE content, so the renderer is a
// hostile input: if an unknown value were stored and some later reader coerced it in a
// permissive direction, a page could hand itself `bypass` without the operator ever
// seeing the word. So the rules pinned here are all fail-closed:
//
//   - only the eight frozen enum members are storable, on either axis;
//   - a rejected write mutates NOTHING (no half-applied posture);
//   - an absent or corrupt record resolves to the MOST RESTRICTIVE pair;
//   - a write to one channel is invisible to every other channel;
//   - the IPC gate rejects a non-UUID channelId before any of that runs.
//
// ── ⚠ THE ARM IS DELETED, AND THIS FILE WAS ITS SUITE (2026-08-20, Samuel's ruling) ──
//
// H2 (2026-07-31) made the permission pair an ARM rather than a setting, enforced three
// ways, and this file held two of the three:
//   1. SINGLE USE   — `takeArmFrom` returned the pair and deleted it in the same call;
//   2. EXPIRING     — an arm older than `ARM_TTL_MS` (30 min) was not consumable, a
//                     FUTURE stamp was refused, a caller-supplied `at` was dropped so
//                     nobody could mint an immortal one, a PRE-H2 record with no stamp
//                     read as already expired (an upgrade may only ever narrow), and
//                     `sweepExpired` dropped the dead ones without a pointless write;
//   3. ONE CONSUMER — pinned next door in `test/session-preset-start.test.mjs`.
// Roughly a dozen cases, plus the IPC round trip over `channels:get/setPermissionPreset`.
// ALL of that mechanism is gone: `PRESETS_KEY`, `ARM_TTL_MS`, `armIsLive`, `resolveArm`,
// `readArmFrom`, `armInto`, `takeArmFrom`, `sweepExpired`, `getPermissionPreset`,
// `armPermissionPreset`, `consumePermissionPreset`, `clearPermissionPreset`, and both IPC
// ops.
//
// ⚠ IT WENT BECAUSE ITS SURFACE HAD ALREADY GONE AND NOBODY NOTICED (F-233). The arm's web
// controls lived in `launch-panel.tsx`'s INBOUND branch, which stopped rendering at the
// 2026-08-18 consent-surface rewrite — the panel's one consumer is the outbound send box, so
// `kind === "inbound"` was never true in production. Every TTL case above was measuring the
// lifetime of a record no human could set. That is the argument for deleting them rather than
// repointing them: a TTL is a claim about how long a HUMAN DECISION stays good, and there was
// no decision.
//
// ⚠ WHAT SURVIVED, AND WHY IT IS KEPT HERE RATHER THAN FOLLOWING THE ARM OUT (INVARIANTS §14):
//   · THE VALIDATOR. `normalizePreset` / `defaultPreset` / the frozen enums were never the
//     arm's — the DURABLE launch posture is re-validated through exactly the same function,
//     and it is the whole fail-closed story for a hostile payload. Deleting this file would
//     have taken the only enumeration of the eight members with it.
//   · THE IPC SURFACE. The section below is REPOINTED, not removed: it asserted the UUID gate,
//     the rejected-write-stores-nothing rule and per-channel isolation THROUGH a handler, and
//     `channels:get/setLaunchPosture` are the surviving handlers with byte-identical gates. The
//     property outlived the op that carried it.
//
// ⚠ H2 ITSELF IS UNTOUCHED. A stored pair still only ever reaches a spawn by being HANDED IN
// per launch (`spec.startModes`) by a caller executing a decision a human is making now. What
// kept that closed was never the TTL — it was the CONSUMER COUNT, and
// `test/session-preset-start.test.mjs` is where that is pinned.
//
// Run: `node --test dopl-desktop-app/test/channel-prefs.test.mjs`
//
// WHY SOURCE EXTRACTION: channel-prefs.js pulls in electron-store, and channel-dir-ipc.js
// pulls in electron, so neither imports under `node --test`. The validation + map ops are
// fenced as a PURE block (no electron/fs/store refs) and sliced verbatim (see
// `_channel-prefs-block.mjs`); the IPC file is evaluated with a stub `require` that swaps ONLY
// electron and the store-backed module, so the real UUID gate and the real validator are the
// ones under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prefs, CH_A, CH_B } from "./_channel-prefs-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

// ⚠ THE SLICER LIVES IN `_channel-prefs-block.mjs` (2026-08-20) — same block, one copy, two
// suites. This one keeps the shared VALIDATOR and the IPC surface;
// `channel-launch-posture.test.mjs` takes the durable posture's own map ops.
const { TOOL_MODES, MESSAGE_MODES, DEFAULT_PRESET, normalizePreset, defaultPreset } = prefs;

const OK = { tools: "accept_edits", messages: "auto_inbound" };

// ── The frozen enums ─────────────────────────────────────────────────────────

test("the enums are exactly the desktop's real modes, in both axes", () => {
  assert.deepEqual(TOOL_MODES, ["manual", "accept_edits", "auto", "bypass"]);
  assert.deepEqual(MESSAGE_MODES, ["ask", "auto_inbound", "auto_outbound", "auto_both"]);
});

test("the default pair is the most restrictive one on both axes", () => {
  assert.deepEqual(DEFAULT_PRESET, { tools: "manual", messages: "ask" });
  assert.deepEqual(defaultPreset(), { tools: "manual", messages: "ask" });
});

test("defaultPreset never hands back the shared DEFAULT_PRESET object", () => {
  const out = defaultPreset();
  out.tools = "bypass";
  assert.equal(DEFAULT_PRESET.tools, "manual", "the default must not be mutable through a caller");
});

// ── normalizePreset: unknown values are REJECTED, never coerced ──────────────

test("every known pair validates and round-trips unchanged", () => {
  for (const tools of TOOL_MODES) {
    for (const messages of MESSAGE_MODES) {
      assert.deepEqual(normalizePreset({ tools, messages }), { tools, messages });
    }
  }
});

test("an unknown mode on EITHER axis rejects the whole pair", () => {
  const bad = [
    { tools: "root", messages: "ask" },
    { tools: "manual", messages: "auto_everything" },
    { tools: "BYPASS", messages: "ask" }, // case-sensitive on purpose
    { tools: "manual ", messages: "ask" }, // no trimming: an exact member or nothing
    { tools: "bypass", messages: "" },
  ];
  for (const raw of bad) {
    assert.equal(normalizePreset(raw), null, `must reject ${JSON.stringify(raw)}`);
  }
});

test("a half-stated pair is rejected whole (never partially applied)", () => {
  assert.equal(normalizePreset({ tools: "bypass" }), null);
  assert.equal(normalizePreset({ messages: "auto_both" }), null);
});

test("non-object / hostile shapes reject without throwing", () => {
  for (const raw of [null, undefined, "", 0, false, "bypass", [], ["bypass"], () => {}]) {
    assert.equal(normalizePreset(raw), null, `must reject ${JSON.stringify(raw)}`);
  }
});

test("a valid pair carrying extra properties stores ONLY the two axes", () => {
  const out = normalizePreset({
    tools: "auto",
    messages: "auto_both",
    cwd: "/etc",
    __proto__: { evil: true },
  });
  assert.deepEqual(Object.keys(out).sort(), ["messages", "tools"]);
});

test("an `at` is DROPPED — the validator stores two axes and nothing else", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20; INVARIANTS §14). This read "H2: a caller-supplied
  // `at` is DROPPED, so nobody can mint an immortal arm", and its second half drove `armInto`
  // to prove the stamp was OURS rather than the caller's. There is no stamp and no arm.
  //
  // The FIRST half is kept because it is a validator property, not an arm property: the
  // whitelist is positive (two axes, both known) rather than a blacklist of keys to strip, so
  // an unexpected field cannot ride into the store on a valid pair. That is what stops the
  // next record with a bookkeeping field from being forgeable by a renderer, which is exactly
  // the shape `at` had.
  assert.deepEqual(normalizePreset({ ...OK, at: Number.MAX_SAFE_INTEGER }), OK);
  assert.deepEqual(normalizePreset({ ...OK, ttl: 0, __proto__: { at: 1 } }), OK);
});

test("a non-string mode (number / object) never passes as a member", () => {
  assert.equal(normalizePreset({ tools: 0, messages: "ask" }), null);
  assert.equal(normalizePreset({ tools: "manual", messages: { toString: () => "ask" } }), null);
});

// ── ⚠ THE ARM'S LIFETIME CASES STOOD HERE AND ARE DELETED ────────────────────
//
// Eight cases, in two groups, and both groups died with their mechanism:
//   · LIFETIME — `armIsLive` inside/outside `ARM_TTL_MS` to the tick; a PRE-H2 record with no
//     stamp reading as EXPIRED so an upgrade could only narrow; a FUTURE stamp refused so clock
//     skew or a tampered store bought no extra time; `resolveArm` returning the two axes verbatim
//     with no bookkeeping attached.
//   · SINGLE USE + SWEEP — `takeArmFrom` returning AND removing in one call; a second launch
//     finding nothing; a later peer reply days on getting manual/ask (the whole H2 failure, in
//     one case); an EXPIRED arm yielding null and still being swept on the way past; taking one
//     channel's arm leaving every other alone; `sweepExpired` reporting whether it changed
//     anything so a read path never writes for nothing.
//
// There is no `at`, no TTL, no consume and no sweep in `channel-prefs.js`. The per-channel
// ISOLATION half of those cases is not orphaned — it is asserted against the surviving record in
// `channel-launch-posture.test.mjs` and through the IPC surface below.

// ── The IPC surface: the real gate + the real validator, store swapped out ──
//
// ⚠ REPOINTED FROM THE ARM'S OPS TO THE DURABLE POSTURE'S (2026-08-20; INVARIANTS §14). This
// section used to drive `channels:getPermissionPreset` / `channels:setPermissionPreset`, which
// are deleted. It is NOT deleted with them: what it asserts is the UUID gate, the
// rejected-write-stores-nothing rule and per-channel isolation AS SEEN THROUGH A HANDLER, and
// `channels:get/setLaunchPosture` carry byte-identical gates over the same validator. Dropping
// the section would have removed the only end-to-end proof that a non-UUID id is refused BEFORE
// the store is touched — a property of the handler, which no amount of pure-block testing reaches.

// channel-dir-ipc.js evaluated with a stub `require`. ONLY electron and the store-backed
// channel-prefs module are swapped; the UUID gate and the validation under test are the
// ones that ship. H3: the handlers are sender-bound, so the harness supplies the window it
// binds to and an event whose sender IS that window's top frame.
function bootIpc() {
  const handlers = {};
  const map = {};
  const prefsStub = {
    // The two ops this section drives, backed by the REAL sliced map ops.
    getLaunchPosture: (channelId) => prefs.readPostureFrom(map, channelId) || prefs.defaultPreset(),
    setLaunchPosture: (channelId, raw) => {
      const res = prefs.postureInto(map, channelId, raw);
      return res.ok ? { ok: true } : { ok: false };
    },
    // Required by registration paths this section does not drive; stubbed so a typo in one
    // surfaces here rather than as a mystery throw.
    launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }),
    getAutoSend: () => false,
    setAutoSend: () => ({ ok: false }),
  };
  const stubRequire = (id) => {
    if (id === "electron") {
      return { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } } };
    }
    if (id === "./channel-prefs") return prefsStub;
    if (id === "./channel-dirs") {
      return {
        liveChannelDirLabel: () => null,
        promptAndSetChannelDir: async () => ({ cancelled: true }),
        clearChannelDir: () => {},
      };
    }
    // Lazily required by ops this file does not drive, but stubbed so a typo in a
    // registration path surfaces here rather than as a mystery throw.
    if (id === "./session-engine") return { reopenByTask: () => ({ ok: true }) };
    if (id === "./deep-link-target") return { isSafeSegment: () => true };
    if (id === "./version-gate") return { isBlocked: () => false };
    if (id === "./popout-window") return { openThreadWindow: () => ({ ok: true }) };
    if (id === "./diag") return { diag: () => {} };
    // ⚠ THE REAL GUARDS (2026-08-20). `isUuid` is the anti-probe gate the cases below drive
    // directly, and `isAppWindowSender` is the binding this harness supplies a window for —
    // faking either would make this section green over a surface that admits anybody.
    if (id === "./ipc-guards") return guards;
    // ⚠ THE SPLIT HALF (2026-08-20, F-226). `channel-dir-ipc.js` registers it, so it must
    // resolve; this section drives none of its ops, and it is built with the SAME stub so a
    // typo in one of its registration paths still surfaces here.
    if (id === "./session-ipc-ops") return ops;
    throw new Error("unexpected require: " + id);
  };
  // The REAL guard block, sliced (the module is electron-free, so this is a plain evaluate).
  const guards = (() => {
    const g = M("ipc-guards.js");
    const block = g.slice(g.indexOf("// ─── BEGIN IPC-GUARDS"), g.indexOf("// ─── END IPC-GUARDS"));
    return new Function(`${block}\n return { isAppWindowSender, isUuid, UUID_RE };`)();
  })();
  const ops = (() => {
    const m = { exports: {} };
    new Function("require", "module", "exports", M("session-ipc-ops.js"))(stubRequire, m, m.exports);
    return m.exports;
  })();
  const mod = { exports: {} };
  new Function("require", "module", "exports", M("channel-dir-ipc.js"))(
    stubRequire,
    mod,
    mod.exports
  );
  const mainFrame = { name: "top" };
  const webContents = { id: 1, mainFrame, isDestroyed: () => false };
  // ⚠ THE BINDING'S SUBJECT WIDENED 2026-08-18 (wiring plan Phase 10): handlers are bound
  // to the set of `webContents` ids main registered at window creation, not to one window.
  mod.exports.register({ getSenderIds: () => new Set([webContents.id]) });
  const event = { sender: webContents, senderFrame: mainFrame };
  return { handlers, map, event };
}

test("the IPC surface registers exactly the two posture ops", () => {
  const { handlers } = bootIpc();
  assert.equal(typeof handlers["channels:getLaunchPosture"], "function");
  assert.equal(typeof handlers["channels:setLaunchPosture"], "function");
  // ⚠ AND THE ARM'S TWO ARE GONE FROM THE WIRE, not merely unused. A surviving registration
  // would be a privileged op with no storage behind it — worse than either half alone.
  assert.equal(handlers["channels:getPermissionPreset"], undefined);
  assert.equal(handlers["channels:setPermissionPreset"], undefined);
});

test("round trip: set then get returns the stored pair", async () => {
  const { handlers, event } = bootIpc();
  const set = await handlers["channels:setLaunchPosture"](event, { channelId: CH_A, preset: OK });
  assert.deepEqual(set, { ok: true });
  assert.deepEqual(await handlers["channels:getLaunchPosture"](event, CH_A), OK);
});

test("get before any set is the restrictive default, never a neighbour's pair", async () => {
  // ⚠ THE ONE ASSERTION THAT CHANGED VALUE IN THE REPOINT, and it is deliberate. The arm's
  // getter answered `null` — an arm that is absent was NOT chosen, and the card must not claim
  // it was. A DURABLE setting that is absent IS manual/ask, and saying so is the truth (the
  // Settings tab would render nothing for a null). Same fail-closed direction, stated as the
  // pair rather than as an absence.
  const { handlers, event } = bootIpc();
  assert.deepEqual(await handlers["channels:getLaunchPosture"](event, CH_A), DEFAULT_PRESET);
});

test("the round trip is per channel: setting A leaves B at the default", async () => {
  const { handlers, event } = bootIpc();
  await handlers["channels:setLaunchPosture"](event, { channelId: CH_A, preset: OK });
  assert.deepEqual(await handlers["channels:getLaunchPosture"](event, CH_B), DEFAULT_PRESET);
});

test("an unknown mode over IPC is rejected and stores nothing", async () => {
  const { handlers, map, event } = bootIpc();
  const bad = [
    { tools: "root", messages: "ask" },
    { tools: "manual", messages: "auto_everything" },
    { tools: "bypass" },
    "bypass",
    null,
  ];
  for (const preset of bad) {
    assert.deepEqual(
      await handlers["channels:setLaunchPosture"](event, { channelId: CH_A, preset }),
      { ok: false },
      `must reject ${JSON.stringify(preset)}`
    );
  }
  assert.deepEqual(map, {}, "no rejected write may reach the store");
});

test("a non-UUID channelId is rejected before the store is touched", async () => {
  const { handlers, map, event } = bootIpc();
  const ids = ["", "../../etc", "channelDirs", CH_A + "x", 42, null, undefined, {}];
  for (const id of ids) {
    assert.deepEqual(
      await handlers["channels:setLaunchPosture"](event, { channelId: id, preset: OK }),
      { ok: false },
      `set must reject id ${JSON.stringify(id)}`
    );
    assert.equal(
      await handlers["channels:getLaunchPosture"](event, id),
      null,
      `get must reject id ${JSON.stringify(id)}`
    );
  }
  assert.deepEqual(map, {}, "a probe with a non-UUID id must never write");
});

test("a missing payload never throws (the page controls the argument)", async () => {
  const { handlers, event } = bootIpc();
  assert.deepEqual(await handlers["channels:setLaunchPosture"](event, undefined), { ok: false });
});
