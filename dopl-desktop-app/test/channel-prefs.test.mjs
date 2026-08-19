// Tests for the per-channel PERMISSION ARM (main/channel-prefs.js) and the two IPC
// handlers that expose it (main/channel-dir-ipc.js). The SENDER BINDING on those
// handlers (H3) is pinned separately in test/channel-ipc-sender.test.mjs.
//
// WHAT IT COSTS WHEN THIS IS WRONG. The pair stored here decides what a spawned agent
// may do on THIS machine. The main window hosts REMOTE content, so the renderer is a
// hostile input: if an unknown value were stored and some later reader coerced it in a
// permissive direction, a page could hand itself `bypass` without the operator ever
// seeing the word. So the rules pinned here are all fail-closed:
//
//   - only the eight frozen enum members are storable, on either axis;
//   - a rejected write mutates NOTHING (no half-applied posture);
//   - an absent, expired or corrupt record resolves to the MOST RESTRICTIVE pair;
//   - a write to one channel is invisible to every other channel;
//   - the IPC gate rejects a non-UUID channelId before any of that runs.
//
// H2 (2026-07-31) — AND THE THREE THAT MAKE IT AN ARM RATHER THAN A SETTING. It used to
// be a durable, channel-wide, permanent preference that session-engine.startSession read
// on EVERY spawn shape, so one consent card's bypass/auto_both silently re-armed the
// channel forever: a peer replying to any thread days later recreated a parked shell that
// started wide open, auto-accepted the inbound, and woke the agent with no card and no
// click. The invariant now is that a stored pair may only ever apply to a launch a human
// is actively approving in that moment, enforced three ways:
//   1. SINGLE USE   — consume returns the pair and deletes it in the same call;
//   2. EXPIRING     — an arm older than ARM_TTL_MS is not consumable, and is swept;
//   3. ONE CONSUMER — only the consent-approved launch consumes it (pinned in
//                     test/session-preset-start.test.mjs).
//
// Run: `node --test dopl-desktop-app/test/channel-prefs.test.mjs`
//
// WHY SOURCE EXTRACTION: channel-prefs.js pulls in electron-store, and channel-dir-ipc.js
// pulls in electron, so neither imports under `node --test`. The validation + map ops are
// fenced as a PURE block (no electron/fs/store refs) and sliced verbatim here; the IPC
// file is evaluated with a stub `require` that swaps ONLY electron and the store-backed
// module, so the real UUID gate and the real validator are the ones under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("channel-prefs.js");

const BEGIN = "// ─── BEGIN CHANNEL-PREFS-VALIDATE";
const END = "// ─── END CHANNEL-PREFS-VALIDATE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN CHANNEL-PREFS-VALIDATE sentinel missing");
assert.notEqual(to, -1, "END CHANNEL-PREFS-VALIDATE sentinel missing");
assert.ok(to > from, "channel-prefs sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The sliced block must stay electron/fs/store-free (§H-7). Scan CODE only
// (strip // comments — they legitimately say "electron-free").
const CODE = BLOCK.split("\n")
  .map((l) => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  })
  .join("\n");
for (const banned of ["require(", "electron", "store.", "fs.", "os.", "process."]) {
  assert.ok(!CODE.includes(banned), `CHANNEL-PREFS-VALIDATE block must not reference ${banned}`);
}

const {
  TOOL_MODES,
  MESSAGE_MODES,
  DEFAULT_PRESET,
  ARM_TTL_MS,
  normalizePreset,
  armIsLive,
  resolveArm,
  defaultPreset,
  readArmFrom,
  armInto,
  takeArmFrom,
  sweepExpired,
} = new Function(
  `${BLOCK}\n return { TOOL_MODES, MESSAGE_MODES, DEFAULT_PRESET, ARM_TTL_MS, normalizePreset,
     armIsLive, resolveArm, defaultPreset, readArmFrom, armInto, takeArmFrom, sweepExpired };`
)();

const CH_A = "44444444-4444-4444-8444-444444444444";
const CH_B = "55555555-5555-4555-8555-555555555555";
const OK = { tools: "accept_edits", messages: "auto_inbound" };
const NOW = 1_700_000_000_000;

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

test("H2: a caller-supplied `at` is DROPPED, so nobody can mint an immortal arm", () => {
  // normalizePreset keeps only the two axes, and armInto stamps `at` itself. A renderer
  // that sent at: Infinity (or a far-future value) must not get an arm that never expires.
  assert.deepEqual(normalizePreset({ ...OK, at: Number.MAX_SAFE_INTEGER }), OK);
  const map = {};
  armInto(map, CH_A, { ...OK, at: Number.MAX_SAFE_INTEGER }, NOW);
  assert.equal(map[CH_A].at, NOW, "the stamp is ours, never the caller's");
});

test("a non-string mode (number / object) never passes as a member", () => {
  assert.equal(normalizePreset({ tools: 0, messages: "ask" }), null);
  assert.equal(normalizePreset({ tools: "manual", messages: { toString: () => "ask" } }), null);
});

// ── H2: the arm's LIFETIME ───────────────────────────────────────────────────

test("H2: an arm is live inside the TTL and dead outside it", () => {
  const armed = { ...OK, at: NOW };
  assert.equal(armIsLive(armed, NOW), true, "the moment it is written");
  assert.equal(armIsLive(armed, NOW + ARM_TTL_MS - 1), true, "one tick before expiry");
  assert.equal(armIsLive(armed, NOW + ARM_TTL_MS), false, "exactly at the TTL it is gone");
  assert.equal(armIsLive(armed, NOW + ARM_TTL_MS * 10), false, "and long after");
});

test("H2: a PRE-H2 record (a durable preset with no stamp) is treated as EXPIRED", () => {
  // The old build stored { tools, messages } with no `at` and applied it forever. On
  // upgrade those records must go COLD, or the very posture this fix exists to stop would
  // survive the fix. An upgrade may only ever narrow.
  assert.equal(armIsLive({ ...OK }, NOW), false);
  assert.equal(resolveArm({ ...OK }, NOW), null);
  assert.equal(readArmFrom({ [CH_A]: { ...OK } }, CH_A, NOW), null);
});

test("H2: a FUTURE stamp is refused, not granted an unbounded life", () => {
  // Clock skew or a tampered store must not buy an arm extra time.
  assert.equal(armIsLive({ ...OK, at: NOW + 1 }, NOW), false);
  for (const at of [Infinity, NaN, "later", null, {}]) {
    assert.equal(armIsLive({ ...OK, at }, NOW), false, `at=${String(at)}`);
  }
});

test("resolveArm falls back to null for anything unstorable", () => {
  for (const raw of [null, undefined, {}, { tools: "bypass" }, { tools: "x", messages: "y" }]) {
    assert.equal(resolveArm(raw, NOW), null);
  }
});

test("resolveArm returns a LIVE stored pair verbatim, with no bookkeeping attached", () => {
  assert.deepEqual(resolveArm({ ...OK, at: NOW }, NOW), OK, "the two axes only, never `at`");
});

// ── Map ops: per-channel isolation + fail-closed writes ─────────────────────

test("a read for a channel with no record is null, not a neighbour's posture", () => {
  const map = {};
  armInto(map, CH_A, OK, NOW);
  assert.deepEqual(readArmFrom(map, CH_A, NOW), OK);
  assert.equal(readArmFrom(map, CH_B, NOW), null, "channel B must not see channel A's arm");
});

test("two channels hold independent arms", () => {
  const map = {};
  armInto(map, CH_A, { tools: "bypass", messages: "auto_both" }, NOW);
  armInto(map, CH_B, { tools: "manual", messages: "ask" }, NOW);
  assert.deepEqual(readArmFrom(map, CH_A, NOW), { tools: "bypass", messages: "auto_both" });
  assert.deepEqual(readArmFrom(map, CH_B, NOW), { tools: "manual", messages: "ask" });
});

test("a rejected write mutates NOTHING", () => {
  const map = {};
  armInto(map, CH_A, OK, NOW);
  const before = JSON.stringify(map);
  for (const raw of [{ tools: "root", messages: "ask" }, null, { tools: "auto" }]) {
    assert.deepEqual(armInto(map, CH_A, raw, NOW), { ok: false });
  }
  assert.equal(JSON.stringify(map), before, "a rejected write must leave the map byte-identical");
});

test("a write with no channel id is rejected and stores nothing", () => {
  const map = {};
  assert.deepEqual(armInto(map, "", OK, NOW), { ok: false });
  assert.deepEqual(map, {});
});

test("a corrupt stored record reads as null (the caller then defaults)", () => {
  const map = { [CH_A]: { tools: "bypass", at: NOW }, [CH_B]: "auto_both" };
  assert.equal(readArmFrom(map, CH_A, NOW), null);
  assert.equal(readArmFrom(map, CH_B, NOW), null);
});

// ── H2: SINGLE USE ───────────────────────────────────────────────────────────

test("H2 SINGLE USE: taking an arm returns it AND removes it", () => {
  const map = {};
  armInto(map, CH_A, OK, NOW);
  assert.deepEqual(takeArmFrom(map, CH_A, NOW), OK, "the approving launch gets the posture");
  assert.equal(Object.prototype.hasOwnProperty.call(map, CH_A), false, "and it is gone");
  assert.equal(takeArmFrom(map, CH_A, NOW), null, "a SECOND launch finds nothing");
});

test("H2 SINGLE USE: this is the whole fix — a later peer reply gets manual/ask", () => {
  // The exact failure: one consent card sets bypass/auto_both, and days later a peer reply
  // recreates a shell on the same channel. That second launch must find NOTHING.
  const map = {};
  armInto(map, CH_A, { tools: "bypass", messages: "auto_both" }, NOW);
  takeArmFrom(map, CH_A, NOW); // the approved launch
  const laterReply = takeArmFrom(map, CH_A, NOW + 5 * 24 * 60 * 60 * 1000);
  assert.equal(laterReply, null, "no stored posture survives to a launch nobody approved");
});

test("H2 SINGLE USE: an EXPIRED arm yields null and is still removed", () => {
  const map = {};
  armInto(map, CH_A, OK, NOW);
  assert.equal(takeArmFrom(map, CH_A, NOW + ARM_TTL_MS), null, "too late to be consumed");
  assert.equal(Object.prototype.hasOwnProperty.call(map, CH_A), false, "and swept on the way past");
});

test("H2 SINGLE USE: taking one channel's arm leaves every other channel alone", () => {
  const map = {};
  armInto(map, CH_A, OK, NOW);
  armInto(map, CH_B, { tools: "bypass", messages: "auto_both" }, NOW);
  takeArmFrom(map, CH_A, NOW);
  assert.deepEqual(readArmFrom(map, CH_B, NOW), { tools: "bypass", messages: "auto_both" });
});

test("H2: the sweep drops expired records and reports whether anything changed", () => {
  const map = {
    [CH_A]: { ...OK, at: NOW },
    [CH_B]: { ...OK, at: NOW - ARM_TTL_MS - 1 },
    stale: { ...OK }, // a pre-H2 record with no stamp
    junk: "nope",
  };
  assert.equal(sweepExpired(map, NOW), true, "it changed something");
  assert.deepEqual(Object.keys(map), [CH_A], "only the live arm survives");
  assert.equal(sweepExpired(map, NOW), false, "a clean map reports no change, so nothing is written");
});

// ── The IPC surface: the real gate + the real validator, store swapped out ──

// channel-dir-ipc.js evaluated with a stub `require`. ONLY electron and the store-backed
// channel-prefs module are swapped; the UUID gate and the validation under test are the
// ones that ship. H3: the handlers are sender-bound now, so the harness supplies the
// window it binds to and an event whose sender IS that window's top frame.
function bootIpc() {
  const handlers = {};
  const map = {};
  const prefs = {
    getPermissionPreset: (channelId) => readArmFrom(map, channelId, NOW),
    armPermissionPreset: (channelId, raw) => {
      const res = armInto(map, channelId, raw, NOW);
      return res.ok ? { ok: true } : { ok: false };
    },
    clearPermissionPreset: () => {},
  };
  const stubRequire = (id) => {
    if (id === "electron") {
      return { ipcMain: { handle: (name, fn) => { handlers[name] = fn; } } };
    }
    if (id === "./channel-prefs") return prefs;
    if (id === "./channel-dirs") {
      return {
        liveChannelDirLabel: () => null,
        promptAndSetChannelDir: async () => ({ cancelled: true }),
        clearChannelDir: () => {},
      };
    }
    // Lazily required by ops this file does not drive, but stubbed so a typo in a
    // registration path surfaces here rather than as a mystery throw.
    if (id === "./deep-link-target") return { isSafeSegment: () => true };
    if (id === "./version-gate") return { isBlocked: () => false };
    if (id === "./popout-window") return { openThreadWindow: () => ({ ok: true }) };
    if (id === "./diag") return { diag: () => {} };
    throw new Error("unexpected require: " + id);
  };
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

test("the IPC surface registers exactly the two preset ops", () => {
  const { handlers } = bootIpc();
  assert.equal(typeof handlers["channels:getPermissionPreset"], "function");
  assert.equal(typeof handlers["channels:setPermissionPreset"], "function");
});

test("round trip: arm then get returns the stored pair", async () => {
  const { handlers, event } = bootIpc();
  const set = await handlers["channels:setPermissionPreset"](event, { channelId: CH_A, preset: OK });
  assert.deepEqual(set, { ok: true });
  assert.deepEqual(await handlers["channels:getPermissionPreset"](event, CH_A), OK);
});

test("get before any arm is null (the card shows the defaults itself)", async () => {
  const { handlers, event } = bootIpc();
  assert.equal(await handlers["channels:getPermissionPreset"](event, CH_A), null);
});

test("the round trip is per channel: arming A leaves B unset", async () => {
  const { handlers, event } = bootIpc();
  await handlers["channels:setPermissionPreset"](event, { channelId: CH_A, preset: OK });
  assert.equal(await handlers["channels:getPermissionPreset"](event, CH_B), null);
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
      await handlers["channels:setPermissionPreset"](event, { channelId: CH_A, preset }),
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
      await handlers["channels:setPermissionPreset"](event, { channelId: id, preset: OK }),
      { ok: false },
      `set must reject id ${JSON.stringify(id)}`
    );
    assert.equal(
      await handlers["channels:getPermissionPreset"](event, id),
      null,
      `get must reject id ${JSON.stringify(id)}`
    );
  }
  assert.deepEqual(map, {}, "a probe with a non-UUID id must never write");
});

test("a missing payload never throws (the page controls the argument)", async () => {
  const { handlers, event } = bootIpc();
  assert.deepEqual(await handlers["channels:setPermissionPreset"](event, undefined), { ok: false });
});
