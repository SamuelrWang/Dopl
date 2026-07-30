// Tests for main/session-peer-post.js — the v2.8 OPERATOR post (the main-process half of
// composer @-addressing).
//
// SOURCE EXTRACTION with INJECTION (the session-park.test.mjs idiom): the BEGIN/END
// SESSION-PEER-POST-PURE block references its leaf deps (crypto / apiFetch / clampBody / diag
// / sleep) as free vars required at the module top. We slice the block, prove it is
// electron/require-free AND that it names no `dispatch` anywhere (which is what structurally
// guarantees the park invariant), inject fakes, and pin the HTTP posture end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => join(HERE, "..", "main", p);
const SRC = readFileSync(M("session-peer-post.js"), "utf8");
const IPC = readFileSync(M("session-ipc.js"), "utf8");
const ENGINE = readFileSync(M("session-engine.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-PEER-POST-PURE";
const END = "// ─── END SESSION-PEER-POST-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-PEER-POST-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-PEER-POST-PURE sentinel missing");
assert.ok(to > from, "session-peer-post sentinels out of order");
const BLOCK = SRC.slice(from, to);

// The REAL clamp (main/consent.js requires electron, so its contract is mirrored here and
// pinned against the module source below).
const MAX_CONSENT_CHARS = 16000;
const CLAMP_MARKER = "\n\n[Truncated to fit the 16000 character channel limit.]";
const clampBody = (s) => {
  const str = String(s == null ? "" : s);
  return str.length <= MAX_CONSENT_CHARS ? str : str.slice(0, MAX_CONSENT_CHARS - CLAMP_MARKER.length) + CLAMP_MARKER;
};

// `responses` is consumed one entry per attempt: a response object, or an Error to throw.
function harness(responses) {
  const calls = { fetch: [], emits: [], diag: [], sleeps: [] };
  const list = responses || [];
  const apiFetch = async (path, opts) => {
    const attempt = calls.fetch.length;
    calls.fetch.push({ path, opts });
    const r = list[attempt];
    if (r instanceof Error) throw r;
    return r === undefined ? { ok: true, status: 200 } : r;
  };
  const api = new Function(
    "crypto", "apiFetch", "clampBody", "diag", "sleep",
    `${BLOCK}\n return { send, postBody, retryable, safeEmit, refusedText, REFUSE_NO_CHANNEL, RETRY_DELAY_MS, MAX_ATTEMPTS };`
  )(
    { randomUUID: () => "uuid-1" },
    apiFetch,
    clampBody,
    (...parts) => calls.diag.push(parts.join(" ")),
    async (ms) => { calls.sleeps.push(ms); },
  );
  return { ...api, calls, emit: (s, payload) => calls.emits.push(payload) };
}

const session = (over) => ({
  channelId: "c1", workspaceId: "w1", taskId: "task-1",
  counterpartyId: "user-2", counterpartyName: "David",
  ...over,
});
const types = (h) => h.calls.emits.map((e) => e.type);

// ── the block really is inert ─────────────────────────────────────────────────

test("the SESSION-PEER-POST-PURE block references no electron, no require, no process", () => {
  for (const banned of ["require(", "electron", "process.", "child_process", "@anthropic"]) {
    assert.ok(!BLOCK.includes(banned), `the pure block must not reference ${banned}`);
  }
});

test("the module CALLS no dispatch, no SDK and no grant — the park invariant, structurally", () => {
  // Comments are stripped (the session-chrome.test.mjs idiom) so the prose can still NAME
  // what the code must never touch, which is the whole point of writing it down.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const banned of ["dispatch", "pushTurn", "pushIterator", "canUseTool", "allowForTask",
    "autoApprove", "grantDecision", "resumeQuery", "scheduleIdle", "session-reducer", "getSdk",
    "pendingPermissions", "parked"]) {
    assert.ok(!CODE.includes(banned), `session-peer-post.js must never reference ${banned}`);
  }
  assert.match(SRC, /no `dispatch` call anywhere in the file/, "and the file says so out loud");
});

test("it leans on the SHARED helpers, not on private copies", () => {
  assert.match(SRC, /require\('\.\/api'\)/, "the cookie-authenticated apiFetch");
  assert.match(SRC, /clampBody/, "the same 16000-char clamp the agent's own posts use");
  assert.match(SRC, /require\('\.\/consent'\)/);
  assert.match(SRC, /require\('crypto'\)/);
  assert.match(SRC, /require\('\.\/diag'\)/);
});

// ── postBody: the wire shape ──────────────────────────────────────────────────

test("postBody is a USER-authored message with a deterministic client id", () => {
  const h = harness();
  assert.deepEqual(h.postBody(session(), "ship it", "uuid-1"), {
    body: "ship it", authorKind: "user", clientMsgId: "peer-uuid-1",
    toUserId: "user-2", metadata: { taskId: "task-1" },
  });
});

test("postBody carries NO kind key (that is for lifecycle events, not real messages)", () => {
  const h = harness();
  assert.equal("kind" in h.postBody(session(), "x", "uuid-1"), false);
});

test("postBody OMITS toUserId / metadata rather than sending nulls", () => {
  const h = harness();
  assert.deepEqual(h.postBody(session({ counterpartyId: null }), "x", "i"), {
    body: "x", authorKind: "user", clientMsgId: "peer-i", metadata: { taskId: "task-1" },
  });
  assert.deepEqual(h.postBody(session({ taskId: null }), "x", "i"), {
    body: "x", authorKind: "user", clientMsgId: "peer-i", toUserId: "user-2",
  });
  assert.deepEqual(h.postBody(session({ counterpartyId: null, taskId: undefined }), "x", "i"), {
    body: "x", authorKind: "user", clientMsgId: "peer-i",
  });
  assert.deepEqual(h.postBody(null, "x", "i"), { body: "x", authorKind: "user", clientMsgId: "peer-i" });
});

// ── retryable ─────────────────────────────────────────────────────────────────

test("retryable: only a rate-limit or a server fault is worth a second attempt", () => {
  const h = harness();
  for (const status of [429, 500, 502, 503, 504, 599]) assert.equal(h.retryable(status), true, String(status));
  for (const status of [200, 201, 400, 401, 403, 404, 409, 413, 422, 0]) {
    assert.equal(h.retryable(status), false, String(status));
  }
});

// ── send(): the happy path ────────────────────────────────────────────────────

test("send: emits operator_post FIRST, posts once, then emits the verdict", async () => {
  const h = harness();
  const s = session();
  const res = await h.send(s, "ship it", h.emit);
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(types(h), ["operator_post", "operator_post_result"], "the bubble paints BEFORE the POST");
  assert.deepEqual(h.calls.emits[0], { type: "operator_post", localId: "uuid-1", to: "David", text: "ship it" });
  assert.deepEqual(h.calls.emits[1], { type: "operator_post_result", localId: "uuid-1", ok: true });
  assert.equal(h.calls.fetch.length, 1);
  assert.equal(h.calls.fetch[0].path, "/api/channels/c1/messages");
  assert.equal(h.calls.fetch[0].opts.method, "POST");
  assert.equal(h.calls.fetch[0].opts.workspaceId, "w1");
  assert.equal(h.calls.fetch[0].opts.timeoutMs, 20000);
  assert.deepEqual(h.calls.fetch[0].opts.body, h.postBody(s, "ship it", "uuid-1"));
  assert.equal(h.calls.sleeps.length, 0, "no backoff on a first-try success");
});

test("send: the channelId / workspaceId are read off the session AT POST TIME", async () => {
  const h = harness();
  const s = session({ channelId: "late-c", workspaceId: "late-w" });
  await h.send(s, "x", h.emit);
  assert.equal(h.calls.fetch[0].path, "/api/channels/late-c/messages");
  assert.equal(h.calls.fetch[0].opts.workspaceId, "late-w");
});

test("send: the peer NAME rides the emit (null when unknown), never the wire body", async () => {
  const h = harness();
  await h.send(session({ counterpartyName: null }), "x", h.emit);
  assert.equal(h.calls.emits[0].to, null);
  assert.equal("to" in h.calls.fetch[0].opts.body, false);
});

// ── send(): the fail-closed HTTP posture ──────────────────────────────────────

test("send: a 500 retries EXACTLY once, then reports failure", async () => {
  const h = harness([{ ok: false, status: 500 }, { ok: false, status: 500 }]);
  const res = await h.send(session(), "x", h.emit);
  assert.deepEqual(res, { ok: false });
  assert.equal(h.calls.fetch.length, 2, "two attempts, never a third");
  assert.deepEqual(h.calls.sleeps, [h.RETRY_DELAY_MS], "one 600ms backoff");
  assert.deepEqual(h.calls.emits.at(-1), { type: "operator_post_result", localId: "uuid-1", ok: false });
});

test("send: a 500 then a 200 succeeds on the retry", async () => {
  const h = harness([{ ok: false, status: 500 }, { ok: true, status: 200 }]);
  assert.deepEqual(await h.send(session(), "x", h.emit), { ok: true });
  assert.equal(h.calls.fetch.length, 2);
  assert.equal(h.calls.emits.at(-1).ok, true);
});

test("send: a 429 retries; a 400 / 403 / 413 does NOT", async () => {
  const rate = harness([{ ok: false, status: 429 }, { ok: true, status: 200 }]);
  await rate.send(session(), "x", rate.emit);
  assert.equal(rate.calls.fetch.length, 2, "a rate-limit is worth waiting out");
  for (const status of [400, 403, 413]) {
    const h = harness([{ ok: false, status }]);
    assert.deepEqual(await h.send(session(), "x", h.emit), { ok: false });
    assert.equal(h.calls.fetch.length, 1, `a ${status} will not improve on retry`);
    assert.equal(h.calls.sleeps.length, 0);
    assert.equal(h.calls.emits.at(-1).ok, false, "and the bubble says Not sent");
  }
});

test("send: a transport THROW retries once (a dead socket is exactly the retry case)", async () => {
  const h = harness([new Error("aborted"), { ok: true, status: 200 }]);
  assert.deepEqual(await h.send(session(), "x", h.emit), { ok: true });
  assert.equal(h.calls.fetch.length, 2);
  const thrown = harness([new Error("aborted"), new Error("aborted")]);
  assert.deepEqual(await thrown.send(session(), "x", thrown.emit), { ok: false });
  assert.equal(thrown.calls.fetch.length, 2, "still bounded at two");
});

test("send: a missing / garbled response object is a failure, not a claim of delivery", async () => {
  const h = harness([null, null]);
  assert.deepEqual(await h.send(session(), "x", h.emit), { ok: false });
  assert.equal(h.calls.emits.at(-1).ok, false);
});

// ── send(): the two refusals ──────────────────────────────────────────────────

test("send: a session with NO channel binding refuses locally, with a notice and no POST", async () => {
  const h = harness();
  const res = await h.send(session({ channelId: null }), "ship it", h.emit);
  assert.deepEqual(res, { ok: false, reason: "no-channel" });
  assert.equal(h.calls.fetch.length, 0, "nothing left the machine");
  assert.deepEqual(h.calls.emits, [{
    type: "notice", level: "error",
    text: "Could not send that message. This session is not bound to a channel yet.",
  }]);
  assert.ok(!h.REFUSE_NO_CHANNEL.includes("—"), "no em dash in the refusal copy");
  assert.deepEqual(types(h), ["notice"], "and no bubble is painted for a post that never started");
});

test("FIX F9: a REFUSED request (4xx) explains itself, like the no-channel refusal does", async () => {
  // The reachable case: a shell with no workspaceId sends no X-Workspace-Id, so
  // withWorkspaceAuth answers 400 on a multi-workspace credential. The bubble used to read
  // "Not sent" with no reason at all.
  const h = harness([{ ok: false, status: 400 }]);
  assert.deepEqual(await h.send(session({ workspaceId: null }), "ship it", h.emit), { ok: false });
  assert.deepEqual(types(h), ["operator_post", "notice", "operator_post_result"],
    "the notice lands BEFORE the verdict, so the bubble's 'Not sent' already has its reason");
  const notice = h.calls.emits[1];
  assert.equal(notice.level, "error");
  assert.match(notice.text, /^Could not send that message\. The server refused the request \(400\)\./);
  assert.match(notice.text, /Nothing was posted/, "it says the post did not happen");
  assert.match(notice.text, /Reopening this session window/, "and what to do about it");
  assert.ok(!notice.text.includes("—"), "no em dash in the refusal copy");
  assert.ok(!notice.text.includes("ship it"), "the message BODY never reaches a notice");
  assert.equal(h.calls.emits.at(-1).ok, false);
  for (const line of h.calls.diag) assert.ok(!line.includes("ship it"), "...nor the log");
});

test("FIX F9: every 4xx says so; a 5xx / transport fault stays bare (it is transient)", async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422]) {
    const h = harness([{ ok: false, status }]);
    await h.send(session(), "x", h.emit);
    assert.deepEqual(types(h), ["operator_post", "notice", "operator_post_result"], String(status));
    assert.ok(h.calls.emits[1].text.includes("(" + status + ")"), "the status is named, nothing else");
  }
  const rate = harness([{ ok: false, status: 429 }, { ok: false, status: 429 }]);
  await rate.send(session(), "x", rate.emit);
  assert.deepEqual(types(rate), ["operator_post", "notice", "operator_post_result"],
    "a rate-limit that survives its retry is still a refusal the operator should see");
  for (const responses of [[{ ok: false, status: 500 }, { ok: false, status: 500 }],
    [new Error("aborted"), new Error("aborted")], [null, null]]) {
    const h = harness(responses);
    await h.send(session(), "x", h.emit);
    assert.deepEqual(types(h), ["operator_post", "operator_post_result"], "no notice for a transient fault");
  }
  const ok = harness();
  await ok.send(session(), "x", ok.emit);
  assert.deepEqual(types(ok), ["operator_post", "operator_post_result"], "and none at all on success");
});

test("FIX F9: refusedText names ONLY the status, and degrades without one", () => {
  const h = harness();
  assert.equal(h.refusedText(403),
    "Could not send that message. The server refused the request (403). Nothing was posted. " +
    "Reopening this session window usually fixes it.");
  assert.ok(!h.refusedText(0).includes("()"), "no empty parentheses when there is no status");
  assert.match(h.refusedText(0), /^Could not send that message\. The server refused the request\./);
});

test("send: an EMPTY (or whitespace-only) message is a silent no-op", async () => {
  for (const raw of ["", "   ", "\n\t ", null, undefined]) {
    const h = harness();
    assert.deepEqual(await h.send(session(), raw, h.emit), { ok: false, reason: "empty" });
    assert.deepEqual(h.calls.emits, [], "no notice, no bubble");
    assert.equal(h.calls.fetch.length, 0);
  }
});

// ── the body: clamped once, echoed, never logged ──────────────────────────────

test("send: the CLAMPED text is what is posted AND what the bubble shows", async () => {
  const h = harness();
  const long = "x".repeat(20000);
  await h.send(session(), long, h.emit);
  const clamped = clampBody(long);
  assert.equal(h.calls.emits[0].text, clamped, "the window shows the bytes that were sent");
  assert.equal(h.calls.fetch[0].opts.body.body, clamped);
  assert.equal(clamped.length, MAX_CONSENT_CHARS, "and it fits the server cap on the FIRST attempt");
  assert.notEqual(h.calls.emits[0].text, long);
});

test("send: the surrounding whitespace is trimmed exactly once", async () => {
  const h = harness();
  await h.send(session(), "  ship it  ", h.emit);
  assert.equal(h.calls.emits[0].text, "ship it");
  assert.equal(h.calls.fetch[0].opts.body.body, "ship it");
});

test("diag never sees the message body — only an HTTP status", async () => {
  const secret = "the confidential body nobody should log";
  const h = harness([{ ok: false, status: 500 }, { ok: false, status: 403 }]);
  await h.send(session(), secret, h.emit);
  assert.ok(h.calls.diag.length > 0, "a failure IS logged");
  for (const line of h.calls.diag) {
    assert.ok(!line.includes(secret), `the body leaked into diag: ${line}`);
    assert.ok(!line.includes("David"), "and so did the peer name");
  }
  assert.ok(h.calls.diag.some((l) => l.includes("500")), "the status is what is recorded");
});

test("an emit that THROWS can never break the post (or vice versa)", async () => {
  const h = harness();
  const boom = () => { throw new Error("window gone"); };
  assert.deepEqual(await h.send(session(), "x", boom), { ok: true }, "the POST still happened");
  assert.equal(h.calls.fetch.length, 1);
  assert.deepEqual(await h.send(session(), "x", null), { ok: true }, "no emit at all is fine too");
});

// ── the park + grant invariants, on a real-shaped session object ───────────────

test("a post on a PARKED session leaves it parked, untouched, with nothing resumed", async () => {
  const h = harness();
  const s = session({
    state: { parked: true, phase: "parked", turns: 3, permissions: [] },
    query: null, pushIterator: null, idleTimer: null,
    pendingPermissions: new Map(), pendingNames: new Map(), allowForTask: new Set(),
  });
  const before = JSON.parse(JSON.stringify(s.state));
  await h.send(s, "ship it", h.emit);
  assert.deepEqual(s.state, before, "the reducer state is byte-identical");
  assert.equal(s.state.parked, true, "still parked");
  assert.equal(s.query, null, "no query was rebuilt");
  assert.equal(s.pushIterator, null, "nothing was pushed to the agent");
  assert.equal(s.idleTimer, null, "and the idle timer was NOT re-armed");
  assert.equal(s.pendingPermissions.size, 0, "no permission was opened");
  assert.equal(s.allowForTask.size, 0, "no grant was touched");
});

test("the post writes NOTHING onto the session object at all", async () => {
  const h = harness();
  const s = session();
  const before = { ...s };
  await h.send(s, "ship it", h.emit);
  assert.deepEqual(s, before, "not even a bookkeeping field");
});

// ── the IPC + engine wiring that reaches this module ──────────────────────────

test("the handler resolves the session from event.sender ONLY, and fails closed", () => {
  const handler = IPC.slice(IPC.indexOf("ipcMain.handle('session:send-peer'"), IPC.indexOf("// FIX F1 (v2.7)"));
  assert.ok(handler.length > 0, "the send-peer handler exists, ahead of the permission block");
  assert.match(handler, /engine\.getSessionBySender && engine\.getSessionBySender\(e && e\.sender\)/);
  assert.match(handler, /if \(!s\) return \{ ok: false \};/, "no session, no post");
  assert.match(handler, /touch\(s\)/, "an operator keystroke marks the window as used (FIX #7)");
  assert.match(handler, /peerPost\.send\(s, String\(\(p && p\.text\) \|\| ''\), engine\.emitToSession\)/);
  assert.match(handler, /\.catch\(/, "fire-and-forget must never reject unhandled");
  assert.ok(!/engine\.dispatch/.test(handler), "a peer post is NOT a steer: it never dispatches");
  assert.ok(!/withSession/.test(handler), "it reports its own verdict, like the gate handlers");
  assert.equal(IPC.split("ipcMain.handle('session:send-peer'").length - 1, 1, "registered exactly once");
});

test("the engine hands the IPC its emit under the agreed name (zero new lines)", () => {
  assert.match(ENGINE, /sessionIpc\.register\(\{[^}]*emitToSession: emit[^}]*\}\)/);
  assert.match(ENGINE, /sessionIpc\.register\(\{ getSessionBySender, getConsentBySender: sessionConsent\.getBySender, dispatch, decideConsent: sessionConsent\.decide, emitToSession: emit \}\)/);
});

test("the preload's bridge method is fire-and-forget and coerces its one argument", () => {
  const PRELOAD = readFileSync(join(HERE, "..", "renderer", "session", "session-preload.js"), "utf8");
  assert.match(PRELOAD, /sendToPeer\(text\) \{\n\s*ipcRenderer\.invoke\('session:send-peer', \{ text: asStr\(text\) \}\);\n\s*\},/);
  assert.ok(!/sendToPeer\(text, priority\)/.test(PRELOAD), "a peer post has no priority: it is not a turn");
});
