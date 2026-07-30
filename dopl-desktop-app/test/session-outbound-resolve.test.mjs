// C6 (F2) — main must RESOLVE a decision card it painted.
//
// THE BUG. `io.postWillGate` predicts, while the tool_use streams, whether an own-channel
// post will stop on an operator button, and the renderer paints the inline decision card from
// that prediction. `canUseTool` decides for real a moment later. Three of its four verdicts
// dispatch NOTHING — 'preapproved', a standing "allow for this session" grant, and the
// per-session auto-approve / mode bypass all return {allow} immediately — so when the
// prediction and the verdict disagree (the grant landed in between, the operator flipped the
// toggle, a replay lost the artifact) the card stayed `pending` with NO requestId: a message
// that had already been DELIVERED to the peer sat in the transcript reading "awaiting your
// approval", and the operator could not answer it because a card with no requestId hides its
// own buttons (session-render makeOutbound: `answerable = pending && !!cur.requestId`).
//
// THE FIX. On an ALLOW verdict for an own-channel post, main emits the SAME two events an
// operator Send produces, keyed on `opts.toolUseID`: `outbound_gate` (hands the card its
// requestId, or CREATES it from the authorized bytes when no artifact landed — the F5 path)
// then `permission_resolved{allow-once}` (marks it sent). No view-model change is needed.
//
// main/session-outbound.js is electron-free, so the REAL wrapper is required and driven
// directly, and its events are folded through the REAL view-model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outbound = require(join(HERE, "..", "main", "session-outbound.js"));
const vm = require(fileURLToPath(new URL("../renderer/session/session-viewmodel.js", import.meta.url)));

const CHANNEL_TOOL = "mcp__dopl__dopl_channel";
const CH = "ch1";
const POST = { op: "post", body: "Shipping the invoice import tonight." };

function session() {
  return { channelId: CH, counterpartyName: "David" };
}
function harness(verdict, s = session()) {
  const emitted = [];
  const inner = () => Promise.resolve(verdict);
  const gated = outbound.wrapCanUseTool(s, inner, (_s, payload) => emitted.push(payload));
  return { gated, emitted };
}
const fold = (events, seed) => events.reduce((st, ev) => vm.reduceEvent(st, ev), seed);
const lastOutbound = (st) => st.items.filter((i) => i.kind === "outbound").pop();

test("C6: an auto-allowed own-channel post emits gate + resolved, keyed on the tool_use id", async () => {
  const h = harness({ behavior: "allow" });
  const verdict = await h.gated(CHANNEL_TOOL, POST, { toolUseID: "t1" });
  assert.deepEqual(verdict, { behavior: "allow" }, "the verdict itself is passed through untouched");
  assert.deepEqual(h.emitted.map((e) => e.type), ["outbound_gate", "permission_resolved"]);
  const [gate, resolved] = h.emitted;
  assert.equal(gate.toolUseId, "t1", "keyed on opts.toolUseID, which is what the card carries");
  assert.equal(gate.ownChannel, true);
  assert.equal(gate.text, POST.body, "the authorized bytes, so a re-created card shows what was sent");
  assert.equal(gate.to, "David", "a display NAME, never a channel id (§H-9)");
  assert.equal(resolved.requestId, gate.requestId, "the pair agrees on one id");
  assert.equal(resolved.decision, "allow-once");
});

test("C6: the view-model resolves a stuck pending card to SENT on that pair", () => {
  const h = harness({ behavior: "allow" });
  // The stream-time artifact main painted from the (now stale) gate prediction.
  let st = fold([
    { type: "init", from: "David" },
    { type: "outbound_post", toolUseId: "t1", to: "David", text: POST.body, pending: true, ownChannel: true },
  ], vm.initialState());
  assert.equal(lastOutbound(st).status, "pending", "before the fix this is where it stayed");
  assert.equal(lastOutbound(st).requestId, null, "with no requestId, so its buttons are hidden");
  return h.gated(CHANNEL_TOOL, POST, { toolUseID: "t1" }).then(() => {
    st = fold(h.emitted, st);
    assert.equal(lastOutbound(st).status, "sent", "the delivered message now reads as delivered");
    assert.equal(st.items.filter((i) => i.kind === "outbound").length, 1, "and it is still ONE artifact");
  });
});

test("C6: a post whose artifact never landed (replay loss) gets a card created, then sent", async () => {
  const h = harness({ behavior: "allow" });
  await h.gated(CHANNEL_TOOL, POST, { toolUseID: "t9" });
  const st = fold(h.emitted, vm.initialState());
  const card = lastOutbound(st);
  assert.equal(card.status, "sent");
  assert.equal(card.text, POST.body, "created from the authorized bytes (the F5 path)");
});

test("C6: a DENIED post emits nothing — the operator's own decision owns that card", async () => {
  const h = harness({ behavior: "deny", message: "Denied by operator" });
  const verdict = await h.gated(CHANNEL_TOOL, POST, { toolUseID: "t1" });
  assert.deepEqual(verdict, { behavior: "deny", message: "Denied by operator" });
  assert.deepEqual(h.emitted, [], "no synthetic resolution may contradict a deny");
});

test("C6: it is IDEMPOTENT — a card the operator already resolved is never reopened", async () => {
  const h = harness({ behavior: "allow" });
  // The GATED path: the operator answered, so the card is already sent under ITS requestId.
  let st = fold([
    { type: "outbound_post", toolUseId: "t1", to: "David", text: POST.body, pending: true, ownChannel: true },
    { type: "outbound_gate", requestId: "r1", toolUseId: "t1", ownChannel: true, text: POST.body, to: "David" },
    { type: "permission_resolved", requestId: "r1", decision: "allow-once" },
  ], vm.initialState());
  assert.equal(lastOutbound(st).status, "sent");
  await h.gated(CHANNEL_TOOL, POST, { toolUseID: "t1" });
  const after = fold(h.emitted, st);
  assert.equal(lastOutbound(after).status, "sent", "still sent, still one card");
  assert.equal(after.items.filter((i) => i.kind === "outbound").length, 1);
  // A DENIED card is likewise never flipped to sent by a late pair for the SAME tool_use.
  const h2 = harness({ behavior: "allow" });
  await h2.gated(CHANNEL_TOOL, POST, { toolUseID: "t2" });
  let denied = fold([
    { type: "outbound_post", toolUseId: "t2", to: "David", text: POST.body, pending: true, ownChannel: true },
    { type: "outbound_gate", requestId: "r2", toolUseId: "t2", ownChannel: true, text: POST.body, to: "David" },
    { type: "permission_resolved", requestId: "r2", decision: "deny" },
  ], vm.initialState());
  assert.equal(lastOutbound(denied).status, "not_sent");
  denied = fold(h2.emitted, denied);
  assert.equal(lastOutbound(denied).status, "not_sent", "a deny is final");
  assert.equal(denied.items.filter((i) => i.kind === "outbound").length, 1, "and no duplicate card appears");
});

test("C6: every NON-post call is passed through untouched (same promise, no events)", async () => {
  const h = harness({ behavior: "allow" });
  await h.gated("Bash", { command: "ls" }, { toolUseID: "t1" });
  await h.gated(CHANNEL_TOOL, { op: "open", direct: true }, { toolUseID: "t2" }); // not a post
  await h.gated(CHANNEL_TOOL, { op: "post", channel: "other-channel" }, { toolUseID: "t3" }); // cross-channel
  assert.deepEqual(h.emitted, [], "only an OWN-channel post has a card to resolve");
});

test("C6: a call with no tool_use id resolves nothing (there is no card to key on)", async () => {
  const h = harness({ behavior: "allow" });
  await h.gated(CHANNEL_TOOL, POST, {});
  await h.gated(CHANNEL_TOOL, POST, undefined);
  assert.deepEqual(h.emitted, []);
});

test("C6: a bodiless post still resolves its card (text degrades to '')", async () => {
  const h = harness({ behavior: "allow" });
  await h.gated(CHANNEL_TOOL, { op: "post" }, { toolUseID: "t1" });
  assert.equal(h.emitted[0].text, "");
  assert.equal(h.emitted[1].decision, "allow-once");
});

test("C6: the engine wires the wrapper around the REAL gate and emits QUIETLY", async () => {
  const { readFileSync } = await import("node:fs");
  const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");
  assert.match(ENGINE, /canUseTool: sessionOutbound\.wrapCanUseTool\(s, io\.makeCanUseTool\(s, dispatch\), emitQuiet\)/,
    "the gate is unchanged; the wrapper only observes its verdict");
  // emitQuiet skips the RESHOW check: an auto-allowed post needs nothing from the operator,
  // so resolving its card must not pop a hidden window open.
  assert.match(ENGINE, /function emitQuiet\(s, payload\) \{\n\s*if \(!s\.win \|\| s\.win\.isDestroyed\(\)\) return;\n\s*s\.replay\.deliver\(payload\);/);
});
