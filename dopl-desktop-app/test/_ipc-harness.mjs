// SHARED HARNESS for the two IPC-boundary suites (`channel-dir-ipc.js` + `session-ipc-ops.js`).
//
// WHY IT IS ITS OWN FILE. `channel-ipc-sender.test.mjs` crossed the 500-line cap when the
// 2026-08-20 split (F-226) made it read TWO sources instead of one, and the alternative — a
// second copy of the boot machinery in a second file — is how two suites drift into testing
// two different programs. Same seam and same precedent as `_classify-harness.mjs` /
// `_session-summary-harness.mjs`: the extraction machinery is shared, the cases are split by
// what they are about.
//
// ⚠ THE REAL GUARDS ARE THE ONES UNDER TEST. `main/ipc-guards.js` is sliced and evaluated,
// never faked: `isAppWindowSender` IS the subject of the binding suite, and `isUuid` is the
// anti-probe gate every op leans on. Only electron and the store/window-backed modules are
// swapped. Both halves are built with the SAME stub, so they register into ONE `handlers`
// map and every case drives both.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
// `main/agent-id.js` is pure (crypto only), so the boundary suites drive the REAL charset
// predicate rather than a fake that would accept ids main refuses.
const realAgentId = req(join(HERE, "..", "main", "agent-id.js"));
export const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
export const SRC = M("channel-dir-ipc.js");
export const OPS_SRC = M("session-ipc-ops.js");
// ⚠ THE LAUNCH BODY IS REAL, NOT A STUB (2026-08-22). `sessions:launch` delegates to
// `main/session-launch-op.js` since the §1 split, and a FAKE there would make the boundary
// suites assert a refusal shape the shipped code no longer produces — which is exactly the
// drift a split must not cost. It is evaluated against this file's OWN stub require, so its
// lazy handles (engine, prefs, targeting, listener, model, template-resolve) are the
// harness's; a payload that is refused at the boundary never reaches one.
export const LAUNCH_OP_SRC = M("session-launch-op.js");
// ⚠ THE DELETE BODY IS REAL FOR THE SAME REASON (2026-08-25). `sessions:delete` validates its
// payload inside `main/session-delete-op.js` — the split moved the code, not the boundary — so a
// stub here would make the "a refusal is INDISTINGUISHABLE from a bad-payload rejection" arm
// assert a shape the shipped code does not produce. Its module-scope requires are the guards,
// the id predicate and `diag`; everything destructive is required LAZILY, after both gates, so a
// payload refused at the boundary never reaches a store.
export const DELETE_OP_SRC = M("session-delete-op.js");
// ⚠ BOTH SOURCES, BECAUSE THE FILE SPLIT AND THE BINDING DID NOT (2026-08-20, F-226). Every
// structural assertion reads the CONCATENATION: an op that dodges the wrapper fails the belt
// whichever half it was added to, which is the property the split must not cost.
export const BOTH = `${SRC}\n${OPS_SRC}`;

// ⚠ SLICED FROM `main/ipc-guards.js` SINCE 2026-08-20 — it used to be one of TWO
// byte-identical copies (the other in `ui-bridge.js`, driven by its own suite), which is the
// F-221 drift. One source now; both suites still drive it.
const GUARDS = M("ipc-guards.js");
const from = GUARDS.indexOf("// ─── BEGIN IPC-GUARDS");
const to = GUARDS.indexOf("// ─── END IPC-GUARDS");
assert.notEqual(from, -1, "BEGIN IPC-GUARDS sentinel missing");
assert.ok(to > from, "IPC-GUARDS sentinels out of order");
export const BLOCK = GUARDS.slice(from, to);

export const { isAppWindowSender } = new Function(`${BLOCK}\n return { isAppWindowSender };`)();

/** Evaluate a main-process module against a stub `require`, and hand back its exports. */
export function evalModule(src, stubRequire) {
  const m = { exports: {} };
  new Function("require", "module", "exports", src)(stubRequire, m, m.exports);
  return m.exports;
}

let nextWcId = 1;
export const mkWin = () => {
  const mainFrame = { name: "top" };
  const webContents = { id: nextWcId++, mainFrame, isDestroyed: () => false };
  return { win: { isDestroyed: () => false, webContents }, webContents, mainFrame };
};
export const evt = (sender, senderFrame) => ({ sender, senderFrame });
/** The registry's answer: the live set of bound webContents ids. */
export const idsOf = (...wcs) => new Set(wcs.map((wc) => wc.id));

// ── The wiring: every handler is wrapped, and refuses an unbound sender ──────

// The real file, evaluated with a stub `require` so the real guard + the real UUID gate
// are the ones under test; only electron and the store/window-backed modules are swapped.
export function bootIpc({ blocked = false } = {}) {
  const handlers = {};
  const writes = [];
  const dialogs = [];
  const reopens = [];
  const popouts = [];
  const approvals = [];
  const stubRequire = (id) => {
    if (id === "electron") return { ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    if (id === "./channel-prefs") {
      // ⚠ THE ARM'S THREE ENTRIES ARE GONE (2026-08-20): `getPermissionPreset`,
      // `armPermissionPreset`, `clearPermissionPreset`. What remains is the DURABLE posture
      // plus auto-send. EVERY WRITER RECORDS INTO ONE `writes` LEDGER on purpose — the refusal
      // cases below assert `writes` is empty, so a second ledger would let one op's forged
      // write pass unseen while the other's was checked.
      return {
        getLaunchPosture: () => ({ tools: "bypass", messages: "auto_both" }),
        setLaunchPosture: (channelId, preset) => { writes.push({ channelId, preset }); return { ok: true }; },
        launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }),
        getAutoSend: () => false,
        setAutoSend: (channelId, on) => { writes.push({ channelId, on }); return true; },
        // ⚠ 2026-08-22, the ORCHESTRATOR LAUNCH TOGGLE. The getter answers TRUE deliberately:
        // the refusal cases assert a rejected sender reads `{enabled:false}`, and a fake that
        // answered false would pass those whether the binding worked or not. `set` records into
        // the SAME `writes` ledger as every other writer here, for the reason stated above.
        getOrchestratorLaunch: () => true,
        setOrchestratorLaunch: (on) => { writes.push({ orchestratorLaunch: on }); return on === true; },
      };
    }
    // 2026-08-31 (port wave D) — the channel's RUNTIME pick and the adapter registry. They ride
    // the EXISTING posture pair rather than growing a fourth op (see `channel-dir-ipc.js`), so
    // there is no new row in the OPS table; what they need here is only to exist, because the
    // handler reads them on the SUCCESS path these cases must never reach.
    if (id === "./channel-runtime") return { getChannelRuntime: () => "", setChannelRuntime: () => "" };
    if (id === "./runtime") return { all: () => [], DEFAULT_ID: "claude" };
    if (id === "./channel-dirs") {
      return {
        liveChannelDirLabel: () => "~/Downloads/secret-repo",
        promptAndSetChannelDir: async () => { dialogs.push(1); },
        clearChannelDir: () => { writes.push({ cleared: true }); },
      };
    }
    if (id === "./session-engine") {
      return { reopenByTask: (a) => { reopens.push(a); return { ok: true }; } };
    }
    // The REAL character rule — a second regex in channel-dir-ipc.js would be a second
    // answer to it, so the test drives the real one rather than a permissive fake.
    if (id === "./deep-link-target") {
      return { isSafeSegment: (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v) };
    }
    if (id === "./version-gate") return { isBlocked: () => blocked };
    if (id === "./popout-window") {
      return { openThreadWindow: (t) => { popouts.push(t); return { ok: true }; } };
    }
    if (id === "./diag") return { diag: () => {} };
    // ⚠ THE REAL GUARDS, NOT A FAKE — `isAppWindowSender` IS what is under test, and `isUuid`
    // is the anti-probe gate every op leans on. The split half is built with this SAME stub,
    // so both register into one `handlers` map and both are driven by every case below.
    if (id === "./ipc-guards") return realGuards;
    // The REAL id predicate, for the reason stated where `realAgentId` is loaded: a
    // permissive fake would accept ids `session-launch-op.js` refuses.
    if (id === "./agent-id") return realAgentId;
    // ⚠ THE REAL ID PREDICATE, on `ipc-guards`' terms. `asAgentId` is the third coordinate's
    // boundary clamp (2026-08-21) and a permissive fake would let every op below accept an
    // agent id shape main really refuses.
    if (id === "./agent-id") return realAgentId;
    if (id === "./session-launch-op") return launchOpModule;
    if (id === "./session-delete-op") return deleteOpModule;
    // The MACHINE-LOCAL template approval store. `approveTemplate` records and answers true;
    // `isTemplateApproved` answers false, which is the default-deny state a fresh Mac is in.
    if (id === "./channel-prefs") {
      return {
        approveTemplate: (id2) => { approvals.push(id2); return true; },
        isTemplateApproved: () => false,
        launchStartModes: () => ({}),
        getLaunchModel: () => '',
      };
    }
    if (id === "./session-ipc-ops") return opsModule;
    // 2026-08-31 (port wave D) — WHICH RUNTIME this channel's agents launch on. ⚠ Stubbed at its
    // seam like `./channel-prefs` above (the real module opens an electron-store), and answering
    // `''` is the DEFAULT adapter, which is what every launch resolved to before the port — so
    // the specs this file asserts stay byte-identical to the ones that shipped.
    if (id === "./channel-runtime") {
      return { normalizeRuntimeId: (v) => (v === "codex" || v === "cursor" ? v : ""), getChannelRuntime: () => "" };
    }
    throw new Error("unexpected require: " + id);
  };
  const realGuards = new Function(`${BLOCK}\n return { isAppWindowSender, isUuid, UUID_RE };`)();
  const launchOpModule = evalModule(LAUNCH_OP_SRC, stubRequire);
  const deleteOpModule = evalModule(DELETE_OP_SRC, stubRequire);
  const opsModule = evalModule(OPS_SRC, stubRequire);
  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stubRequire, mod, mod.exports);

  // TWO bound windows — the shell and a pop-out thread window. This is the enumeration:
  // both must work, and nothing else may.
  const shell = mkWin();
  const popout = mkWin();
  const stranger = mkWin();
  mod.exports.register({ getSenderIds: () => idsOf(shell.webContents, popout.webContents) });
  return {
    handlers, writes, dialogs, reopens, popouts, approvals,
    shell: evt(shell.webContents, shell.mainFrame),
    popout: evt(popout.webContents, popout.mainFrame),
    iframe: evt(shell.webContents, { name: "embedded" }),
    foreign: evt(stranger.webContents, stranger.mainFrame),
  };
}

export const CH = "44444444-4444-4444-8444-444444444444";
export const PRESET = { tools: "bypass", messages: "auto_both" };
export const POPOUT_PAYLOAD = { segment: "acme-a1b2", channelId: CH, threadId: "task-1" };
