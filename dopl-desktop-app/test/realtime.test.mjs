// Tests for the push-transport cores in `main/realtime-core.js` — the circuit
// breaker, the wake coalescer, and the wake-payload extraction. All are
// correctness-critical:
//   • the breaker is the F-072 reconnect-storm guard: it decides when the loops
//     may trust pushes (cheap path) vs must revert to the held long-poll, and it
//     must reopen on a half-open failure so a flapping WS never spins;
//   • the coalescer guarantees a BURST of INSERTs is at most one cheap catch-up
//     per channel, not one fetch per row.
//
// Run: `node --test dopl-desktop-app/test/realtime.test.mjs`
//
// WHY SOURCE EXTRACTION: `realtime.js` is CommonJS and pulls in
// @supabase/realtime-js + ws + electron (config/diag), so it cannot be imported
// under `node --test`. Its pure cores therefore live in the sibling
// `realtime-core.js` (§2 500-line cap), each fenced by BEGIN/END sentinel
// comments as a PURE factory (no ws/electron/network refs; clock + timers are
// injected), so this test slices each fenced block and evaluates it verbatim —
// the test stays honest to what ships.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "realtime-core.js"), "utf8");

function slice(beginTag, endTag) {
  const from = SRC.indexOf(beginTag);
  const to = SRC.indexOf(endTag);
  assert.notEqual(from, -1, `${beginTag} sentinel missing`);
  assert.notEqual(to, -1, `${endTag} sentinel missing`);
  assert.ok(to > from, `${beginTag} sentinels out of order`);
  return SRC.slice(from, to);
}

const { createBreaker } = new Function(
  `${slice("// ─── BEGIN BREAKER", "// ─── END BREAKER")}\n return { createBreaker };`
)();
const { createWakeCoalescer } = new Function(
  `${slice("// ─── BEGIN WAKE-COALESCE", "// ─── END WAKE-COALESCE")}\n return { createWakeCoalescer };`
)();
const { wsHealthy } = new Function(
  `${slice("// ─── BEGIN WS-HEALTH", "// ─── END WS-HEALTH")}\n return { wsHealthy };`
)();
const { describeSubscribeError, isAuthFailure, redactSecrets } = new Function(
  `${slice("// ─── BEGIN SUB-ERROR", "// ─── END SUB-ERROR")}\n return { describeSubscribeError, isAuthFailure, redactSecrets };`
)();
const { joinableSet } = new Function(
  `${slice("// ─── BEGIN JOIN-GATE", "// ─── END JOIN-GATE")}\n return { joinableSet };`
)();
const { wakeChannelId, wakePayloadBytes } = new Function(
  `${slice("// ─── BEGIN WAKE-PAYLOAD", "// ─── END WAKE-PAYLOAD")}\n return { wakeChannelId, wakePayloadBytes };`
)();

// ── Breaker: fail → open → cooldown → half-open → close ──────────────────────

test("breaker starts CLOSED (healthy)", () => {
  const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  assert.equal(b.getState(), "closed");
  assert.equal(b.isClosed(), true);
});

test("fewer than threshold failures stays CLOSED", () => {
  const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  b.onFailure();
  b.onFailure();
  assert.equal(b.getState(), "closed");
});

test("threshold consecutive failures OPENs the breaker", () => {
  const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  b.onFailure();
  b.onFailure();
  b.onFailure();
  assert.equal(b.getState(), "open");
  assert.equal(b.isClosed(), false);
});

test("a success before threshold resets the failure count", () => {
  const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  b.onFailure();
  b.onFailure();
  b.onSuccess(); // resets
  b.onFailure();
  b.onFailure();
  assert.equal(b.getState(), "closed", "must take a FULL threshold again to open");
  b.onFailure();
  assert.equal(b.getState(), "open");
});

test("OPEN stays open until the cooldown elapses, then goes HALF-OPEN", () => {
  let t = 0;
  const b = createBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  b.onFailure();
  b.onFailure();
  assert.equal(b.getState(), "open");
  // Before cooldown: no probe.
  t = 999;
  assert.equal(b.maybeHalfOpen(), false);
  assert.equal(b.getState(), "open");
  // After cooldown: a single probe is allowed.
  t = 1000;
  assert.equal(b.maybeHalfOpen(), true);
  assert.equal(b.getState(), "half-open");
  // Idempotent while half-open.
  assert.equal(b.maybeHalfOpen(), true);
});

test("HALF-OPEN success CLOSEs the breaker", () => {
  let t = 0;
  const b = createBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  b.onFailure();
  b.onFailure();
  t = 2000;
  b.maybeHalfOpen();
  b.onSuccess();
  assert.equal(b.getState(), "closed");
  assert.equal(b.isClosed(), true);
});

test("HALF-OPEN failure RE-OPENs with a fresh cooldown", () => {
  let t = 0;
  const b = createBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  b.onFailure();
  b.onFailure();
  t = 1000;
  b.maybeHalfOpen();
  assert.equal(b.getState(), "half-open");
  b.onFailure(); // probe failed
  assert.equal(b.getState(), "open");
  // Cooldown restarts from t=1000: still open at t=1500, half-open at t=2000.
  t = 1500;
  assert.equal(b.maybeHalfOpen(), false);
  t = 2000;
  assert.equal(b.maybeHalfOpen(), true);
});

// ── Wake coalescing ──────────────────────────────────────────────────────────

// A fake timer store: capture the single armed flush callback so the test drives
// the flush deterministically (no real time).
function fakeTimers() {
  let scheduled = null;
  return {
    setTimeout: (fn) => { scheduled = fn; return 42; },
    clearTimeout: () => { scheduled = null; },
    run: () => { const fn = scheduled; scheduled = null; if (fn) fn(); },
    armed: () => scheduled !== null,
  };
}

test("a burst of INSERTs for one channel coalesces to a SINGLE wake", () => {
  const T = fakeTimers();
  const woke = [];
  const c = createWakeCoalescer(200, (id) => woke.push(id), T);
  c.mark("chan-a");
  c.mark("chan-a");
  c.mark("chan-a");
  assert.equal(c.size(), 1, "duplicate ids collapse in the Set");
  assert.equal(T.armed(), true, "one flush is armed for the whole burst");
  T.run();
  assert.deepEqual(woke, ["chan-a"], "exactly one wake for the channel");
  assert.equal(c.size(), 0);
});

test("distinct channels each wake once per window", () => {
  const T = fakeTimers();
  const woke = [];
  const c = createWakeCoalescer(200, (id) => woke.push(id), T);
  c.mark("a");
  c.mark("b");
  c.mark("a");
  T.run();
  assert.deepEqual(woke.sort(), ["a", "b"]);
});

test("null / undefined ids are ignored (never arm a wake)", () => {
  const T = fakeTimers();
  const woke = [];
  const c = createWakeCoalescer(200, (id) => woke.push(id), T);
  c.mark(null);
  c.mark(undefined);
  assert.equal(c.size(), 0);
  assert.equal(T.armed(), false);
});

test("a throwing onFlush does not drop the rest of the batch", () => {
  const T = fakeTimers();
  const woke = [];
  const c = createWakeCoalescer(200, (id) => {
    if (id === "boom") throw new Error("nope");
    woke.push(id);
  }, T);
  c.mark("boom");
  c.mark("ok");
  T.run();
  assert.deepEqual(woke, ["ok"], "the good id still fired");
});

// ── Per-workspace health (the ~3-min-to-consent root cause) ───────────────────
// isWorkspaceHealthy(ws) wires module state (started, breaker.isClosed(), the
// sub for that ws) into this pure predicate. These lock the behavior that fixes
// the bug: a loop trusts push for its ws ONLY when its OWN sub is subscribed.

test("a SUBSCRIBED ws is healthy", () => {
  assert.equal(wsHealthy(true, true, { subscribed: true }), true);
});

test("an ERRORED ws is UNhealthy even though another ws is subscribed", () => {
  // The live bug: ws A up (global health green) while ws B (the DM's) errored.
  // A per-ws Map: B must read UNhealthy so B's loops fall back to the long-poll.
  const subs = new Map([
    ["wsA", { subscribed: true }],
    ["wsB", { subscribed: false }], // CHANNEL_ERROR / TIMED_OUT / CLOSED
  ]);
  const isWsHealthy = (id) => wsHealthy(true, true, subs.get(id));
  assert.equal(isWsHealthy("wsA"), true, "the up ws stays healthy");
  assert.equal(isWsHealthy("wsB"), false, "the errored ws is NOT masked green by wsA");
});

test("an unknown ws (no sub in the map) is UNhealthy", () => {
  assert.equal(wsHealthy(true, true, undefined), false);
});

test("not started → UNhealthy regardless of the sub", () => {
  assert.equal(wsHealthy(false, true, { subscribed: true }), false);
});

test("breaker OPEN → UNhealthy regardless of the sub", () => {
  assert.equal(wsHealthy(true, false, { subscribed: true }), false);
});

// ── Subscribe-failure reasons (the 1.7.6 "1700 bare CHANNEL_ERRORs" blind spot) ─
// realtime-js passes the join-error payload as subscribe()'s SECOND argument; we
// used to drop it, so a permanent failure logged no cause at all. These lock that
// every payload shape realtime-js can hand over yields a usable one-line reason,
// that credential refusals are classified as such (they are the ones a token
// rotation fixes), and that nothing token-shaped can reach the plaintext log.

test("an Error payload reports its message", () => {
  assert.equal(describeSubscribeError(new Error("Unauthorized")), "Unauthorized");
});

test("a {reason} payload reports the reason", () => {
  assert.equal(describeSubscribeError({ reason: "token has expired" }), "token has expired");
});

test("message and reason are BOTH kept when they differ", () => {
  const out = describeSubscribeError({ message: "join failed", reason: "InvalidJWTToken" });
  assert.match(out, /join failed/);
  assert.match(out, /InvalidJWTToken/);
});

test("a duplicated reason is not printed twice", () => {
  assert.equal(describeSubscribeError({ message: "same", reason: "same" }), "same");
});

test("a nested cause is surfaced (realtime-js wraps server errors)", () => {
  const err = new Error("subscribe error", { cause: { reason: "permission denied for function" } });
  const out = describeSubscribeError(err);
  assert.match(out, /subscribe error/);
  assert.match(out, /cause=permission denied for function/);
});

test("a string payload passes through; missing / opaque payloads still say something", () => {
  assert.equal(describeSubscribeError("CHANNEL_ERROR"), "CHANNEL_ERROR");
  assert.equal(describeSubscribeError(null), "no-payload");
  assert.equal(describeSubscribeError(undefined), "no-payload");
  // No message/reason/cause at all: fall back to the serialized shape, never "".
  assert.equal(describeSubscribeError({ code: 403 }), '{"code":403}');
});

test("reasons are length-capped so one server payload cannot flood the log", () => {
  assert.ok(describeSubscribeError({ message: "x".repeat(5000) }).length <= 200);
});

test("credential refusals are classified as auth failures", () => {
  for (const r of [
    "InvalidJWTToken: Token has expired",
    "Unauthorized",
    "permission denied for function is_current_workspace_member",
    "403 Forbidden",
    "jwt malformed",
  ]) {
    assert.equal(isAuthFailure(r), true, `${r} must be an auth failure`);
  }
});

test("non-credential failures are NOT classified as auth failures", () => {
  // A rotation cannot fix these, so they must not trigger one.
  for (const r of ["no-payload", "mismatch between server and client bindings for postgres changes"]) {
    assert.equal(isAuthFailure(r), false, `${r} must not be an auth failure`);
  }
});

test("a token-shaped substring is REDACTED out of the logged reason", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMiLCJleHAiOjF9.c2lnbmF0dXJlX2hlcmU";
  const out = describeSubscribeError({ reason: `bad token ${jwt} rejected` });
  assert.match(out, /<jwt>/);
  assert.ok(!out.includes("eyJ"), "no JWT fragment may survive into the log");
});

test("a publishable apikey is REDACTED out of the logged reason", () => {
  const out = redactSecrets("apikey sb_publishable_HblQWxgsywspHu73EmBQXw_Mu4rBrlw invalid");
  assert.match(out, /<apikey>/);
  assert.ok(!out.includes("sb_publishable_"));
});

// ── Join gate: never subscribe without a user JWT ─────────────────────────────
// The prod hazard this locks: with no JWT realtime-js joins on the URL apikey as
// `anon`, and an anon postgres_changes subscriber cannot evaluate the published
// tables' RLS (42501 on is_current_workspace_member), which crashes the project's
// whole CDC pipeline — push dies for EVERY client, web included. So a join may
// only ever follow a credential.

test("with a credential, every desired workspace is joinable", () => {
  const want = new Set(["wsA", "wsB", "wsC"]);
  assert.deepEqual([...joinableSet(true, want)].sort(), ["wsA", "wsB", "wsC"]);
});

test("with NO credential, NOTHING is joinable (fail closed, not anon)", () => {
  const want = new Set(["wsA", "wsB", "wsC"]);
  assert.equal(joinableSet(false, want).size, 0);
});

test("the gate returns a COPY, so reconciling cannot mutate the desired set", () => {
  const want = new Set(["wsA"]);
  const got = joinableSet(true, want);
  got.delete("wsA");
  assert.equal(want.has("wsA"), true, "the caller's desired set is untouched");
});

test("an empty or missing desired set is handled without a credential check crash", () => {
  assert.equal(joinableSet(true, undefined).size, 0);
  assert.equal(joinableSet(true, new Set()).size, 0);
});

// ── Wake payload: routing key only, whatever the row shape (Q8) ───────────────
// A push is a DOORBELL. The transport reads ONE field (channel_id) and the loop
// refetches over the authed poll, so these lock two things: the extraction keeps
// working when the publication is narrowed to a column list (the egress fix is a
// server-side statement and must be a no-op here), and a payload that carries no
// routing key wakes nothing instead of guessing.

const FULL_ROW_PAYLOAD = {
  schema: "public",
  table: "channel_messages",
  eventType: "INSERT",
  new: {
    id: "11111111-1111-1111-1111-111111111111",
    seq: 412,
    channel_id: "22222222-2222-2222-2222-222222222222",
    workspace_id: "33333333-3333-3333-3333-333333333333",
    author_user_id: "44444444-4444-4444-4444-444444444444",
    author_kind: "agent",
    kind: "message",
    // Prod's average channel_messages row serializes to ~880 bytes; this
    // stands in for it so the ratio below means something.
    body: "a long agent reply that the desktop deliberately never reads. ".repeat(9),
    metadata: { taskId: "t-1", summary: "done", runtime: "desktop-session" },
    client_msg_id: null,
    created_at: "2026-07-31T00:00:00Z",
  },
  old: {},
};

// What the SAME insert looks like once the publication carries a column list.
const SLIM_PAYLOAD = {
  schema: "public",
  table: "channel_messages",
  eventType: "INSERT",
  new: {
    id: "11111111-1111-1111-1111-111111111111",
    seq: 412,
    channel_id: "22222222-2222-2222-2222-222222222222",
    workspace_id: "33333333-3333-3333-3333-333333333333",
    created_at: "2026-07-31T00:00:00Z",
  },
  old: {},
};

test("the wake id is identical whether the row arrives whole or narrowed", () => {
  assert.equal(wakeChannelId(FULL_ROW_PAYLOAD), "22222222-2222-2222-2222-222222222222");
  assert.equal(wakeChannelId(SLIM_PAYLOAD), wakeChannelId(FULL_ROW_PAYLOAD));
});

test("a slim wake is materially cheaper than a whole row (the Q8 win)", () => {
  // Not a byte-exact assertion (Realtime's envelope is its own business) — the
  // point is that dropping body/metadata is where the egress goes.
  assert.ok(
    wakePayloadBytes(SLIM_PAYLOAD) * 2 < wakePayloadBytes(FULL_ROW_PAYLOAD),
    `slim ${wakePayloadBytes(SLIM_PAYLOAD)}B vs full ${wakePayloadBytes(FULL_ROW_PAYLOAD)}B`
  );
});

test("the raw `record` wire shape resolves too (realtime-js renames it to `new`)", () => {
  assert.equal(wakeChannelId({ record: { channel_id: "ch-9" } }), "ch-9");
});

test("a payload with no usable routing key wakes NOTHING (never a guess)", () => {
  for (const p of [
    null,
    undefined,
    {},
    { new: null },
    { new: {} },
    { new: { channel_id: "" } },
    { new: { channel_id: 42 } }, // wrong type: not a channel id
    { old: { channel_id: "ch-1" } }, // a DELETE's old row is not a wake source
  ]) {
    assert.equal(wakeChannelId(p), null, `${JSON.stringify(p)} must not wake`);
  }
});

test("byte measurement never throws, whatever arrives", () => {
  const cyclic = { new: { channel_id: "ch-1" } };
  cyclic.self = cyclic;
  assert.equal(wakePayloadBytes(cyclic), 0, "a cyclic payload measures 0, not a crash");
  assert.equal(wakePayloadBytes(null), 4, "JSON null");
  assert.ok(wakePayloadBytes(SLIM_PAYLOAD) > 0);
  // …and measuring must not have disturbed the routing key.
  assert.equal(wakeChannelId(cyclic), "ch-1");
});
