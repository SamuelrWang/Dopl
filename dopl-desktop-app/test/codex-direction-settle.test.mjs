// CXP-3B — A COMPLETED CODEX DIRECT TURN SETTLES ITS DIRECTION `delivered`, EXACTLY ONCE.
//
// Live repro (2026-09-22): direction 73c88154 reached a Codex agent 13s after launch, while the
// launch turn was still running. `messageByTask` read "in flight" and armed the capture at
// depth 2 (the Claude arithmetic: a queued push is its OWN later turn). Codex does not queue —
// `launch-spec.js` sends `turn/steer`, which JOINS the active turn — so ONE `turn/completed`
// arrived, the depth stopped at 1, the text was cleared, and nothing reported. The row sat
// `claimed` until the next direction OVERWROTE the stranded capture and was delivered itself.
//
// These cases drive the SHIPPED chain end to end with only the network and the child faked:
// `agent-directions.js › handle` (claim → deliverTo, which returns `null` = the MCP caller sees
// `pending`) → the REAL `session-reopen.js › messageByTask` → the REAL `session-directed.js`
// capture → the REAL Codex `launch-spec.js` prompt pump → the REAL `normalize.js` → `observe`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { sentinelBlock } from "./helpers/source-probe.mjs";
import { evalModule } from "./helpers/module-sandbox.mjs";

const require_ = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");
const CODEX = join(MAIN, "runtime", "codex");

const wire = require_(join(MAIN, "agent-direction-wire.js"));
const directionRate = require_(join(MAIN, "direction-rate.js"));
const framing = require_(join(MAIN, "session-seed.js"));
const privateTurn = require_(join(MAIN, "session-private.js"));
const directedTurn = require_(join(MAIN, "session-directed.js"));
const { floorWindowlessMessage } = require_(join(MAIN, "session-profiles.js"));
const io = require_(join(MAIN, "session-io.js"));
const client = require_(join(CODEX, "client.js"));
const launchSpec = require_(join(CODEX, "launch-spec.js"));
const catalog = require_(join(CODEX, "catalog.js"));
const { normalize } = require_(join(CODEX, "normalize.js"));

const WS = "11111111-2222-3333-4444-555555555555";
const CH = "22222222-3333-4444-5555-666666666666";
const TH = "33333333-4444-5555-6666-777777777777";
const D1 = "44444444-5555-6666-7777-888888888888";
const D2 = "55555555-6666-7777-8888-999999999999";
const ME = "me-user";
const AGENT = "bvi9avs7";

const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 20) { for (let i = 0; i < n; i += 1) await tick(); }

// ── `agent-directions.js`, evaluated with its network stubbed (its own suite's idiom) ──────────
function directionsLane(direct) {
  const posts = [];
  const stub = (id) => {
    if (id === "./api") {
      return {
        apiFetch: async (path, opts) => {
          posts.push({ path, body: opts.body });
          if (path === wire.ROUTES.claim) {
            const d = opts.body && (opts.body.id || opts.body.directionId);
            return { ok: true, status: 200, json: async () => ({ direction: row(d, "claimed") }) };
          }
          return { ok: true, status: 200, json: async () => ({}) };
        },
      };
    }
    if (id === "./realtime") return { setDirections: () => {}, isWorkspaceHealthy: () => true };
    if (id === "./channel-prefs") return { getOrchestratorDirect: () => true };
    if (id === "./agent-direction-wire") return wire;
    if (id === "./direction-rate") { directionRate.resetForTests(); return directionRate; }
    if (id === "./diag") return { diag: () => {} };
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = evalModule(readFileSync(join(MAIN, "agent-directions.js"), "utf8"), stub);
  mod.start({ getUserId: () => ME, direct, workspaces: () => [WS] });
  // ⚠ `session-directed.js` lazy-requires `./agent-directions` to report; hand it THIS instance.
  const path = join(MAIN, "agent-directions.js");
  require_.cache[path] = { id: path, filename: path, loaded: true, exports: mod };
  const decides = () => posts.filter((p) => p.path === wire.ROUTES.decide).map((p) => p.body);
  return { api: mod, decides };
}

function row(id, status = "pending") {
  return {
    id, workspace_id: WS, channel_id: CH, task_id: TH, operator_user_id: ME, agent_id: AGENT,
    body: `question for ${id.slice(0, 2)}`, status,
  };
}

// ── The REAL `messageByTask`, sliced the way `session-direction-lane.test.mjs` does it ─────────
function reopenOps(sessions, dispatch) {
  const SRC = readFileSync(join(MAIN, "session-reopen.js"), "utf8");
  const BLOCK = sentinelBlock(SRC, "SESSION-REOPEN-PURE");
  const store = {
    sessionKey: (c, t, a) => `${c}:${t}:${a || ""}`,
    slotKey: (x) => `${x.channelId || ""}:${x.taskId || ""}:${x.agentId || ""}`,
    threadKeyPrefix: (c, t) => `${c || ""}:${t || ""}:`,
  };
  const api = new Function("store", "framing", "floorWindowlessMessage", "privateTurn", "directedTurn",
    `${BLOCK}\n return { bind, messageByTask };`
  )(store, framing, floorWindowlessMessage, privateTurn, directedTurn);
  api.bind({ sessions, refreshTray: () => {}, dispatch, openAgentWindow: null });
  return api;
}

/** A push iterator, standing in for the engine's (`pushTurn` → `s.pushIterator.push`). */
function pushQueue() {
  const items = [];
  let wake = null;
  return {
    push(m) { items.push(m); if (wake) { wake(); wake = null; } },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length) yield items.shift();
        await new Promise((r) => { wake = r; });
      }
    },
  };
}

/**
 * One Codex session, wired: fake app-server, real pump, real normalize, `observe` on every event.
 * `server.steer` decides what the app-server does with a steer — by default it accepts it into
 * the active turn, which is the measured behaviour.
 */
function codexSession(serverOpts = {}) {
  const s = {
    key: `${CH}:${TH}:${AGENT}`, agentId: AGENT, sessionId: "s-1", settled: false, win: null,
    context: {}, operatorUserId: ME, nonce: "n0nce1", state: { activity: "idle" }, profile: "full",
  };
  const prompts = pushQueue();
  let hooks = null;
  let turnSeq = 0;
  let activeTurn = null;
  const server = {
    starts: 0, steers: 0,
    say(text) {
      hooks.onNotification({ method: "item/completed",
        params: { item: { type: "agentMessage", id: `m-${Math.random()}`, text } } });
    },
    complete() {
      const id = activeTurn;
      activeTurn = null;
      hooks.onNotification({ method: "turn/completed", params: { turn: { id, status: "completed" } } });
    },
  };
  const fake = {
    async request(method) {
      if (method === "initialize") return {};
      if (method === "thread/start") return { thread: { id: "thread-1" }, model: "gpt-x" };
      if (method === "turn/start") {
        server.starts += 1;
        activeTurn = `turn-${++turnSeq}`;
        if (serverOpts.onStart) serverOpts.onStart(server, turnSeq);
        return { turn: { id: activeTurn } };
      }
      if (method === "turn/steer") {
        server.steers += 1;
        const id = activeTurn;
        if (serverOpts.onSteer) serverOpts.onSteer(server);
        return { turnId: id };
      }
      return {};
    },
    notify() {},
    close() {},
  };
  // The child is spawned after the async catalog step (CX-09): both stand-ins restore themselves
  // on first use rather than right after `start` returns.
  const originalConnect = client.connect;
  client.connect = (o) => { hooks = o; client.connect = originalConnect; return fake; };
  const originalCatalog = catalog.writeDelegationFreeCatalog;
  catalog.writeDelegationFreeCatalog = async (home) => {
    catalog.writeDelegationFreeCatalog = originalCatalog;
    return join(home, catalog.CATALOG_FILE);
  };
  const handle = launchSpec.start({
    session: s, args: [], env: {}, cwd: MAIN, prompt: prompts,
    dispatch: () => {}, emitQuiet: () => {},
  });
  // The consume loop: the engine's funnel reduced to what the capture reads.
  void (async () => {
    for await (const msg of handle) {
      for (const ev of normalize(msg, {})) {
        if (ev.type === "result") s.state = { ...s.state, activity: "idle" };
        directedTurn.observe(s, ev);
      }
    }
  })().catch(() => {});
  // The engine's `steer` → reducer → `pushTurn`, and activity moves to `working` synchronously.
  const dispatch = (sess, event) => {
    if (event.type !== "steer") return;
    sess.state = { ...sess.state, activity: "working" };
    prompts.push(io.userMessage(event.text));
  };
  const sessions = new Map([[s.key, s]]);
  const ops = reopenOps(sessions, dispatch);
  const launch = (text) => { s.state = { ...s.state, activity: "working" }; prompts.push(io.userMessage(text)); };
  return { s, server, ops, launch, close: () => handle.close() };
}

function wired(serverOpts) {
  const c = codexSession(serverOpts);
  const lane = directionsLane((spec) => c.ops.messageByTask(spec));
  return { ...c, ...lane };
}

const delivered = (decides, id) => decides().filter((b) => b.id === id || b.directionId === id);

test("CXP-3B repro: a direction steered into the LIVE launch turn is delivered when that turn ends", async () => {
  const h = wired();
  h.launch("the launch goal");
  await settle();
  assert.equal(h.server.starts, 1);

  await h.api.handle(row(D1), WS); // claim → deliverTo → `null`: the MCP caller got `pending`
  await settle();
  assert.equal(h.server.steers, 1, "Codex steers into the active turn — it does not queue");
  assert.equal(h.decides().length, 0, "nothing terminal while the turn is still running");

  h.server.say("working on the goal");
  h.server.say("the answer to the direction");
  h.server.complete();
  await settle();

  const d = delivered(h.decides, D1);
  assert.equal(d.length, 1, "exactly one terminal write");
  assert.equal(d[0].status, "delivered");
  assert.equal(d[0].reply, "the answer to the direction");
  assert.equal(directedTurn.isDirectedTurn(h.s), false, "the capture is spent, not stranded");

  h.launch("a later channel turn"); // a later result must not report the row again
  await settle();
  h.server.say("unrelated");
  h.server.complete();
  await settle();
  assert.equal(delivered(h.decides, D1).length, 1);
  h.close();
});

test("CXP-3B: completion racing ahead of the steer response still settles the SAME row once", async () => {
  // ⚠ The app-server's `turn/completed` is on the queue BEFORE the pump's steer continuation runs.
  const h = wired({ onSteer: (server) => { server.say("merged answer"); server.complete(); } });
  h.launch("the launch goal");
  await settle();
  await h.api.handle(row(D1), WS);
  await settle();
  const d = delivered(h.decides, D1);
  assert.equal(d.length, 1);
  assert.equal(d[0].status, "delivered");
  assert.equal(d[0].reply, "merged answer");
  assert.equal(directedTurn.isDirectedTurn(h.s), false);
  h.close();
});

test("CXP-3B: completion before `handle` even returns (idle agent) is delivered once, by the engine", async () => {
  const h = wired({ onStart: (server) => { queueMicrotask(() => { server.say("fast"); server.complete(); }); } });
  await h.api.handle(row(D1), WS);
  await settle();
  const d = delivered(h.decides, D1);
  assert.equal(d.length, 1, "`deliverTo` wrote nothing itself; the turn's end wrote once");
  assert.equal(d[0].reply, "fast");
  h.close();
});

test("CXP-3B: a SECOND direction neither overwrites nor strands the first", async () => {
  const h = wired();
  await h.api.handle(row(D1), WS); // idle → its own turn
  await settle();
  h.server.say("first answer");
  h.server.complete();
  await settle();
  assert.equal(delivered(h.decides, D1)[0].reply, "first answer");

  await h.api.handle(row(D2), WS); // idle again → turn 2
  await settle();
  h.server.say("second answer");
  h.server.complete();
  await settle();
  assert.equal(delivered(h.decides, D1).length, 1, "D1 is not reported again");
  assert.equal(delivered(h.decides, D2).length, 1);
  assert.equal(delivered(h.decides, D2)[0].reply, "second answer");
  h.close();
});

test("CXP-3B: a second direction arriving while the FIRST's turn runs — both settle, neither strands", async () => {
  const h = wired();
  await h.api.handle(row(D1), WS); // idle → turn 1 carries D1
  await settle();
  await h.api.handle(row(D2), WS); // in flight → steered into turn 1
  await settle();
  assert.equal(h.server.starts, 1);
  assert.equal(h.server.steers, 1);
  h.server.say("one turn answered both");
  h.server.complete();
  await settle();
  assert.equal(delivered(h.decides, D1).length, 1);
  assert.equal(delivered(h.decides, D2).length, 1);
  assert.equal(directedTurn.isDirectedTurn(h.s), false);
  h.close();
});

// ── The pure capture, on the CLAUDE shape — a queued push IS its own turn, and stays so ────────

test("CLAUDE shape unchanged: two directions queued as two turns get their OWN answers", () => {
  const s = {};
  directedTurn.armAndOpen(s, { id: D1, workspaceId: WS }, false, "P1");
  directedTurn.armAndOpen(s, { id: D2, workspaceId: WS }, true, "P2"); // queued behind D1's turn
  directedTurn.noteDirectedText(s, "answer one");
  assert.deepEqual(directedTurn.closeDirected(s), [{ id: D1, workspaceId: WS, reply: "answer one" }]);
  directedTurn.noteDirectedText(s, "answer two");
  assert.deepEqual(directedTurn.closeDirected(s), [{ id: D2, workspaceId: WS, reply: "answer two" }]);
  assert.equal(directedTurn.isDirectedTurn(s), false);
});

test("both ORDERS of join vs result give the joined turn's final text, once", () => {
  const early = {};
  directedTurn.armAndOpen(early, { id: D1, workspaceId: WS }, true, "P");
  assert.deepEqual(directedTurn.noteSteerJoined(early, "seed\n\nP"), []);
  directedTurn.noteDirectedText(early, "merged");
  assert.deepEqual(directedTurn.closeDirected(early), [{ id: D1, workspaceId: WS, reply: "merged" }]);

  const late = {};
  directedTurn.armAndOpen(late, { id: D1, workspaceId: WS }, true, "P");
  directedTurn.noteDirectedText(late, "merged");
  assert.deepEqual(directedTurn.closeDirected(late), [], "the result lands first and spends one");
  assert.deepEqual(directedTurn.noteSteerJoined(late, "P"), [{ id: D1, workspaceId: WS, reply: "merged" }]);
  assert.equal(directedTurn.isDirectedTurn(late), false);
  assert.deepEqual(directedTurn.noteSteerJoined(late, "P"), [], "a second join reports nothing");
});

test("a join of SOME OTHER push never spends a direction's capture", () => {
  const s = {};
  directedTurn.armAndOpen(s, { id: D1, workspaceId: WS }, true, "THE DIRECTION");
  assert.deepEqual(directedTurn.noteSteerJoined(s, "a channel message"), []);
  directedTurn.noteDirectedText(s, "the channel turn's text");
  assert.deepEqual(directedTurn.closeDirected(s), [], "the in-flight turn still reports nothing");
});

test("a re-delivered direction id arms ONE capture, so it can report only once", () => {
  const s = {};
  directedTurn.armAndOpen(s, { id: D1, workspaceId: WS }, false, "P");
  directedTurn.armAndOpen(s, { id: D1, workspaceId: WS }, false, "P");
  directedTurn.noteDirectedText(s, "x");
  assert.equal(directedTurn.closeDirected(s).length, 1);
  assert.deepEqual(directedTurn.closeDirected(s), []);
});
