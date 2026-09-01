// WHICH TOOL PROFILE A LAUNCH RESOLVES — the axis nothing was pinning (F-267, 2026-08-22).
//
// THE DEFECT. `session-ipc-ops.js › sessions:launch` — the operator's own New Agent button —
// resolved the agent tool profile from `channel-listener.js › listWatchedChannels()`, which is the
// TRAY PROJECTION: `{ id, name }` per channel, built for the "Channel folders" submenu. It carries
// no `myAgentToolProfile`, so `targeting-window.js › resolveToolProfile` handed
// `tool-profiles.js › normalizeProfile` an `undefined`, which fails closed — correctly, for an
// input that was never the right one. EVERY agent the operator launched ran at `read_only`
// whatever the channel's `agent_tool_profile` said (`full` by DB default).
//
// ⚠ AND `read_only` IS NOT "GATED", IT IS ABSENT. `session-profiles.js ›
// buildSessionToolConfig('read_only').disallowedTools` carries the whole of `DOPL_SAFE_TOOLS`, so
// `dopl_map` / `dopl_members` / `dopl_kb` / `dopl_search` / `dopl_skill` / `dopl_ontology` /
// `dopl_chats` / `current_workspace` / `list_workspaces` never reach `grantDecision` at all — they
// are not offered to the model. A hard-denied name cannot be opened by any Axis-A floor.
//
// ⚠ THE PEER LANE WAS ALWAYS RIGHT, WHICH IS THE WHOLE POINT. `trigger.js ›
// launchResponderSession` is fed a profile resolved from the full `entry.channel` DTO, so the two
// launch lanes answered DIFFERENTLY for the same channel record. Neither lane was tested for the
// profile it resolves: `channel-launch-posture.test.mjs` covers the two PERMISSION AXES (the
// durable posture) and says nothing about CONTAINMENT.
//
// SO THE PROPERTY THIS FILE EXISTS FOR IS THE LAST ONE: the two lanes AGREE, over the same stored
// record, for every profile value. A single-lane assertion would have passed at HEAD if it had
// been written against the responder lane, and the requester lane would still have been broken.
//
// METHOD. The REAL resolver (`targeting-window.js`) and the REAL fail-closed table
// (`tool-profiles.js`) are required, not faked — a permissive stub would accept exactly the input
// that caused this. The registry accessors are sliced out of the shipped `channel-listener.js` and
// evaluated over a `loops` map shaped the way `reconcile` builds it. The requester lane is the
// shipped `session-ipc-ops.js`, evaluated whole and driven through its real sender binding.
//
// Run: `node --test dopl-desktop-app/test/launch-tool-profile.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";
import { mkWin, evt, idsOf } from "./_ipc-harness.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const LISTENER = read("channel-listener.js");
// ⚠ REPOINTED 2026-08-22 (the agent-templates wave): the `sessions:launch` BODY moved to
// `main/session-launch-op.js` in a §1 split. THE PROFILE READ THIS FILE EXISTS FOR MOVED WITH
// IT, so the lane under test is that module, driven through the real registration in
// `session-ipc-ops.js` — both sources, because the defect (F-267) was a WRONG READ inside the
// body and the guard around it is what makes the body reachable.
const OPS = read("session-ipc-ops.js");
const LAUNCH_OP = read("session-launch-op.js");
const TRIGGER = read("trigger.js");

// ⚠ THE REAL ONES. `targeting-window.js` requires only `tool-profiles.js`, which is deliberately
// electron/fs/path-free, so the resolver under test loads in a plain Node context unmodified.
const { resolveToolProfile } = require(join(MAIN, "targeting-window.js"));
const { buildSessionToolConfig } = require(join(MAIN, "session-profiles.js"));
const { DOPL_SAFE_TOOLS } = require(join(MAIN, "tool-profiles.js"));
const guards = require(join(MAIN, "ipc-guards.js"));
const agentId = require(join(MAIN, "agent-id.js"));

const CH_FULL = "11111111-1111-4111-8111-111111111111";
const CH_READ = "22222222-2222-4222-8222-222222222222";
const CH_BARE = "33333333-3333-4333-8333-333333333333";
const CH_GONE = "44444444-4444-4444-8444-444444444444";
const THREAD = "55555555-5555-4555-8555-555555555555";

/** A loop entry the way `channel-listener.js › reconcile` builds one: the server DTO, whole. */
const entryFor = (id, profile) => ({
  channel: {
    id,
    name: `#${id.slice(0, 4)}`,
    isDirect: false,
    // The caller's OWN value off the channel DTO. Absent on `CH_BARE` — the non-member read, the
    // unrefreshed row, the column this desktop has not heard of.
    ...(profile === undefined ? {} : { myAgentToolProfile: profile }),
  },
  workspaceId: "ws-1",
  workspaceSegment: "acme-a1b2",
});

const ENTRIES = [entryFor(CH_FULL, "full"), entryFor(CH_READ, "read_only"), entryFor(CH_BARE)];

/**
 * The SHIPPED watched-channel accessors, over a `loops` map. Sliced rather than re-implemented:
 * if `watchedChannel` ever goes back to projecting, these cases go red instead of agreeing with a
 * copy that stayed correct.
 */
function registry(entries) {
  const loops = new Map(entries.map((e) => [e.channel.id, e]));
  const src = `${fnOf(LISTENER, "listWatchedChannels")}\n${fnOf(LISTENER, "watchedChannel")}\n`
    + "return { listWatchedChannels, watchedChannel };";
  return new Function("loops", src)(loops);
}

/** The requester lane: the real `sessions:launch`, bound to a real app window. */
function bootLaunch(entries) {
  const handlers = {};
  const launches = [];
  const reg = registry(entries);
  const stub = (id) => {
    if (id === "electron") return { ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    if (id === "./ipc-guards") return guards;
    if (id === "./agent-id") return require(join(MAIN, "agent-id.js"));
    if (id === "./agent-id") return agentId;
    if (id === "./diag") return { diag: () => {} };
    // ⚠ THE REAL REGISTRY AND THE REAL RESOLVER — the two halves of the defect.
    if (id === "./channel-listener") return reg;
    if (id === "./targeting") return { resolveToolProfile };
    if (id === "./session-engine") {
      return {
        launchRequesterSession: async (spec) => {
          launches.push(spec);
          return { agentId: "ag-1", sessionId: "s-1" };
        },
      };
    }
    if (id === "./channel-prefs") {
      return {
        launchStartModes: () => ({ tools: "manual", messages: "auto_inbound" }),
        getLaunchModel: () => null,
      };
    }
    // ⚠ `chainModel` IS THE ONE LINK OF THE PRECEDENCE CHAIN (`session-model.js`, 2026-08-23) and
    // `session-launch-op.js › templateModel` delegates to it, so the stub must carry it or this
    // file's launches throw before they ever reach the profile question it is about.
    if (id === "./session-model") {
      return { aliasForModelId: (v) => v, normalizeModel: (v) => v, chainModel: (v) => v || "" };
    }
    // ⚠ THE BODY IS A SEPARATE MODULE SINCE 2026-08-22, and it is the REAL one: a stub here
    // would make this whole file assert a fake's profile read.
    if (id === "./session-launch-op") return launchOp.exports;
    // No template is asked for by any case in this file, so `resolveTemplate` is never called;
    // it is stubbed to REFUSE so a case that starts passing one goes red rather than silently
    // reaching the network.
    if (id === "./template-resolve") {
      return {
        resolveTemplate: async () => ({ ok: false, reason: "no-template" }),
        narrowOverrides: () => ({ model: "", fields: null }),
        applyOverrides: (t) => t,
      };
    }
    // 2026-08-31 (port wave D) — WHICH RUNTIME this channel's agents launch on. ⚠ Stubbed at its
    // seam like `./channel-prefs` above (the real module opens an electron-store), and answering
    // `''` is the DEFAULT adapter, which is what every launch resolved to before the port — so
    // the specs this file asserts stay byte-identical to the ones that shipped.
    if (id === "./channel-runtime") {
      return { normalizeRuntimeId: (v) => (v === "codex" || v === "cursor" ? v : ""), getChannelRuntime: () => "" };
    }
    throw new Error("unexpected require: " + id);
  };
  const launchOp = { exports: {} };
  new Function("require", "module", "exports", LAUNCH_OP)(stub, launchOp, launchOp.exports);
  const mod = { exports: {} };
  new Function("require", "module", "exports", OPS)(stub, mod, mod.exports);
  const win = mkWin();
  mod.exports.register({ getSenderIds: () => idsOf(win.webContents) });
  return { launch: handlers["sessions:launch"], launches, event: evt(win.webContents, win.mainFrame) };
}

/** The profile the requester lane really hands the engine. */
async function requesterProfile(channelId, entries = ENTRIES) {
  const { launch, launches, event } = bootLaunch(entries);
  const res = await launch(event, { channelId, taskId: THREAD, threadTitle: "T" });
  assert.equal(res.ok, true, "the launch itself must succeed — otherwise nothing was resolved");
  assert.equal(launches.length, 1);
  return launches[0].toolProfile;
}

// ── 1. THE DEFECT, AS A CASE ─────────────────────────────────────────────────────────────────

test("a WATCHED channel whose DTO says `full` launches at `full`", async () => {
  // The case that was red at v1.17.1 and is the reason this file exists. `full` is the DB default
  // for `agent_tool_profile`, so this is not a corner — it is the ordinary channel.
  assert.equal(await requesterProfile(CH_FULL), "full");
});

test("a WATCHED channel whose DTO says `read_only` launches at `read_only`", async () => {
  // The same read, answering restrictively because the CHANNEL says so — not because the input
  // was the wrong shape. A fail-closed default that is right for the wrong reason is not a pass.
  assert.equal(await requesterProfile(CH_READ), "read_only");
});

// ── 2. FAIL-CLOSED, BOTH WAYS ────────────────────────────────────────────────────────────────

test("an UNWATCHED channel fails closed to `read_only`", async () => {
  // Main holds no record for it, so there is nothing to widen from. `watchedChannel` answers
  // null and `normalizeProfile(undefined)` floors it.
  assert.equal(await requesterProfile(CH_GONE), "read_only");
});

test("a WATCHED channel whose DTO carries NO profile field fails closed too", async () => {
  // The unrefreshed / non-member / out-of-enum row. Being watched is not evidence of a value.
  assert.equal(await requesterProfile(CH_BARE), "read_only");
});

test("the fail-closed answer is the TABLE's, not a second literal in the handler", () => {
  // C-11: one definition of "what does an unknown profile mean". The handler must not carry its
  // own `: 'read_only'` fallback — that is the shape that once answered `'full'` one file over.
  const body = LAUNCH_OP.slice(LAUNCH_OP.indexOf("async function launchFromButton("));
  const launchBody = body.slice(0, body.indexOf("ipcMain.handle(", 1));
  assert.match(launchBody, /const toolProfile = targeting\.resolveToolProfile\(/);
  assert.equal(/toolProfile\s*=.*\?.*:\s*'read_only'/.test(launchBody), false,
    "no ternary fallback beside the resolver — normalizeProfile owns the floor");
});

// ── 3. THE PROPERTY THAT PREVENTS THIS CLASS: THE TWO LANES AGREE ─────────────────────────────

test("the requester lane and the responder lane resolve the SAME profile for the same record",
  async () => {
    for (const e of ENTRIES) {
      // The responder lane's own expression, verbatim (`trigger.js › handleTrigger`), over the
      // very record `channel-listener` stored — which is what `trigger.js` is handed.
      const responder = resolveToolProfile(e.channel);
      const requester = await requesterProfile(e.channel.id);
      assert.equal(requester, responder,
        `lanes disagree on ${e.channel.id}: requester=${requester} responder=${responder}`);
    }
  });

test("the responder lane still reads the FULL DTO — the anchor the agreement rests on", () => {
  // If this moves to a projection, the two-lane case above stops being a comparison of two
  // independent readers and starts comparing one reader with itself.
  assert.match(TRIGGER, /const toolProfile = targeting\.resolveToolProfile\(entry\.channel\);/);
});

// ── 4. THE PROJECTION IS NOT AN INPUT, AND MUST NEVER BECOME ONE AGAIN ────────────────────────

test("the TRAY PROJECTION carries no profile at all — feeding it back floors every channel", () => {
  const { listWatchedChannels } = registry(ENTRIES);
  const rows = listWatchedChannels();
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["id", "name"], "the tray gets id + name and nothing else");
    assert.equal(resolveToolProfile(row), "read_only");
  }
  // Said as the defect itself: the `full` channel resolves `read_only` through this input, which
  // is EXACTLY what shipped. If `sessions:launch` is ever pointed back here, case 1 goes red.
  const full = rows.find((r) => r.id === CH_FULL);
  assert.equal(resolveToolProfile(full), "read_only");
});

test("`sessions:launch` does not read the projection, and `watchedChannel` returns the DTO whole",
  () => {
    const body = LAUNCH_OP.slice(LAUNCH_OP.indexOf("async function launchFromButton("));
    const launchBody = body.slice(0, body.indexOf("ipcMain.handle(", 1));
    assert.equal(/listWatchedChannels/.test(launchBody), false,
      "the projection must not come back as this lane's input");
    assert.match(launchBody, /listener\.watchedChannel\(p\.channelId\)/);
    const { watchedChannel } = registry(ENTRIES);
    assert.equal(watchedChannel(CH_FULL).myAgentToolProfile, "full", "the field survives the hop");
    assert.equal(watchedChannel(CH_GONE), null, "an unwatched id is null, never a fabricated row");
    assert.equal(watchedChannel(undefined), null);
    assert.equal(watchedChannel(null), null);
  });

test("BOTH accessors are exported, and the projection is still the tray's", () => {
  assert.match(LISTENER, /module\.exports = \{[^}]*listWatchedChannels[^}]*watchedChannel[^}]*\}/);
  // `main/index.js` is the tray builder and stays on the projection — widening it would hand a
  // menu the server DTO.
  assert.match(read("index.js"), /getChannels: \(\) => listener\.listWatchedChannels\(\)/);
});

// ── 5. WHAT THE WRONG ANSWER COST, MEASURED ──────────────────────────────────────────────────

test("`read_only` REMOVES the Dopl read tools from context — it does not gate them", () => {
  // The stakes, pinned so the entry above cannot drift into folklore. A hard-denied name never
  // reaches `grantDecision`, so no Axis-A floor can reopen it: the agent simply does not have
  // `dopl_map`, `dopl_members`, `dopl_kb`, `dopl_search`, `dopl_skill`, `dopl_ontology`,
  // `dopl_chats`, `current_workspace` or `list_workspaces`.
  const ro = buildSessionToolConfig("read_only");
  for (const name of DOPL_SAFE_TOOLS) {
    assert.ok(ro.disallowedTools.includes(name), `read_only hard-denies ${name}`);
  }
  const full = buildSessionToolConfig("full");
  for (const name of DOPL_SAFE_TOOLS) {
    assert.equal(full.disallowedTools.includes(name), false, `full does not deny ${name}`);
  }
});
