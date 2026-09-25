// WHICH RUNTIMES THIS MAC IS CONNECTED TO, ON THE POSTURE READ — `main/runtime/connectivity.js`
// and the `connected` key `channels:getLaunchPosture` now carries.
//
// Samuel, 2026-09-08, correcting a pass that had narrowed the New-agent popup's Runtime row to the
// runtimes the desktop could start: *"No, even if the user does not have codex or cursor connected,
// I still want them to be options there so that the user knows that those are options, so they can
// connect them. It should just be logged in, like it is just put in their default, right? I did not
// say to remove them."*
//
// SO THE PROPERTY THIS FILE EXISTS FOR IS TWO-SIDED, and only one side is about probing:
//
//  1. **`runtimes` IS NEVER SHORTENED.** The reply still names every registered adapter, and
//     `connected` is a SUBSET beside it. A future change that filters the roster passes every
//     probe case below and breaks the ruling, so the roster is asserted here too.
//  2. **A PROBE THAT DOES NOT ANSWER IS "NOT CONNECTED", NEVER AN ERROR AND NEVER A HANG.** These
//     probes spawn binaries (`codex --version`), the posture read is what a dialog is waiting on,
//     and the three ways a probe fails — reject, throw, never answer — are ONE answer here.
//  3. **ONE SWEEP STANDS FOR 60s.** The read happens on every mount of the popup, the Settings tab
//     and every pop-out; without the cache, opening a dialog spawns three binaries.
//
// ⚠ NO ELECTRON, AND NO REAL ADAPTERS. `connectivity.js` takes the adapter LIST as an argument
// precisely so it can be driven with fakes that hang on demand — the real `available()` answers
// are `adapter-parity.test.mjs`'s subject, not this file's.
//
// Run: `node --test dopl-desktop-app/test/launch-posture-connected.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evalModule, loadWithStubs } from "./helpers/module-sandbox.mjs";
import { sentinelBlock } from "./helpers/source-probe.mjs";
import { createRequire as createRequirePL } from "node:module";
const PERMISSION_LEVEL = createRequirePL(import.meta.url)("../main/runtime/permission-level.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const requireMain = createRequire(import.meta.url);

/** A fresh module instance — the cache is module-level, so each case gets its own. */
function loadConnectivity() {
  return loadWithStubs("runtime/connectivity.js", {});
}

/** One fake sealed adapter. `answer` is whatever `available()` does. */
const adapter = (id, answer) => ({
  descriptor: { id, label: id },
  runtime: { available: answer },
});

const never = () => new Promise(() => {});
const ok = async () => ({ ok: true, reason: "" });
const no = async () => ({ ok: false, reason: "not installed" });

// ── 1. THE SWEEP ─────────────────────────────────────────────────────────────────────────────

test("all three adapters are probed, and only the ones that answered `ok` are connected", async () => {
  const c = loadConnectivity();
  const calls = [];
  const list = [
    adapter("claude", async () => { calls.push("claude"); return { ok: true }; }),
    adapter("codex", async () => { calls.push("codex"); return { ok: false, reason: "no binary" }; }),
    adapter("cursor", async () => { calls.push("cursor"); return { ok: true }; }),
  ];
  const connected = await c.connectedIds(list);
  // ⚠ EVERY adapter is asked — a sweep that stopped at the first refusal would report a machine
  // with Codex missing as having no runtimes at all.
  assert.deepEqual(calls.sort(), ["claude", "codex", "cursor"]);
  // ⚠ REGISTRY ORDER, because the popup's preselect chain reads "the FIRST connected one".
  assert.deepEqual(connected, ["claude", "cursor"]);
});

test("a probe that NEVER ANSWERS reads as not connected, and does not hold up the ones that did", async (t) => {
  // Mocked time: the leash fires on `tick`, so the sweep resolving there proves it cannot outlast it.
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const c = loadConnectivity();
  let settled = null;
  const sweep = c.connectedIds([adapter("claude", ok), adapter("codex", never), adapter("cursor", ok)])
    .then((ids) => { settled = ids; return ids; });
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, null, "the hung probe holds the sweep until the leash");
  t.mock.timers.tick(c.LEASH_MS);
  assert.deepEqual(await sweep, ["claude", "cursor"]);
});

test("a REJECTION, a SYNCHRONOUS THROW and a missing `available` are all just not connected", async () => {
  // ⚠ ONE ANSWER FOR FOUR FAILURE SHAPES, because on the surface that reads this they mean one
  // thing. ⚠ AND NONE OF THEM REJECTS: a posture read that threw would take the Settings tab and
  // the popup with it over a field neither of them needs in order to render.
  const c = loadConnectivity();
  const connected = await c.connectedIds([
    adapter("claude", async () => { throw new Error("module missing"); }),
    adapter("codex", () => { throw new Error("sync throw"); }),
    { descriptor: { id: "cursor" }, runtime: {} },
    adapter("live", ok),
  ]);
  assert.deepEqual(connected, ["live"]);
});

test("an adapter answering something that is not `{ok:true}` is not connected", async () => {
  // ⚠ `=== true`, not truthiness: `available()` is contracted to answer `{ok, reason}`, and a
  // build mid-wave answering a bare string or `undefined` must read as ABSENT rather than present.
  const c = loadConnectivity();
  assert.deepEqual(
    await c.connectedIds([
      adapter("a", async () => undefined),
      adapter("b", async () => "yes"),
      adapter("c", async () => ({ ok: "true" })),
      adapter("d", no),
    ]),
    []
  );
});

// ── 2. THE CACHE ─────────────────────────────────────────────────────────────────────────────

test("a second read inside the TTL does NOT probe again", async () => {
  // ⚠ MUTATION-PROOF: delete the TTL branch in `connectedIds` and only this case (and the next)
  // goes red. The cost it prevents is an `execFile` per adapter per dialog open.
  const c = loadConnectivity();
  let probes = 0;
  const list = [adapter("claude", async () => { probes += 1; return { ok: true }; })];
  assert.deepEqual(await c.connectedIds(list), ["claude"]);
  assert.deepEqual(await c.connectedIds(list), ["claude"]);
  assert.deepEqual(await c.connectedIds(list), ["claude"]);
  assert.equal(probes, 1, "three reads inside the TTL are one sweep");
  assert.ok(c.TTL_MS >= 60000, "the sweep stands for at least a minute");
});

test("CONCURRENT reads share ONE sweep rather than racing three", async () => {
  const c = loadConnectivity();
  let probes = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const list = [adapter("claude", async () => { probes += 1; await gate; return { ok: true }; })];
  const all = Promise.all([c.connectedIds(list), c.connectedIds(list), c.connectedIds(list)]);
  release();
  const [a, b, d] = await all;
  assert.equal(probes, 1);
  assert.deepEqual([a, b, d], [["claude"], ["claude"], ["claude"]]);
});

test("dropping the cache makes the next read probe again — and it can CHANGE", async () => {
  // The operator installing Codex is the whole reason the TTL is a minute rather than forever.
  const c = loadConnectivity();
  let installed = false;
  const list = [adapter("codex", async () => ({ ok: installed }))];
  assert.deepEqual(await c.connectedIds(list), []);
  installed = true;
  c.resetConnectivityCache();
  assert.deepEqual(await c.connectedIds(list), ["codex"]);
});

test("RC-14: an `expire` during an in-flight sweep is not lost — the stale answer is not cached", async () => {
  // A sweep that began BEFORE the change it is told about (a catalog settled `ready`) used to land
  // and stand for the full TTL, contradicting the picker for a minute.
  const c = loadConnectivity();
  let installed = false;
  let probes = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  // The probe measures the machine when it STARTS, then takes its time answering.
  const list = [adapter("codex", async () => { probes += 1; const seen = installed; if (probes === 1) await gate; return { ok: seen }; })];
  const first = c.connectedIds(list);
  await new Promise((r) => setImmediate(r)); // the probe has started (and seen "not installed")
  installed = true;
  c.expire(); // the change lands while the first probe is still out
  release();
  assert.deepEqual(await first, [], "the in-flight sweep still answers its own callers");
  assert.deepEqual(await c.connectedIds(list), ["codex"], "the next read re-probes instead of the stale answer");
  assert.equal(probes, 2);
});

// ── 3. THE REGISTRY WIRING, AND THE ROSTER IT MUST NOT SHORTEN ───────────────────────────────

test("`runtime/index.js › connectedIds` answers a SUBSET of `all()`, never a replacement for it", async () => {
  // ⚠ THE REAL REGISTRY. What matters here is the SHAPE of the two answers, not which adapters
  // happen to be installed on the machine running the suite: every connected id must be one this
  // build registered, and the roster must be all three whatever the probes said.
  const registry = requireMain(join(MAIN, "runtime", "index.js"));
  const roster = registry.all().map((a) => a.descriptor.id);
  assert.ok(roster.length >= 3, "this build registers claude, codex and cursor");
  const connected = await registry.connectedIds();
  assert.ok(Array.isArray(connected));
  for (const id of connected) assert.ok(roster.includes(id), `${id} must be registered`);
  // ⚠ SAMUEL'S CORRECTION, AS AN ASSERTION: probing must not shorten the roster.
  assert.deepEqual(registry.all().map((a) => a.descriptor.id), roster);
});

test("the posture read carries `connected` BESIDE the full `runtimes` roster, never instead of it", async () => {
  // ⚠ THE RULING'S OWN CASE. Two adapters registered, ONE connected: the reply must still name
  // both, because seeing an unconnected runtime on the row is how an operator learns they could
  // connect it. **MUTATION-PROOF: filter `runtimes` by `connected` in the handler and only this
  // case fails.**
  const { handlers, event } = bootIpc({ connected: ["claude"] });
  const reply = await handlers["channels:getLaunchPosture"](event, CH);
  assert.deepEqual(reply.runtimes.map((d) => d.id), ["claude", "codex"]);
  assert.deepEqual(reply.connected, ["claude"]);
});

test("a registry with no such accessor still answers a posture read", async () => {
  // ⚠ AN OLDER/PARTIAL REGISTRY MUST NOT TAKE THE READ DOWN. `connected: []` is the fail-closed
  // answer and the row simply carries no hints; the popup's own `connectedKnown` lane is the SPA
  // half of the same rule (`hooks/use-channel-launch-posture.ts`).
  const { handlers, event } = bootIpc({ noAccessor: true });
  const reply = await handlers["channels:getLaunchPosture"](event, CH);
  assert.deepEqual(reply.connected, []);
  assert.deepEqual(reply.runtimes.map((d) => d.id), ["claude", "codex"]);
});

const CH = "cccccccc-3333-4333-8333-cccccccccccc";
const DESCRIPTORS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
];

/** `channel-dir-ipc.js` with everything but the posture read stubbed at its seam. */
function bootIpc(opts = {}) {
  const handlers = {};
  const guards = new Function(`${sentinelBlock(readFileSync(join(MAIN, "ipc-guards.js"), "utf8"), "IPC-GUARDS")}\n return { isAppWindowSender, isUuid, UUID_RE };`)();
  const stub = (id) => {
    if (id === "electron") return { ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    if (id === "./ipc-guards") return guards;
    if (id === "./channel-prefs") {
      return {
        getLaunchPosture: () => ({ tools: "manual", messages: "ask", model: null }),
        setLaunchPosture: () => ({ ok: true, preset: { tools: "manual", messages: "ask" } }),
        launchStartModes: () => ({ tools: "manual", messages: "ask", native: {} }),
        // U5 (2026-09-21): the versioned, runtime-keyed record the posture read now also carries.
        // These cases are about `connected`, so the record is the restrictive one and says nothing.
        getLaunchSelectionDetail: () => ({
          selection: { v: 2, runtime: "", messages: "ask", byRuntime: {} }, review: [], stored: false,
        }),
        getLaunchSelection: () => ({ v: 2, runtime: "", messages: "ask", byRuntime: {} }),
        setLaunchSelection: () => ({
          ok: true,
          preset: { tools: "manual", messages: "ask" },
          selection: { v: 2, runtime: "", messages: "ask", byRuntime: {} },
          review: [],
        }),
      };
    }
    if (id === "./channel-runtime") return { getChannelRuntime: () => "", setChannelRuntime: () => "" };
    if (id === "./runtime") {
      const registry = { all: () => DESCRIPTORS.map((d) => ({ descriptor: d })), DEFAULT_ID: "claude" };
      if (!opts.noAccessor) registry.connectedIds = async () => opts.connected || [];
      return registry;
    }
    if (id === "./channel-dirs") {
      return {
        liveChannelDirLabel: () => null,
        resolvedDirLabel: () => "~/Downloads",
        promptAndSetChannelDir: async () => {},
        clearChannelDir: () => {},
      };
    }
    if (id === "./session-engine") return { reopenByTask: () => ({ ok: true }) };
    // 2026-09-18 — DEFAULT AGENT SETTINGS, stubbed so `channel-dir-ipc.js` loads. These cases
    // drive the POSTURE read's `connected` field and none of the defaults ops.
    if (id === "./agent-defaults") return { getAgentDefaults: () => ({ tools: "manual", messages: "ask", agentChain: false, model: null, runtime: "" }), setAgentDefaults: () => ({ ok: true }), seedChannel: () => ({ ok: true, seeded: true }) };
    if (id === "./deep-link-target") return { isSafeSegment: () => true };
    if (id === "./version-gate") return { isBlocked: () => false };
    if (id === "./popout-window") return { openThreadWindow: () => ({ ok: true }) };
    if (id === "./diag") return { diag: () => {} };
    if (id === "./agent-id") return { isAgentId: () => true };
    // U5 (2026-09-21) — the record SHAPE module, stubbed so `channel-dir-ipc.js` loads. These
    // cases drive the POSTURE read's `connected` field and nothing about the record's version.
    if (id === "./launch-selection") return { SELECTION_VERSION: 2 };
    if (id === "./session-ipc-ops") return ops;
    // U6 (2026-09-21): the runtime HALF of both settings replies moved here, so `connected` and
    // the roster are assembled in THIS module now. ⚠ THE REAL SOURCE IS EVALUATED, not faked —
    // "probing must not shorten the roster" is a claim about that code, and a stub would make
    // every case below pin the stub instead. Its own `./runtime` is the same fake registry.
    if (id === "./channel-runtime-reply") return runtimeReply;
    // The catalog layer, stubbed: these cases drive `connected`, not the model roster.
    if (id === "./runtime/model-catalog") return { CATALOG_VERSION: 1, catalogs: () => ({}) };
    if (id === "./runtime/permission-level") return PERMISSION_LEVEL; // pure; the real reading
    throw new Error(`unexpected require: ${id}`);
  };
  const evalMain = (file) => evalModule(readFileSync(join(MAIN, file), "utf8"), stub);
  const runtimeReply = evalMain("channel-runtime-reply.js");
  const ops = evalMain("session-ipc-ops.js");
  const mod = evalMain("channel-dir-ipc.js");
  const mainFrame = { name: "top" };
  const webContents = { id: 1, mainFrame, isDestroyed: () => false };
  mod.register({ getSenderIds: () => new Set([webContents.id]) });
  return { handlers, event: { sender: webContents, senderFrame: mainFrame } };
}
