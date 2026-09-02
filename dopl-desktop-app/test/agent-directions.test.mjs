// THE PRIVATE DIRECT LANE — this machine's half (Samuel's ruling, 2026-08-31).
//
// ⚠ **THE PROPERTIES HERE ARE THE ONES A REVIEW WOULD ASK ABOUT, AND THEY ARE THE REASON THE
// LANE WAS ALLOWED TO EXIST AT ALL:**
//
//  - **THE CONSENT IS LOCAL AND OFF MEANS SILENT.** No claim, no decide, no server write of any
//    kind — a refusal from a machine that has not opted in would itself admit it is listening.
//  - **A FOREIGN ROW IS DROPPED BEFORE THE CLAIM.** The realtime filter is workspace-wide, so a
//    frame for another member's direction reaches this handler under a SUBSCRIPTION rather than
//    a per-row auth answer. Gate 3 is what stops it.
//  - **A DIRECTION MUST NAME ITS AGENT.** There is no oldest-agent fallback on a lane that
//    reaches a PRIVATE turn.
//  - 🔒 **THE FRAMING IS THE LOAD-BEARING RULING.** A direction is text ANOTHER agent wrote and
//    is FENCED AS DATA; reusing the operator framing would hand the highest authority in the
//    system to the lane with the weakest human in it.
//  - **THE REPLY IS ONE TURN'S FINAL TEXT AND NOTHING ELSE**, and a torn-down turn reports
//    nothing at all rather than a partial answer.
//
// SOURCE EXTRACTION with INJECTION, `_launch-directive-harness.mjs`'s idiom: `main/api.js`
// reaches auth and Electron and cannot be required under `node --test`, so the module is
// evaluated with a require stub that THROWS on anything unlisted — a new dependency fails loudly
// rather than silently becoming undefined.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");

const SRC = readFileSync(join(MAIN, "agent-directions.js"), "utf8");
/** The two PURE modules are injected REAL — both are the thing under test at their own
 *  boundaries, and a stub would let the wire contract and the capture drift from what runs. */
const wire = require_(join(MAIN, "agent-direction-wire.js"));
const directed = require_(join(MAIN, "session-directed.js"));
// ⚠ A THIRD PURE MODULE SINCE 2026-08-31 — the inbound rate bound, injected REAL for the same
// reason (a stub that always admits would let the bound drift out from under this lane silently).
const directionRate = require_(join(MAIN, "direction-rate.js"));

const WS = "11111111-2222-3333-4444-555555555555";
const CH = "22222222-3333-4444-5555-666666666666";
const TH = "33333333-4444-5555-6666-777777777777";
const DID = "44444444-5555-6666-7777-888888888888";
const ME = "me-user";
const OTHER = "other-user";
const AGENT = "k3wpf7c5";

/** A realtime frame, i.e. the RAW ROW in snake_case. */
const row = (over = {}) => ({
  id: DID,
  workspace_id: WS,
  channel_id: CH,
  task_id: TH,
  operator_user_id: ME,
  agent_id: AGENT,
  body: "check the deploy and tell me what you find",
  status: "pending",
  ...over,
});

function harness(over = {}) {
  const cfg = {
    enabled: true,
    directResult: { ok: true },
    claimOk: true,
    healthy: true,
    ...over,
  };
  const posts = [];
  const gets = [];
  const arms = [];
  const logged = [];
  const directs = [];

  const stub = (id) => {
    if (id === "./api") {
      return {
        apiFetch: async (path, opts) => {
          if ((opts || {}).method === "GET") {
            gets.push(path);
            return { ok: true, status: 200, json: async () => ({ directions: cfg.pending || [] }) };
          }
          posts.push({ path, body: opts.body });
          if (path === wire.ROUTES.claim) {
            if (!cfg.claimOk) return { ok: false, status: 409 };
            // ⚠ `claimOver` LETS A CASE SHAPE THE **CLAIMED** ROW, which is the one that is
            // acted on — the frame is only a doorbell (the "driven by the CLAIMED row" rule).
            return { ok: true, status: 200,
              json: async () => ({ direction: row({ status: "claimed", ...(cfg.claimOver || {}) }) }) };
          }
          return { ok: true, status: 200, json: async () => ({ direction: row() }) };
        },
      };
    }
    if (id === "./realtime") {
      return {
        setDirections: (on, handler) => { arms.push({ on, handler: typeof handler }); },
        isWorkspaceHealthy: () => cfg.healthy !== false,
        desiredWorkspaceIds: () => [WS],
      };
    }
    if (id === "./channel-prefs") {
      return { getOrchestratorDirect: () => cfg.enabled === true };
    }
    if (id === "./agent-direction-wire") return wire;
    // 2026-08-31 (Samuel's same-owner directions ruling): the REAL rate bound, freshly reset per
    // harness, so these cases drive the shipped module rather than a fake that always admits —
    // and so a future narrowing of it fails HERE rather than in the field. `direction-rate.test
    // .mjs` owns the bound's own cases; this file only needs it not to lie.
    if (id === "./direction-rate") { directionRate.resetForTests(); return directionRate; }
    if (id === "./diag") return { diag: (...p) => logged.push(p.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  };

  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  const api = mod.exports;
  api.start({
    getUserId: () => ME,
    direct: (spec) => { directs.push(spec); return cfg.directResult; },
    workspaces: () => [WS],
  });
  return { api, cfg, posts, gets, arms, logged, directs };
}

const claimPosts = (h) => h.posts.filter((p) => p.path === wire.ROUTES.claim);
const decidePosts = (h) => h.posts.filter((p) => p.path === wire.ROUTES.decide);

// ── THE CONSENT ───────────────────────────────────────────────────────────────

test("CONSENT: with the toggle OFF nothing is claimed, decided, or delivered — and nothing is said", async () => {
  // ⚠ SILENCE IS THE DESIGN. A refusal from a machine that has not opted in would itself admit
  // the machine is listening, which is the one thing an un-opted-in machine must not disclose.
  const h = harness({ enabled: false });
  await h.api.handle(row(), WS);
  assert.equal(h.posts.length, 0, "a machine that has not opted in wrote NOTHING to the server");
  assert.equal(h.directs.length, 0);
});

test("CONSENT: the realtime binding is armed only while the toggle is on", () => {
  // ⚠ THE `on` FLAG IS THE CONSENT; the handler is passed either way and
  // `realtime-mailboxes.js › setDirections` is what drops it when `on` is false — which is the
  // arrangement that makes a subscription and its handler impossible to arm separately.
  assert.equal(harness({ enabled: true }).arms.at(-1).on, true);
  assert.equal(harness({ enabled: false }).arms.at(-1).on, false);
});

test("CONSENT: a disarm really drops the handler, so a stale frame reaches nothing", () => {
  const mailboxes = require_(join(MAIN, "realtime-mailboxes.js"));
  const seen = [];
  let rejoins = 0;
  const rejoin = () => { rejoins += 1; };
  mailboxes.setDirections(true, (ws, r) => seen.push([ws, r]), rejoin);
  // A bound socket delivers; the binding is applied to whatever channel builder is handed in.
  const calls = [];
  const chan = { on: (...a) => { calls.push(a); return chan; } };
  mailboxes.applyBindings(chan, WS);
  // ⚠ TWO SINCE 2026-09-01, and the second one is not a consent: `channel_pings` is bound
  // UNCONDITIONALLY (`realtime-mailboxes.js › applyBindings` states why — a ping buys an
  // external agent no compute and opens no private turn, so it has no toggle and therefore
  // never has to be flipped). What this case is about is the DIRECTIONS table, so it asserts
  // on that table by name rather than on the count of everything riding the socket.
  const armedTables = calls.map((c) => c[1].table);
  assert.deepEqual(armedTables, ["channel_agent_directions", "channel_pings"]);
  calls[0][2]({ new: row() });
  assert.equal(seen.length, 1, "and the handler receives the raw row");

  mailboxes.setDirections(false, null, rejoin);
  const off = [];
  const chanOff = { on: (...a) => { off.push(a); return chanOff; } };
  mailboxes.applyBindings(chanOff, WS);
  assert.equal(
    off.filter((c) => c[1].table === "channel_agent_directions").length,
    0,
    "disarmed: the table is never named on the wire at all"
  );
  assert.equal(rejoins, 2, "every flip rejoins — bindings are fixed at JOIN time");
  mailboxes.reset();
});

test("CONSENT: it is read at DECISION time, never cached at arm time", async () => {
  const h = harness({ enabled: true });
  h.cfg.enabled = false; // the operator flips it after the lane armed
  await h.api.handle(row(), WS);
  assert.equal(h.posts.length, 0);
});

// ── THE FENCES ────────────────────────────────────────────────────────────────

test("FENCE: another operator's row is dropped BEFORE the claim", async () => {
  // 🔒 The realtime filter is `workspace_id=eq.<id>` — WORKSPACE-WIDE — so this frame really
  // does arrive. Gate 3 is the local owner re-check, and it is not redundant with the server's
  // fence: a frame arrives under a SUBSCRIPTION, not under a per-row auth answer.
  const h = harness();
  await h.api.handle(row({ operator_user_id: OTHER }), WS);
  assert.equal(claimPosts(h).length, 0);
  assert.equal(h.directs.length, 0);
});

test("FENCE: a row with NO AGENT ID is refused by the wire, never guessed at", async () => {
  const h = harness();
  await h.api.handle(row({ agent_id: null }), WS);
  assert.equal(h.posts.length, 0);
  assert.equal(wire.directionFrom(row({ agent_id: "" }), WS), null);
  assert.equal(wire.directionFrom(row({ agent_id: "NOTANID" }), WS), null);
});

test("FENCE: a non-UUID id or channel is refused", () => {
  assert.equal(wire.directionFrom(row({ id: "nope" }), WS), null);
  assert.equal(wire.directionFrom(row({ channel_id: "nope" }), WS), null);
});

test("FENCE: only a PENDING row is acted on", async () => {
  for (const status of ["claimed", "delivered", "refused", "expired"]) {
    const h = harness();
    await h.api.handle(row({ status }), WS);
    assert.equal(h.posts.length, 0, status);
  }
});

// ── THE CLAIM ─────────────────────────────────────────────────────────────────

test("CLAIM: a lost CAS is a normal stand-down — no delivery, no retry, no decide", async () => {
  // ⚠ Several of one operator's machines see the same frame; exactly one wins. On THIS lane a
  // second winner would say the same thing to the same agent twice and it would answer twice.
  const h = harness({ claimOk: false });
  await h.api.handle(row(), WS);
  assert.equal(claimPosts(h).length, 1, "it tried once");
  assert.equal(h.directs.length, 0, "and delivered nothing");
  assert.equal(decidePosts(h).length, 0, "and wrote no terminal over the winner's");
});

test("CLAIM: the same direction is never acted on twice in one process", async () => {
  const h = harness();
  await h.api.handle(row(), WS);
  await h.api.handle(row(), WS);
  assert.equal(claimPosts(h).length, 1);
});

// ── THE DELIVERY ──────────────────────────────────────────────────────────────

test("DELIVERY: it goes through the SAME op the operator's own composer uses", async () => {
  // ⚠ RULING R1: one resolution, one `steer`, one private-turn open. A second dispatch path
  // would be a second set of lifecycle bugs.
  const h = harness();
  await h.api.handle(row(), WS);
  assert.equal(h.directs.length, 1);
  assert.deepEqual(h.directs[0], {
    channelId: CH,
    taskId: TH,
    agentId: AGENT,
    text: "check the deploy and tell me what you find",
    // ⚠ `senderAgentId` RIDES BESIDE `operatorUserId` AND IS NOTHING LIKE IT (F-376a,
    // 2026-08-31). That one is COMPARED and fences the delivery; this one is PRINTED — an
    // unverified caption saying which of the operator's own agents filed the row. `null` here
    // because this fixture's row carries none, which is the ordinary external-orchestrator case.
    directed: { id: DID, workspaceId: WS, operatorUserId: ME, senderAgentId: null },
  });
});

test("DELIVERY: a sender caption rides through, shape-gated, and fences nothing", async () => {
  // ⚠ THE SHAPE GATE IS THE POINT. The value is server-derived from a header that PROVES NOTHING
  // about the caller, so a forged one must not be able to park free text in something a renderer
  // prints — the wire drops anything that is not an agent id to `null`, exactly as it REFUSES a
  // row whose `agent_id` is malformed.
  // ⚠ SET ON THE **CLAIMED** ROW, not on the frame: the frame is a doorbell and this lane acts on
  // what the claim hands back (`CLAIM: the launch is driven by the CLAIMED row`).
  const good = harness({ claimOver: { sender_agent_id: "aa11bb22" } });
  await good.api.handle(row(), WS);
  assert.equal(good.directs[0].directed.senderAgentId, "aa11bb22");
  for (const junk of ["", "not-an-id", "AA11BB22", "aa11bb2", "aa11bb223", "<b>x</b>", 42, null]) {
    const h = harness({ claimOver: { sender_agent_id: junk } });
    await h.api.handle(row(), WS);
    assert.equal(h.directs.length, 1, `junk sender must not stop the delivery: ${String(junk)}`);
    assert.equal(h.directs[0].directed.senderAgentId, null, `dropped: ${String(junk)}`);
    // ⚠ AND THE FENCE IS UNMOVED BY ANY OF IT — the owner id is still the one compared.
    assert.equal(h.directs[0].directed.operatorUserId, ME);
  }
});

test("DELIVERY: a successful dispatch writes NO terminal — the TURN answers later", async () => {
  // ⚠ Writing `delivered` here would report an answer before the agent had given one.
  const h = harness();
  await h.api.handle(row(), WS);
  assert.equal(decidePosts(h).length, 0);
});

test("DELIVERY: a refusal from the machine IS written back, with a wire word", async () => {
  const h = harness({ directResult: { ok: false, reason: "no-session" } });
  await h.api.handle(row(), WS);
  assert.deepEqual(decidePosts(h)[0].body, {
    directionId: DID,
    status: "refused",
    refusalReason: "no-session",
  });
});

test("DELIVERY: an unknown refusal word is coerced to a wire one, never sent raw", async () => {
  const h = harness({ directResult: { ok: false, reason: "something-new" } });
  await h.api.handle(row(), WS);
  assert.equal(decidePosts(h)[0].body.refusalReason, "no-bridge");
});

// ── THE REPLY ─────────────────────────────────────────────────────────────────

test("REPLY: the terminal write carries the turn's final text", async () => {
  const h = harness();
  await h.api.reportDelivered({ id: DID, workspaceId: WS, reply: "the deploy is green" });
  assert.deepEqual(decidePosts(h)[0].body, {
    directionId: DID,
    status: "delivered",
    reply: "the deploy is green",
  });
});

test("REPLY: an EMPTY capture omits the key — `null` is NOT REPORTED, not 'it said nothing'", async () => {
  // ⚠ Two different facts, and the MCP render distinguishes them. Sending `''` would assert the
  // agent produced nothing, which a torn-down turn does not license.
  const h = harness();
  await h.api.reportDelivered({ id: DID, workspaceId: WS, reply: "" });
  const body = decidePosts(h)[0].body;
  assert.equal(body.status, "delivered");
  assert.ok(!("reply" in body), "an empty capture sends no `reply` key at all");
});

// ⚠ **THE SECOND HALF OF THIS SUITE MOVED TO `test/agent-directions-framing.test.mjs` ON
// 2026-08-31**, under the §1 500-line cap (this file took the rate bound and the sender caption
// in one wave and went over). THE SEAM IS THE HARNESS: everything above drives `main/agent
// -directions.js` through the require-stub harness — the consent, the fences, the claim CAS and
// the delivery — and everything that moved drives the PURE modules DIRECTLY (`session-directed
// .js`'s capture, `agent-direction-wire.js`'s contract, `session-seed.js`'s framing ruling) and
// needed no harness at all. Nothing was rewritten and no case was dropped.
