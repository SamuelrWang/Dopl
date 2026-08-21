// THE LISTENER'S ONE PRE-CLASSIFY ROUTE — main/session-dispatch.js, route (1)
// `feedLiveSession`, plus the `authorLabel` resolver it feeds through.
//
// ⚠ THIS FILE HELD FIVE ROUTES' WORTH OF TABLE AND NOW HOLDS ONE (2026-08-20, F-228). The
// excision block at the foot names what stood here. F-228 says these truth tables must SURVIVE
// as "the record that the guards still hold", so the file is rewritten down to the guards that
// are still there rather than removed — INVARIANTS §14.
//
// SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-DISPATCH-PURE block holds
// `authorLabel` + `feedLiveSession`. Every dependency (targeting, sessionEngine, io) is a
// module-scope binding, so we slice the block, prove it is electron/fs/require-free (§H-8),
// and inject fakes to pin the routing TRUTH TABLE without an electron require:
//   a live COUNTERPARTY reply -> feed; a THIRD party never feeds (FIX L1); no live session ->
//   false; my own message, a non-'message' kind and a null identity all fail CLOSED; an
//   unbound session feeds nobody; and the wrapper names the AUTHOR, not the account.
//
// ⚠ AND THAT THE ROUTE IS UNGATED. Route (1) never had the window-mode guard the other four
// opened with, and now that the switch itself is gone the absence is asserted against the
// SOURCE rather than by driving a setting that no longer exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-dispatch.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-DISPATCH-PURE";
const END = "// ─── END SESSION-DISPATCH-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-DISPATCH-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-DISPATCH-PURE sentinel missing");
assert.ok(to > from, "session-dispatch sentinels out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "@anthropic", "process."]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-DISPATCH-PURE block must not reference ${banned}`);
}

// ⚠ THE CODE, WITHOUT THE PROSE. The two source-level pins at the foot of this file ask
// whether a deleted name still EXISTS in this module, and this module's header docblock names
// all four deleted routes and their window-mode gate on purpose — that record is the point of
// the docblock. Scanning raw SRC for them would therefore be permanently red against a
// correct file, which is the failure mode where somebody deletes the pin instead of the code.
const CODE = SRC.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

const ME = "me-user";
const PEER = "peer-user";
const TASK = "11111111-2222-3333-4444-555555555555";

// A fresh harness per test: configurable fakes + recorded calls.
//
// ⚠ THREE INJECTIONS, NOT SEVEN. This used to plumb `settings`, `store` and `notifyLocal` in
// beside them, for routes (2), (3) and (5). The block binds none of the three any more, and a
// fake for a dependency the source has dropped is how a harness quietly keeps testing a
// product that is gone.
function harness(over = {}) {
  const calls = { feedInbound: [] };
  const cfg = {
    live: false,
    counterparty: PEER,
    feedInboundReturn: true,
    displayName: (id) => `name:${id}`,
    ...over,
  };
  const targeting = {
    firstClassTaskId: (m) => m.taskId || "",
  };
  const sessionEngine = {
    hasLiveSession: () => cfg.live,
    counterpartyFor: () => cfg.counterparty,
    feedInbound: (a) => { calls.feedInbound.push(a); return cfg.feedInboundReturn; },
  };
  // 2026-08-01: the label a fed message is titled with is the AUTHOR's — a peer's AGENT posts
  // from the peer's account, so the account's display name is the wrong answer for it. The
  // resolver is `authorLabel`, INSIDE the sliced block, so it is the real one here rather
  // than a fake; only the account-name lookup under it is injected.
  const io = { displayNameFor: (id) => cfg.displayName(id) };
  const api = new Function(
    "targeting", "sessionEngine", "io",
    `${BLOCK}\n return { feedLiveSession, authorLabel };`
  )(targeting, sessionEngine, io);
  return { ...api, calls, cfg };
}

const entry = { channel: { id: "c1", name: "General" }, workspaceId: "w1" };
const peerMsg = (over = {}) => ({ kind: "message", authorUserId: PEER, body: "reply body", taskId: TASK, seq: 7, meta: {}, ...over });

// ── (1) feedLiveSession — the whole of the shipped table ─────────────────────

test("feed: a live peer reply from the task's counterparty feeds the session", () => {
  const h = harness({ live: true, counterparty: PEER });
  assert.equal(h.feedLiveSession(entry, peerMsg(), ME), true);
  assert.equal(h.calls.feedInbound.length, 1);
  assert.deepEqual(h.calls.feedInbound[0], {
    channelId: "c1", taskId: TASK, message: "reply body",
    seq: 7, // the turn's seq — the windowless outbound bridge's thread join
    authorName: `name:${PEER}`,
  });
});

test("feed: a THIRD party in the same channel never injects a turn (FIX L1)", () => {
  const h = harness({ live: true, counterparty: PEER });
  // The live session's counterparty is PEER, but a different member posts.
  assert.equal(h.feedLiveSession(entry, peerMsg({ authorUserId: "third-party" }), ME), false);
  assert.equal(h.calls.feedInbound.length, 0, "no feed for a non-counterparty author");
});

test("feed: a session with NO stored counterparty feeds nobody", () => {
  // The binding is the gate, so an UNBOUND session is not a session everybody may talk into.
  // Fails closed in the one direction that matters: a missing binding costs a turn, a truthy
  // default puts a stranger's words into somebody else's session.
  for (const counterparty of [null, undefined, ""]) {
    const h = harness({ live: true, counterparty });
    assert.equal(h.feedLiveSession(entry, peerMsg(), ME), false, JSON.stringify(counterparty));
    assert.equal(h.calls.feedInbound.length, 0);
  }
});

test("feed: no live session -> false (falls through to classify)", () => {
  const h = harness({ live: false });
  assert.equal(h.feedLiveSession(entry, peerMsg(), ME), false);
  assert.equal(h.calls.feedInbound.length, 0);
});

test("feed: my OWN message, a non-message kind and a NULL identity all fail closed", () => {
  const h = harness({ live: true });
  assert.equal(h.feedLiveSession(entry, peerMsg({ authorUserId: ME }), ME), false, "my own message");
  // ⚠ THE kind FILTER IS THE LAST WORD ON THIS MACHINE — a non-'message' post reaches no
  // session at all, so the lifecycle markers and `task_progress` milestones on the wire cannot
  // spend a peer turn each. classify states the same rule for the same reason.
  for (const kind of ["task_started", "task_failed", "task_finished", "task_progress"]) {
    assert.equal(h.feedLiveSession(entry, peerMsg({ kind }), ME), false, kind);
  }
  // The listener owns identity resolution and passes it in; before it resolves, nothing feeds.
  for (const me of [null, undefined, ""]) {
    assert.equal(h.feedLiveSession(entry, peerMsg(), me), false, `myUserId ${JSON.stringify(me)}`);
  }
  assert.equal(h.feedLiveSession(entry, null, ME), false, "and no message at all");
  assert.equal(h.calls.feedInbound.length, 0);
});

// ── authorLabel — the wrapper a fed turn is titled with ──────────────────────
// Sliced with the route on purpose (see the source comment): it is the one helper route (1)
// calls, so a table that drove the route without it would be driving a different function.

test("feed: the wrapper names the AUTHOR, not the account that posted", () => {
  // A peer's AGENT posts from the peer's account, so `displayNameFor` alone credits a person
  // for a machine's words. `author_kind` is derived server-side from the caller's credential
  // and is never claimed on the wire.
  const agent = harness({ live: true, counterparty: PEER });
  agent.feedLiveSession(entry, peerMsg({ authorKind: "agent" }), ME);
  assert.equal(agent.calls.feedInbound[0].authorName, `name:${PEER}'s agent`);

  const person = harness({ live: true, counterparty: PEER });
  person.feedLiveSession(entry, peerMsg({ authorKind: "user" }), ME);
  assert.equal(person.calls.feedInbound[0].authorName, `name:${PEER}`);

  // …and an account this machine cannot name still says WHAT wrote it rather than nothing.
  const anon = harness({ displayName: () => "" });
  assert.equal(anon.authorLabel({ authorUserId: PEER, authorKind: "agent" }), "an agent");
  assert.equal(anon.authorLabel({ authorUserId: PEER, authorKind: "user" }), "");
  assert.equal(anon.authorLabel(null), "", "and a missing message resolves nothing");
});

// ── the route is UNGATED, and that is a decision ─────────────────────────────

test("route (1) is gated on nothing but a live session's own existence", () => {
  // ⚠ REPOINTED (2026-08-20). This used to be driven — `harness({ windowMode: false })` still
  // fed — which measured the absence of the guard through a setting the module read. The
  // setting is deleted along with the four routes that opened on it, so the absence is
  // asserted where it now lives: in the source. Route (1) claims nothing into existence, so a
  // master switch over it would only ever strand a running session mid-turn.
  assert.ok(!CODE.includes("getWindowMode"), "no window-mode gate survives in session-dispatch");
  assert.ok(!CODE.includes("require('./settings')"), "…and the module does not reach the setting");
  assert.ok(!CODE.includes("settings."), "…nor read one inside the routing block");
});

test("the module exports ONE route, and nothing that was deleted comes back", () => {
  // The dead-tissue pin. Deleting a route while leaving its export is how a caller keeps
  // finding it, and this module's export list IS the listener's menu.
  assert.match(CODE, /module\.exports = \{ feedLiveSession \};/);
  for (const gone of [
    "maybeOpenRequesterSession", "maybeSurfaceRequesterReply", "noteRequestLifecycle",
    "maybeReopenAddressedThread", "diagRuntimeGateSkip", "REQUEST_MILESTONES",
    "exchangeTag", "reopenableRecord",
  ]) {
    assert.ok(!CODE.includes(gone), `${gone} is deleted — no trace of it in the code`);
  }
});

// ⚠ TWELVE TESTS STOOD BELOW AND ARE GONE (2026-08-20, F-228). Four of this module's five
// routes were deleted, and all four opened on `if (!settings.getWindowMode()) return false;` —
// the master switch Samuel's live-test ruling turned permanently off. What each block pinned:
//
//   (2) maybeOpenRequesterSession — seven tests: "my own create_task launches a requester
//       window", "the launch context carries the channel + workspace ids" (prompt-framing's
//       delivery section reads ONLY the context), "H2 — the server's is_direct flag rides the
//       launch, strictly", "an already-live task is deduped (one window per (channel,task))",
//       "a window-cap skip returns false AND posts a passive notice", "not my create_task ->
//       false". The route minted a REQUESTER WINDOW on the operator's OWN thread opener and
//       launched their agent against their own message — the self-trigger bug the retirement
//       was ruled from. There is no requester window to open.
//   (3) maybeSurfaceRequesterReply — five tests: "a settled requester reply is routed to the
//       inbound GATE (no auto-resume)", "the gate refusing -> false", "the route no longer
//       reads the resume map itself", "a still-LIVE session is left to the live path", "a
//       reply where I am NOT the requester never reopens", "window-mode OFF and
//       my-own-message short-circuit". It held a peer's reply at a settled requester window's
//       inbound gate; `session-engine.feedInboundForTask` and `session-park.recreateParkedShell`
//       are deleted under it, so there is no gate and no shell to hold it at.
//
// ⚠ WHAT DID NOT GO WITH THEM. Route (3)'s "a reply where I am NOT the requester never
// reopens" was a REQUESTER/RESPONDER pairing check — `taskCreatedBy === me` AND
// `taskTarget === author` — and that pair is not this module's rule at all: it is
// `targeting.classify`'s task-reply branch, which is untouched and is pinned in
// test/classify.test.mjs and test/legacy-thread-reply.test.mjs. Nothing here was the only
// reader of it.
