// C6 (F2) — main must RESOLVE a decision card it painted.
//
// THE BUG. `io.postWillGate` predicts, while the tool_use streams, whether an own-channel
// post will stop on an operator button, and the renderer paints an inline decision card from
// that prediction. `canUseTool` decides for real a moment later. Three of its four verdicts
// dispatch NOTHING — 'preapproved', a standing "allow for this session" grant, and the
// per-session auto-approve / mode bypass all return {allow} immediately — so when the
// prediction and the verdict disagree (the grant landed in between, the operator flipped the
// toggle, a replay lost the artifact) the card stayed `pending` with NO requestId: a message
// that had already been DELIVERED to the peer sat in the transcript reading "awaiting your
// approval", and the operator could not answer it because a card with no requestId hides its
// own buttons.
//
// THE FIX. On an ALLOW verdict for an own-channel post, main emits the SAME two events an
// operator Send produces, keyed on `opts.toolUseID`: `outbound_gate` (hands the card its
// requestId, or CREATES it from the authorized bytes when no artifact landed — the F5 path)
// then `permission_resolved{allow-once}` (marks it sent).
//
// ⚠ 2026-08-20 (F-228) — main/session-outbound.js IS STILL LIVE. session-query.js wraps every
// spawn's held gate with it (`wrapGate(s, axisB.makeCanUseTool(...), emitQuiet)`) — 2026-08-31,
// and the last test here is the pin on that wiring. What died is the CONSUMER end: the v1
// session window and renderer/session/session-viewmodel.js, so the three tests that folded these
// events through the real view-model to watch a card go pending -> sent are gone, replaced by
// the ⚠ block below. Everything main EMITS is still proved, event for event.
//
// main/session-outbound.js is electron-free, so the REAL wrapper is required and driven directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outbound = require(join(HERE, "..", "main", "session-outbound.js"));

const CHANNEL_TOOL = "mcp__dopl__dopl_channel";
const CH = "ch1";
const POST = { op: "send", body: "Shipping the invoice import tonight." };

function session() {
  return { channelId: CH, counterpartyName: "David" };
}
function harness(verdict, s = session()) {
  const emitted = [];
  const inner = () => Promise.resolve(verdict);
  const gated = outbound.wrapGate(s, inner, (_s, payload) => emitted.push(payload));
  return { gated, emitted };
}

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

// ⚠ DELETED 2026-08-20 (F-228) — three VIEW-MODEL tests, and the `fold()` / `lastOutbound()`
// helpers and the `vm` require they existed for. They folded the emitted pair through
// renderer/session/session-viewmodel.js and asserted on the resulting card:
//   - "the view-model resolves a stuck pending card to SENT on that pair" — the bug's own
//     repro: a `pending` artifact with requestId null ended up `sent`, still ONE artifact.
//   - "a post whose artifact never landed (replay loss) gets a card created, then sent" — the
//     F5 path, i.e. `outbound_gate` CREATING the card out of the authorized bytes.
//   - "it is IDEMPOTENT — a card the operator already resolved is never reopened" — that
//     markOutboundGated needs an open artifact and markOutboundDecided a `pending` one, so a
//     late pair could neither duplicate a sent card nor flip a DENIED one to sent.
// All three were assertions about a reducer that no longer exists. Idempotency was NEVER a
// property of main here — wrapGate emits the same pair on every allow, by design, and the
// module docblock says so — so there is nothing on this side left to assert about it. The F5
// path's MAIN half survives in the test above (`gate.text` carries the authorized bytes) and in
// the bodiless-post test below.

test("C6: a DENIED post emits nothing — the operator's own decision owns that card", async () => {
  const h = harness({ behavior: "deny", message: "Denied by operator" });
  const verdict = await h.gated(CHANNEL_TOOL, POST, { toolUseID: "t1" });
  assert.deepEqual(verdict, { behavior: "deny", message: "Denied by operator" });
  assert.deepEqual(h.emitted, [], "no synthetic resolution may contradict a deny");
});

test("C6: every NON-post call is passed through untouched (same promise, no events)", async () => {
  const h = harness({ behavior: "allow" });
  await h.gated("Bash", { command: "ls" }, { toolUseID: "t1" });
  await h.gated(CHANNEL_TOOL, { op: "rooms", action: "open", direct: true }, { toolUseID: "t2" }); // not a post
  await h.gated(CHANNEL_TOOL, { op: "send", channel: "other-channel" }, { toolUseID: "t3" }); // cross-channel
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
  await h.gated(CHANNEL_TOOL, { op: "send" }, { toolUseID: "t1" });
  assert.equal(h.emitted[0].text, "");
  assert.equal(h.emitted[1].decision, "allow-once");
});

test("C6: the engine wires the wrapper around the REAL gate and emits QUIETLY", async () => {
  const { readFileSync } = await import("node:fs");
  const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");
  // ⚠ 2026-08-31 (runtime-adapter port): the option assembly is the RUNTIME ADAPTER's, and the
  // engine's two handles — the dispatch and the replay-aware quiet emit — reach it on the
  // launch REQUEST rather than through a module-level `deps`. The WRAPPING is unchanged and is
  // what this pins: `wrapGate` is core (it observes a verdict, it never makes one) and the
  // gate it wraps is the adapter's held callback.
  const SPEC = readFileSync(join(HERE, "..", "main", "runtime", "claude", "launch-spec.js"), "utf8");
  // The third argument is the injected `log` (the gate bridge must stay electron-free, so the
  // forced-thread-tag conflict line is diag'd from here). The wrapper still only OBSERVES.
  assert.match(
    SPEC,
    /canUseTool: sessionOutbound\.wrapGate\(s, axisB\.makeCanUseTool\(s, dispatch, diag\), emitQuiet\)/,
    "the gate is unchanged; the wrapper only observes its verdict");
  const QUERY = readFileSync(join(HERE, "..", "main", "session-query.js"), "utf8");
  assert.match(QUERY, /dispatch: deps\.dispatch,\n\s*emitQuiet: deps\.emitQuiet,/,
    "…and core is what supplies both, from its own injected deps");
  // emitQuiet skips the RESHOW check: an auto-allowed post needs nothing from the operator,
  // so resolving its card must not pop a hidden window open.
  assert.match(ENGINE, /function emitQuiet\(s, payload\) \{\n\s*if \(!s\.win \|\| s\.win\.isDestroyed\(\)\) return;\n\s*s\.replay\.deliver\(payload\);/);
});
