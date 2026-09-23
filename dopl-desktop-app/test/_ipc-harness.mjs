// SHARED HARNESS for the two IPC-boundary suites (`channel-dir-ipc.js` + `session-ipc-ops.js`),
// split out at the 500-line cap when the 2026-08-20 split (F-226) made one suite read TWO sources.
//
// THE REAL GUARDS ARE THE ONES UNDER TEST. `main/ipc-guards.js` is sliced and evaluated, never
// faked; only electron and the store/window-backed modules are swapped. Both halves are built with
// the SAME stub, so they register into ONE `handlers` map and every case drives both.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { launchDefaultStub } from "./_launch-runtime-stub.mjs";
import { evalModule } from "./helpers/module-sandbox.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
// `main/agent-id.js` is pure (crypto only), so the boundary suites drive the REAL charset predicate
// rather than a fake that would accept ids main refuses.
const realAgentId = req(join(HERE, "..", "main", "agent-id.js"));
// REAL for the same reason (2026-09-05): `main/session-state.js` is pure and DECLARES the caps the
// read hands the SPA, so the refusal shape below cannot assert numbers main never answers with.
const realState = req(join(HERE, "..", "main", "session-state.js"));
// REAL for the same reason (U5, 2026-09-21): `main/launch-selection.js` is pure — it reaches the
// runtime registry and nothing else — and `channel-dir-ipc.js` reads one constant off it, the
// record VERSION every posture/defaults reply declares. A faked version number would pin nothing.
const realSelection = req(join(HERE, "..", "main", "launch-selection.js"));
export const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
export const SRC = M("channel-dir-ipc.js");
export const OPS_SRC = M("session-ipc-ops.js");
// THE LAUNCH BODY IS REAL, NOT A STUB (2026-08-22): `sessions:launch` delegates to
// `main/session-launch-op.js`, and a fake there would make these suites assert a refusal shape the
// shipped code no longer produces. Its lazy handles are this harness's own stub, and a payload
// refused at the boundary never reaches one.
export const LAUNCH_OP_SRC = M("session-launch-op.js");
// THE DELETE BODY IS REAL for the same reason (2026-08-25) — the split moved the code, not the
// boundary. Everything destructive is required LAZILY, after both gates.
export const DELETE_OP_SRC = M("session-delete-op.js");
// THE HELD-GATE ANSWER IS REAL for the same reason (2026-09-17). Everything it touches beyond the
// guards and the id predicate arrives through `bind`, which this harness never calls, so an unbound
// module fails CLOSED — which is the answer under test.
export const ANSWER_PERM_SRC = M("session-answer-permission.js");
// BOTH SOURCES, BECAUSE THE FILE SPLIT AND THE BINDING DID NOT (2026-08-20, F-226): an op that
// dodges the wrapper fails the belt whichever half it was added to.
export const BOTH = `${SRC}\n${OPS_SRC}`;

// Sliced from `main/ipc-guards.js` since 2026-08-20 — it used to be two byte-identical copies
// (the other in `ui-bridge.js`), which is the F-221 drift. One source now; both suites drive it.
const GUARDS = M("ipc-guards.js");
const from = GUARDS.indexOf("// ─── BEGIN IPC-GUARDS");
const to = GUARDS.indexOf("// ─── END IPC-GUARDS");
assert.notEqual(from, -1, "BEGIN IPC-GUARDS sentinel missing");
assert.ok(to > from, "IPC-GUARDS sentinels out of order");
export const BLOCK = GUARDS.slice(from, to);

export const { isAppWindowSender } = new Function(`${BLOCK}\n return { isAppWindowSender };`)();

export { evalModule };

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

export function bootIpc({ blocked = false } = {}) {
  const handlers = {};
  const writes = [];
  const dialogs = [];
  const reopens = [];
  const popouts = [];
  const approvals = [];
  const stubRequire = (id) => {
    if (id === "electron") return { ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    // ONE BRANCH PER MODULE ID, AND THAT IS A RULE NOW (2026-09-05). A `stubRequire` is a lookup
    // chain, so a duplicated id leaves the second branch dead code that reads like coverage: every
    // handler behind its members THROWS on a success path. Merged as a strict SUPERSET, so no
    // case's inputs changed and, where two copies disagreed, the REAL value survives.
    if (id === "./channel-prefs") {
      // The arm's three entries left in 2026-08-20; what remains is the DURABLE posture. EVERY
      // WRITER RECORDS INTO ONE `writes` LEDGER on purpose — the refusal cases assert `writes` is
      // empty, so a second ledger would let one op's forged write pass unseen.
      return {
        getLaunchPosture: () => ({ tools: "bypass", messages: "auto_both" }),
        setLaunchPosture: (channelId, preset) => { writes.push({ channelId, preset }); return { ok: true }; },
        launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }),
        // U5 (2026-09-21): the versioned, runtime-keyed record the two posture ops now read and
        // write. `setLaunchSelection` records into the SAME `writes` ledger — it is the one
        // validating writer, so a second ledger would let one op's forged write pass unseen.
        getLaunchSelection: () => ({ v: 2, runtime: "", messages: "auto_both", byRuntime: {} }),
        getLaunchSelectionDetail: () => ({
          selection: { v: 2, runtime: "", messages: "auto_both", byRuntime: {} },
          review: [],
          stored: true,
        }),
        setLaunchSelection: (channelId, preset) => {
          writes.push({ channelId, preset });
          return { ok: true, preset, selection: { v: 2, runtime: "", messages: "auto_both", byRuntime: {} }, review: [] };
        },
        // `getAutoSend` / `setAutoSend` removed 2026-09-06 (item 8). The fakes go WITH the real
        // functions: a harness offering a method `channel-prefs.js` no longer exports would let a
        // handler reading it pass here and throw in production.
        // 2026-08-31, the per-channel AGENT-CHAINING setting. `get` answers TRUE deliberately: a
        // fake answering the fail-closed value would pass the refusal cases whether the binding
        // worked or not.
        getAgentChain: () => true,
        setAgentChain: (channelId, on) => { writes.push({ channelId, agentChain: on }); return on === true; },
        // 2026-08-22, the ORCHESTRATOR LAUNCH TOGGLE. The getter answers TRUE for the reason above;
        // `set` records into the SAME `writes` ledger as every other writer here.
        getOrchestratorLaunch: () => true,
        setOrchestratorLaunch: (on) => { writes.push({ orchestratorLaunch: on }); return on === true; },
        // 2026-08-31, the PRIVATE DIRECT lane's own consent — same shape, separate grant.
        getOrchestratorDirect: () => true,
        setOrchestratorDirect: (on) => { writes.push({ orchestratorDirect: on }); return on === true; },
        // The MACHINE-LOCAL identity approval store; `isIdentityApproved` answers false, which is
        // the default-deny state a fresh Mac is in.
        approveIdentity: (identityId) => { approvals.push(identityId); return true; },
        isIdentityApproved: () => false,
      };
    }
    // 2026-08-31 (port wave D) — the channel's RUNTIME pick and the adapter registry. They ride the
    // EXISTING posture pair rather than growing a fourth op, so there is no new row in the OPS
    // table; they need only to exist, because the handler reads them on the SUCCESS path these
    // cases must never reach. `normalizeRuntimeId` is the REAL character rule: `''` is the DEFAULT
    // adapter, which is what every launch resolved to before the port.
    if (id === "./channel-runtime") {
      return {
        getChannelRuntime: () => "",
        setChannelRuntime: () => "",
        normalizeRuntimeId: (v) => (v === "codex" || v === "cursor" ? v : ""),
      };
    }
    // 2026-09-23: the identity link, asked of the launch runtime — passthrough here.
    if (id === "./runtime/launch-default") return launchDefaultStub(); // the REAL runtime order, a passthrough model link
    // 2026-09-18 — DEFAULT AGENT SETTINGS. ⚠ EVERY WRITER RECORDS INTO THE SAME `writes` LEDGER as
    // `channel-prefs`' fakes, because the refusal cases assert that ledger is EMPTY: a second
    // ledger would let a forged `setAgentDefaults` or `applyAgentDefaults` pass unseen. ⚠ AND BOTH
    // SUCCEED FOR ANY INPUT, deliberately — the refusal under test is produced by `appWindowOnly`
    // and by the handler's own `isUuid` gate, so a fake that refused on its own would make the
    // binding look intact when it had been deleted.
    if (id === "./agent-defaults") {
      return {
        getAgentDefaults: () => ({ tools: "bypass", messages: "auto_both", agentChain: true, model: null, runtime: "" }),
        setAgentDefaults: (defaults) => { writes.push({ agentDefaults: defaults }); return { ok: true }; },
        seedChannel: (channelId) => { writes.push({ channelId, seeded: true }); return { ok: true, seeded: true }; },
      };
    }
    // `connectedIds` joined 2026-09-08: which registered adapters this Mac could start right now.
    // It rides the SAME read and NARROWS NOTHING — `all()` is still the roster the popup renders.
    if (id === "./runtime") return { all: () => [], DEFAULT_ID: "claude", connectedIds: async () => [] };
    // U6 (2026-09-21): the runtime HALF of both settings replies — roster, connectivity labels and
    // the per-runtime MODEL CATALOGS — moved to its own module. Stubbed rather than evaluated: it
    // requires the real registry (which would load three adapters and `electron`), and the two
    // suites this harness serves are about the SENDER BINDING, not about what a roster says.
    // ⚠ THE KEYS ARE THE CONTRACT: `catalogs` present-but-empty is "this build said nothing",
    // which is a different state from the key being absent. See `main/channel-runtime-reply.js`.
    if (id === "./channel-runtime-reply") {
      return {
        runtimeReply: async () => ({
          runtimes: [], defaultRuntime: "claude", connected: [], catalogVersion: 1, catalogs: {},
        }),
      };
    }
    if (id === "./channel-dirs") {
      return {
        liveChannelDirLabel: () => "~/Downloads/secret-repo",
        // THE EFFECTIVE-DIR HALF (2026-09-05, task 15): the folder ops answer `{label, custom}`. A
        // DISTINCT value from the one above, deliberately — they are two different questions (where
        // it RUNS vs is a per-channel dir SET), and one string for both would let a wrong read pass.
        resolvedDirLabel: () => "~/Downloads/effective-repo",
        promptAndSetChannelDir: async () => { dialogs.push(1); },
        clearChannelDir: () => { writes.push({ cleared: true }); },
      };
    }
    if (id === "./session-engine") {
      return { reopenByTask: (a) => { reopens.push(a); return { ok: true }; } };
    }
    // The REAL character rule — a second regex in channel-dir-ipc.js would be a second answer to it.
    if (id === "./deep-link-target") {
      return { isSafeSegment: (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v) };
    }
    if (id === "./version-gate") return { isBlocked: () => blocked };
    if (id === "./popout-window") {
      return { openThreadWindow: (t) => { popouts.push(t); return { ok: true }; } };
    }
    if (id === "./diag") return { diag: () => {} };
    // The `./settings` stub left 2026-09-07 with the turn caps: it sliced `normalizeTurnCapInput`
    // out of the shipped source, and that function is gone, so it would now throw at construction.
    if (id === "./session-state") return realState;
    // THE REAL GUARDS, NOT A FAKE — `isAppWindowSender` IS what is under test, and `isUuid` is the
    // anti-probe gate every op leans on.
    if (id === "./ipc-guards") return realGuards;
    // The REAL id predicate, for the reason stated where `realAgentId` is loaded, and also the third
    // coordinate's boundary clamp (`asAgentId`, 2026-08-21): a permissive fake would let every op
    // below accept an agent id shape main really refuses.
    if (id === "./agent-id") return realAgentId;
    if (id === "./session-launch-op") return launchOpModule;
    if (id === "./session-delete-op") return deleteOpModule;
  if (id === "./session-answer-permission") return answerPermModule;
    if (id === "./session-ipc-ops") return opsModule;
    // U5: the record SHAPE module. `channel-dir-ipc.js` reads one constant off it — the version
    // every posture/defaults reply declares — so the REAL module is handed over: it is pure (it
    // reaches nothing but the registry) and a faked version number would pin nothing.
    if (id === "./launch-selection") return realSelection;
    throw new Error("unexpected require: " + id);
  };
  const realGuards = new Function(`${BLOCK}\n return { isAppWindowSender, isUuid, UUID_RE };`)();
  const launchOpModule = evalModule(LAUNCH_OP_SRC, stubRequire);
  const deleteOpModule = evalModule(DELETE_OP_SRC, stubRequire);
  const answerPermModule = evalModule(ANSWER_PERM_SRC, stubRequire);
  const opsModule = evalModule(OPS_SRC, stubRequire);
  const mod = evalModule(SRC, stubRequire);

  // TWO bound windows — the shell and a pop-out thread window. This is the enumeration:
  // both must work, and nothing else may.
  const shell = mkWin();
  const popout = mkWin();
  const stranger = mkWin();
  mod.register({ getSenderIds: () => idsOf(shell.webContents, popout.webContents) });
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
