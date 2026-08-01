// Q6b — "Open session" ALWAYS opens a window, even for a thread this machine has no record of.
//
// THE BUG: clicking Open session on a thread card answered "This thread has no session on this
// machine" whenever session-store held no durable record for (channel, thread) — which is every
// thread this Mac never worked, including the ones the operator most wants to READ.
//
// Three layers:
//   1. PURE — channel-context.contextFromChannel: what a Channel DTO may contribute, and the
//      counterparty rule (a DIRECT channel's server-resolved peer, or nothing).
//   2. SHELL — session-park's record-less branch, sliced and driven with fakes: it opens a
//      parked shell, loads task-scoped history, respects the window budget, starts NO query, and
//      is reachable ONLY from an operator click.
//   3. VERDICT — the shape session-reopen returns, which the web card reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const channelContext = require(M("channel-context.js"));
const PARK_SRC = readFileSync(M("session-park.js"), "utf8");
const REOPEN_SRC = readFileSync(M("session-reopen.js"), "utf8");
const GATE_SRC = readFileSync(M("session-gate.js"), "utf8");

// ── 1. PURE: the channel context ─────────────────────────────────────────────

const direct = {
  id: "chan-1", name: "David", isDirect: true, isMember: true,
  directPeer: { userId: "user-peer", displayName: "David", avatarUrl: null },
};

test("a DIRECT channel yields the workspace, the name and the server-resolved peer", () => {
  const ctx = channelContext.contextFromChannel(direct, "ws-1", "acme-ab12");
  assert.deepEqual(ctx, {
    channelId: "chan-1", workspaceId: "ws-1", workspaceSegment: "acme-ab12",
    channelName: "David", counterpartyId: "user-peer", counterpartyName: "David",
    // H2: the server's own 1:1 flag, carried SEPARATELY from the peer it resolved. A session
    // needs it to know that its unaddressed posts are addressed for it (resolveDirectPeer),
    // which is what the outbound approval card names a recipient from.
    direct: true,
  });
});

test("a GROUP channel yields NO counterparty — the shell never guesses one", () => {
  const group = { id: "chan-1", name: "Ops", isDirect: false, isMember: true, directPeer: null, memberCount: 5 };
  const ctx = channelContext.contextFromChannel(group, "ws-1", null);
  // FIX N1: the null is still a null (no peer is ever inferred). What it costs downstream is
  // no longer the whole window: session-history opens on the operator's own rows and labels
  // them as one-sided. Nothing about THIS rule changes for that.
  assert.equal(ctx.counterpartyId, null, "no member of a group channel is promoted to 'them'");
  assert.equal(ctx.counterpartyName, null);
  // A direct flag with no resolved peer is equally not a counterparty.
  assert.equal(channelContext.contextFromChannel({ ...direct, directPeer: {} }, "ws-1").counterpartyId, null);
  assert.equal(channelContext.contextFromChannel({ ...direct, isDirect: false }, "ws-1").counterpartyId, null);
  // H2: a group channel is NOT direct, so nothing downstream may name a recipient for an
  // unaddressed post there. The flag is strict — only the server's own `true` sets it.
  assert.equal(ctx.direct, false);
  for (const junk of [undefined, null, "true", 1]) {
    assert.equal(channelContext.contextFromChannel({ ...direct, isDirect: junk }, "ws-1").direct, false, JSON.stringify(junk));
  }
});

test("a channel the caller is not a member of, or with no workspace, yields NOTHING", () => {
  assert.equal(channelContext.contextFromChannel({ ...direct, isMember: false }, "ws-1"), null);
  assert.equal(channelContext.contextFromChannel(direct, ""), null);
  assert.equal(channelContext.contextFromChannel(null, "ws-1"), null);
  assert.equal(channelContext.contextFromChannel({}, "ws-1"), null);
});

// ── 2. SHELL: the record-less open ───────────────────────────────────────────

const BEGIN = "// ─── BEGIN SESSION-PARK-PURE";
const END = "// ─── END SESSION-PARK-PURE";
const BLOCK = PARK_SRC.slice(PARK_SRC.indexOf(BEGIN), PARK_SRC.indexOf(END));

function harness(over = {}) {
  const cfg = { record: null, sdkId: null, ctx: { channelId: "c1", workspaceId: "ws-1", channelName: "David",
    counterpartyId: "user-peer", counterpartyName: "David" }, atCap: false, resolver: true, ...over };
  const calls = { startSession: [], history: [], query: [], consume: [], resolve: [], emit: [] };
  const io = { makePushIterator: () => ({ push() {}, close() {} }), noteGatedBody: () => {} };
  const store = {
    sessionKey: (c, t) => `${c}:${t}`, getRecord: () => cfg.record, getSdkSessionId: () => cfg.sdkId,
    // D2: session-park resumes on the record's OWN slot (agent for a TEAM record,
    // thread for every other), so the fake mirrors the real store's slotKey too.
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
  };
  const sessions = new Map();
  const deps = {
    sessions,
    getSdk: async () => ({ query: (a) => { calls.query.push(a); return {}; } }),
    buildSdkOptions: () => ({}),
    consume: (s, q) => calls.consume.push({ s, q }),
    dispatch: () => {},
    startSession: async (spec) => {
      calls.startSession.push(spec);
      const s = { key: spec.key, settled: false, ...spec };
      sessions.set(spec.key, s);
      return s;
    },
    hasLiveSession: (a) => { const s = sessions.get(`${a.channelId}:${a.taskId}`); return !!(s && !s.settled); },
    emit: (s, p) => calls.emit.push(p),
    windowFactoryReady: () => true,
    atWindowCap: () => cfg.atCap === true,
    settleSession: () => {},
    loadHistory: async (s) => { calls.history.push({ channelId: s.channelId, taskId: s.taskId, counterpartyId: s.counterpartyId, workspaceId: s.workspaceId }); },
  };
  if (cfg.resolver) {
    deps.resolveChannelContext = async (id) => { calls.resolve.push(id); return cfg.ctx; };
  }
  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${BLOCK}\n return { bind, recreateParkedShell, openFromChannel };`
  )(io, store, { randomBytes: () => ({ toString: () => "beef" }) }, null, () => {});
  api.bind(deps);
  return { ...api, calls, sessions, deps };
}

const click = { channelId: "c1", taskId: "t1", fromChannel: true };

test("NO durable record + an operator CLICK opens a shell seeded from the channel", async () => {
  const h = harness();
  assert.deepEqual(await h.recreateParkedShell(click), { ok: true });
  assert.deepEqual(h.calls.resolve, ["c1"], "the workspace + peer come from the channel, not a record");
  assert.equal(h.calls.startSession.length, 1, "one window");
  const spec = h.calls.startSession[0];
  assert.equal(spec.parkedShell, true, "a SHELL: the window opens, nothing runs");
  assert.equal(spec.resumeSdkId, null, "there is no prior sdk session to continue");
  assert.equal(spec.workspaceId, "ws-1");
  assert.equal(spec.counterpartyId, "user-peer", "FIX L1 binding restored from the roster");
  assert.equal(spec.profile, "read_only", "FAIL RESTRICTIVE: no record means no stored profile");
  assert.equal(spec.side, "requester", "the operator opened it, so anything they type is their own goal");
  assert.equal(spec.context.channelName, "David");
  assert.equal(spec.context.channelId, "c1", "the ids ride the context (dopl_channel needs them)");
});

test("the history it loads is TASK-SCOPED (the Q1 window rule), on the SAME shell", async () => {
  const h = harness();
  await h.recreateParkedShell(click);
  assert.deepEqual(h.calls.history, [{ channelId: "c1", taskId: "t1", counterpartyId: "user-peer", workspaceId: "ws-1" }],
    "session-history reads s.taskId + s.channelId, so the thread window applies as-is");
});

test("opening starts NO agent work: no query, no consumer, no lifecycle", async () => {
  const h = harness();
  await h.recreateParkedShell(click);
  assert.deepEqual(h.calls.query, [], "no sdk.query");
  assert.deepEqual(h.calls.consume, [], "no consumer loop");
  const spec = h.calls.startSession[0];
  assert.equal(spec.turns, 0);
  assert.equal(spec.costUsd, 0);
  // parkedShell is what makes session-engine return BEFORE startQuery (open-session-no-query).
  assert.match(PARK_SRC, /parkedShell: true, \/\/ the window opens/);
});

test("a channel this operator cannot open returns the ONE note-worthy verdict", async () => {
  for (const ctx of [null, {}, { workspaceId: "" }]) {
    const h = harness({ ctx });
    assert.deepEqual(await h.recreateParkedShell(click), { ok: false, reason: "no-thread" }, JSON.stringify(ctx));
    assert.equal(h.calls.startSession.length, 0, "no empty window is opened");
  }
});

test("the shared window budget still holds — a reopen storm cannot spawn shells", async () => {
  const h = harness({ atCap: true });
  assert.deepEqual(await h.recreateParkedShell(click), { ok: false, reason: "busy" });
  assert.equal(h.calls.startSession.length, 0);
  assert.equal(h.calls.resolve.length, 0, "the cap is checked before the network read");
});

test("one shell per (channel, thread): a second click never opens a second window", async () => {
  const h = harness();
  await h.recreateParkedShell(click);
  assert.deepEqual(await h.recreateParkedShell(click), { ok: true });
  assert.equal(h.calls.startSession.length, 1, "the live entry short-circuits");
});

test("a mid-wave engine with no resolver fails CLOSED (generic verdict)", async () => {
  const h = harness({ resolver: false });
  assert.deepEqual(await h.recreateParkedShell(click), { ok: false });
  assert.equal(h.calls.startSession.length, 0);
});

test("the INBOUND GATE never opens a record-less shell (only a click may)", async () => {
  const h = harness();
  // The gate calls the same builder WITHOUT `fromChannel` — a peer whose thread this machine has
  // no record of must not be able to pop a window here.
  assert.deepEqual(await h.recreateParkedShell({ channelId: "c1", taskId: "t1" }), { ok: false });
  assert.equal(h.calls.startSession.length, 0);
  assert.equal(h.calls.resolve.length, 0, "not even a lookup");
  assert.match(GATE_SRC, /sessionPark\.recreateParkedShell\(\{ channelId: a\.channelId, taskId: a\.taskId, holdBody: a\.message \}\)/,
    "the gate's call site carries no fromChannel flag");
});

// ── 3. VERDICT: what the web card reads ──────────────────────────────────────

test("reopenByTask marks the operator click, and documents the verdict the card reads", () => {
  assert.match(REOPEN_SRC, /deps\.recreateParkedShell\(\{ channelId, taskId, fromChannel: true \}\)/);
  for (const line of ["{ ok: true }", "reason: 'no-thread'", "reason: 'busy'"]) {
    assert.ok(REOPEN_SRC.includes(line), `the verdict contract names ${line}`);
  }
});
