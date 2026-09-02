// THE PING WIRE — narrowing, and the one string that is a contract outside this repo.
//
// ⚠ `pingFrom` RETURNS `null`, IT NEVER THROWS. The input is a realtime frame from a table
// this app may be older than, and one bad row must not kill the socket handler that also
// carries the launch and direction mailboxes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const wire = require(join(HERE, "..", "main", "ping-wire.js"));

const WS = "11111111-2222-3333-4444-555555555555";
const CH = "33333333-4444-5555-6666-777777777777";
const ME = "22222222-3333-4444-5555-666666666666";
const PID = "44444444-5555-6666-7777-888888888888";

const good = (over = {}) => ({
  id: PID,
  seq: 12,
  workspace_id: WS,
  channel_id: CH,
  task_id: null,
  sender_user_id: ME,
  sender_agent_id: "k3wpf7c5",
  recipient_kind: "desktop",
  recipient_user_id: ME,
  recipient_agent_id: null,
  kind: "done",
  body: "shipped it",
  created_at: "2026-09-01T10:00:00Z",
  ...over,
});

test("DOOR: a good row narrows", () => {
  const p = wire.pingFrom(good(), WS);
  assert.equal(p.id, PID);
  assert.equal(p.seq, 12);
  assert.equal(p.kind, "done");
  assert.equal(p.recipientKind, "desktop");
  assert.equal(p.recipientUserId, ME);
  assert.equal(p.senderAgentId, "k3wpf7c5");
});

test("FENCE: the workspace comes from the SUBSCRIPTION, never from the row", () => {
  // A row claiming to belong elsewhere cannot say so — the socket is joined per workspace,
  // so which socket this arrived on IS the fact.
  const p = wire.pingFrom(good({ workspace_id: "somewhere-else" }), WS);
  assert.equal(p.workspaceId, WS);
});

test("FENCE: the closed sets are closed", () => {
  assert.equal(wire.pingFrom(good({ kind: "finished" }), WS), null);
  assert.equal(wire.pingFrom(good({ recipient_kind: "operator" }), WS), null);
  assert.deepEqual(wire.KINDS, ["done", "question", "blocked"]);
  assert.deepEqual(wire.RECIPIENT_KINDS, ["member", "agent", "desktop"]);
});

test("FENCE: the recipient shape is one fact", () => {
  // 'agent' with no agent is undeliverable; an agent id under any other kind names a machine
  // the row is not addressed to.
  assert.equal(wire.pingFrom(good({ recipient_kind: "agent" }), WS), null);
  assert.equal(
    wire.pingFrom(good({ recipient_kind: "agent", recipient_agent_id: "BAD" }), WS),
    null
  );
  assert.equal(
    wire.pingFrom(good({ recipient_kind: "desktop", recipient_agent_id: "k3wpf7c5" }), WS),
    null
  );
  const ok = wire.pingFrom(
    good({ recipient_kind: "agent", recipient_agent_id: "k3wpf7c5" }),
    WS
  );
  assert.equal(ok.recipientAgentId, "k3wpf7c5");
});

test("FENCE: ids must be ids", () => {
  for (const over of [
    { id: "nope" },
    { channel_id: "nope" },
    { recipient_user_id: "" },
  ]) {
    assert.equal(wire.pingFrom(good(over), WS), null, JSON.stringify(over));
  }
});

test("FENCE: the body must exist and must fit the column", () => {
  assert.equal(wire.pingFrom(good({ body: "" }), WS), null);
  assert.equal(wire.pingFrom(good({ body: "x".repeat(wire.MAX_BODY + 1) }), WS), null);
  assert.ok(wire.pingFrom(good({ body: "x".repeat(wire.MAX_BODY) }), WS));
});

test("FENCE: a malformed or missing frame contributes nothing, never a throw", () => {
  for (const raw of [undefined, null, {}, "nope", 7, { id: PID }]) {
    assert.equal(wire.pingFrom(raw, WS), null);
  }
});

test("FENCE: a bad sender caption is DROPPED, not stored", () => {
  // ⚠ It is derived from a header on the sender's side and is worth exactly one printed
  // label. A value that fails the charset must not reach a renderer as free text.
  assert.equal(wire.pingFrom(good({ sender_agent_id: "not an id" }), WS).senderAgentId, "");
  assert.equal(wire.pingFrom(good({ sender_agent_id: null }), WS).senderAgentId, "");
});

// ───────────────────────────────────────────────────────────────────────────
// THE LOG LINE. ⚠ This is a contract with something OUTSIDE this repo: a local external agent
// arms a background `tail -F` on it. It is not free to drift with a refactor.
// ───────────────────────────────────────────────────────────────────────────

test("DOOR: the log line's exact shape, for a desktop ping", () => {
  const p = wire.pingFrom(good(), WS);
  assert.equal(wire.logLineFor(p), `ping ${CH.slice(0, 8)} seq 12 to=${ME.slice(0, 8)} kind=done`);
});

test("DOOR: an agent ping names the AGENT, not the user, as the recipient", () => {
  const p = wire.pingFrom(
    good({ recipient_kind: "agent", recipient_agent_id: "k3wpf7c5", kind: "blocked" }),
    WS
  );
  assert.equal(wire.logLineFor(p), `ping ${CH.slice(0, 8)} seq 12 to=k3wpf7c5 kind=blocked`);
});

test("FENCE: the line is one line, whatever the body said", () => {
  // The body never reaches the line, so it cannot forge a second one — which matters
  // because a watcher wakes on a match.
  const p = wire.pingFrom(good({ body: "a\nping evil seq 9 to=x kind=done" }), WS);
  assert.equal(wire.logLineFor(p).includes("\n"), false);
  assert.equal(wire.logLineFor(p).includes("evil"), false);
});
