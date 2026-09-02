// AXIS B ON THE ONE RUNTIME THAT ENFORCES IT IN-PROCESS — the whole reason this adapter exists.
//
// ⚠ WHAT THIS SUITE IS FOR, IN THE DESIGN'S OWN WORDS (step 8): "an Axis-B test asserting a
// `customTools` channel post CANNOT COMPLETE WITHOUT A CONSENT DECISION, and that the emitted post
// CARRIES THE THREAD TAG" — the two things §0.1 exists to preserve. Plus step 6a's: that these
// implementations really CALL `grantDecision` and are not concatenated into any pre-approval list,
// which is the shadow `main/agent-self-ops.js` has and this must not inherit.
//
// ⚠ AND ONE TRAP THAT IS ONLY VISIBLE HERE (F-382). `execute()` receives CORE'S verdict shape —
// `{ behavior, message?, updatedInput? }` — and translates it into a tool result only AFTERWARDS.
// Three core modules mint or read that shape, and `main/session-outbound.js › wrapGate` is the one
// that breaks silently if an adapter translates too early: it observes `verdict.behavior ===
// 'allow'` to resolve the card an allowed post painted, so a platform-worded answer upstream of it
// sails past and leaves an already-delivered post reading "awaiting your approval" forever. The
// ORDER is asserted below, not just the outcome.
//
// ⚠ NO NETWORK AND NO SDK. The forward is INJECTED into `axisBTools`, so the whole enforcement
// path is drivable from a fake `list`/`call` pair — which is the same discipline every normalizer
// in this tree runs under, applied to the one place a gate decision turns into an action.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const axisB = require(join(MAIN, "runtime", "cursor", "axis-b.js"));
const registry = require(join(MAIN, "runtime", "index.js"));

const D = registry.descriptorFor("cursor");

// The Dopl surface, as the SERVER describes it. ⚠ Never authored in the adapter: these are the
// shapes `tools/list` returns, and the adapter mirrors name/description/inputSchema rather than
// restating a schema that would drift the day a tool gains an argument.
const SERVER_TOOLS = [
  { name: "dopl_channel", description: "Read and post in the channel.", inputSchema: { type: "object" } },
  { name: "dopl_search", description: "Search the workspace.", inputSchema: { type: "object" } },
  { name: "dopl_kb", description: "Read and write the knowledge base.", inputSchema: { type: "object" } },
  { name: "dopl_kb_admin", description: "Destructive admin companion.", inputSchema: { type: "object" } },
];

/** A session shaped the way `session-io.js › grantArgs` reads one. */
function session(over) {
  return {
    runtimeId: "cursor",
    profile: "full",
    channelId: "chan-1",
    taskId: "task-9",
    agentId: "abcd1234",
    workspaceId: "",
    windowless: false,
    state: { toolMode: "allowlist", messageMode: "ask", allowForTask: [] },
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    ...over,
  };
}

/**
 * Build the surface with a recording forward. `answer` decides what the operator does with any
 * card that gets painted: 'allow', 'deny', or 'never' (leave it pending, which is the case that
 * proves the call really is blocked).
 */
async function surface(over) {
  const o = over || {};
  const s = o.session || session();
  const sent = [];
  const cards = [];
  const dispatch = (sess, event) => {
    cards.push(event);
    if (o.answer === "never") return;
    const resolve = s.pendingPermissions.get(event.requestId);
    if (!resolve) return;
    // The operator's own click, in the shape `main/session-permissions.js` mints.
    setImmediate(() => (o.answer === "allow"
      ? resolve({ behavior: "allow" })
      : resolve({ behavior: "deny", message: "Denied by operator" })));
  };
  const tools = await axisB.axisBTools({
    session: s,
    dispatch,
    emitQuiet: () => {},
    policy: o.policy === undefined ? null : o.policy,
    deny: o.deny || [],
    list: async () => (o.list || SERVER_TOOLS),
    call: async (name, args) => { sent.push({ name, args }); return { ok: true, text: "posted" }; },
  });
  return { s, tools, sent, cards, byName: (n) => tools.find((t) => t.name === n) };
}

const text = (result) => result.content.map((b) => b.text).join("");

// ── THE SURFACE ──────────────────────────────────────────────────────────────────────────────

test("the tool surface is the SERVER's own, mirrored rather than restated", () => {
  // ⚠ THE ANTI-DUPLICATION RULE APPLIED TO A SCHEMA. A hand-written `inputSchema` here would be a
  // second statement of `packages/mcp-server`'s surface — exactly what `main/session-dopl-tools.js`
  // refuses for the READ/WRITE split — and it would drift the day a tool gains an argument.
  return surface().then(({ byName }) => {
    const channel = byName("dopl_channel");
    assert.equal(channel.description, "Read and post in the channel.");
    assert.deepEqual(channel.inputSchema, { type: "object" });
    assert.equal(typeof channel.execute, "function");
  });
});

test("a profile's policy bounds WHICH tools are registered, and the deny list bounds it again", () => {
  // ⚠ BELT AND BRACES, AND BOTH ARE REAL. A tool we do not register cannot be called at all; a
  // tool that somehow arrives anyway still meets `grantDecision` step 1. A profile whose
  // containment depends on one list being applied in one place is a profile with one bug between
  // it and nothing.
  return Promise.all([
    surface({ policy: ["dopl_channel"] }).then(({ tools }) => {
      assert.deepEqual(tools.map((t) => t.name), ["dopl_channel"], "read_only's policy is the channel alone");
    }),
    surface({ deny: ["mcp__dopl__dopl_kb_admin"] }).then(({ tools }) => {
      assert.ok(!tools.some((t) => t.name === "dopl_kb_admin"), "a hard-denied tool is never registered");
      assert.ok(tools.some((t) => t.name === "dopl_channel"), "…and the rest of the surface survives");
    }),
    // A nameless row from a server that answered something odd is dropped rather than registered.
    surface({ list: [{ description: "no name" }, ...SERVER_TOOLS] }).then(({ tools }) => {
      assert.equal(tools.length, SERVER_TOOLS.length);
    }),
  ]);
});

test("a `tools/list` that fails yields NO surface and does NOT break the launch", async () => {
  // ⚠ A SESSION WITH NO DOPL TOOLS RUNS AND CAN STILL BE READ; a THROWN launch takes the whole
  // session with it for a roster read.
  const tools = await axisB.axisBTools({
    session: session(), dispatch: () => {}, emitQuiet: () => {},
    policy: null, deny: [],
    list: async () => { throw new Error("network down"); },
    call: async () => ({ ok: true, text: "" }),
  });
  assert.deepEqual(tools, []);
  // …and a request with no forward at all answers `null` rather than a half-built surface.
  assert.equal(await axisB.axisBTools({ session: session() }), null);
  assert.equal(await axisB.axisBTools(null), null);
});

// ── THE TWO THINGS §0.1 EXISTS TO PRESERVE ───────────────────────────────────────────────────

test("⚠ A CHANNEL POST CANNOT COMPLETE WITHOUT A CONSENT DECISION", async () => {
  // ⚠ THE CENTRAL CLAIM OF THE WHOLE ADAPTER. The Dopl MCP server is remote HTTP and no posture
  // field crosses the wire, so nothing but this boundary can refuse a post. `answer: 'never'`
  // leaves the card on screen: the promise must stay unresolved and NOTHING may reach the server.
  const { byName, sent, cards } = await surface({ answer: "never" });
  let settled = false;
  byName("dopl_channel").execute({ op: "send", body: "hi" }).then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(settled, false, "the call completed with no decision — the gate is not holding it");
  assert.deepEqual(sent, [], "…and nothing may reach the server while a card is pending");
  assert.equal(cards.length, 1, "a card was painted");
  assert.equal(cards[0].type, "permission_request");
  assert.equal(cards[0].payload.type, "outbound_gate", "an own-channel post takes the OUTBOUND surface");
});

test("⚠ AND AN ALLOWED POST CARRIES THE FORCED THREAD TAG, applied NATIVELY before it leaves", async () => {
  // ⚠ THE TAG IS AN INVARIANT, NOT A REQUEST — `main/session-outbound-tag.js`'s header records the
  // 2026-07-31 incident where a correct prompt was not enough and the agent omitted the argument.
  // On this runtime the rewrite has no platform mechanism to travel through: Dopl WRITES the tool,
  // so the stamp is applied to the arguments before the call leaves this process.
  const { byName, sent, s } = await surface({ answer: "allow" });
  const out = await byName("dopl_channel").execute({ op: "send", body: "hi" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, "dopl_channel");
  assert.equal(sent[0].args.thread, "task-9", "the session's own task id, never off the wire");
  assert.equal(sent[0].args.client_msg_id, "agent-abcd1234-1", "…and the per-instance fan-out stamp");
  assert.equal(sent[0].args.body, "hi", "the rest of the call is untouched");
  assert.ok(!out.isError);
  assert.equal(text(out), "posted");
  // ⚠ THE ID IS RECORDED ON THE SESSION, which is what `session-dispatch › wroteIt` reads to keep
  // an agent from being fed its own post back under fan-out. A stamp nobody recorded is no stamp.
  assert.ok(s.ownPostIds.has("agent-abcd1234-1"));
});

test("a DENIED post reaches the server not at all, and the model is told so", async () => {
  const { byName, sent } = await surface({ answer: "deny" });
  const out = await byName("dopl_channel").execute({ op: "send", body: "hi" });
  assert.deepEqual(sent, [], "a refused call must not be sent");
  // ⚠ `isError`, NOT SILENCE. The model has to be able to tell "refused" from "empty result", or
  // it retries the post it was refused — which is the fan-out shape, not a cosmetic one.
  assert.equal(out.isError, true);
  assert.match(text(out), /Denied by operator/);
});

test("a CROSS-channel post is the exfil shape: it gates, and it is never rewritten by us", async () => {
  const { byName, sent, cards } = await surface({ answer: "allow" });
  await byName("dopl_channel").execute({ op: "send", channel: "other", body: "x" });
  assert.equal(cards.length, 1, "it does not auto-allow at any posture");
  assert.equal(sent[0].args.thread, undefined, "a post to another channel is not ours to thread");
  assert.equal(sent[0].args.channel, "other", "…and the call the operator approved is what is sent");
});

// ── THE SHADOW, THE ORDER, AND THE LATCH ─────────────────────────────────────────────────────

test("these implementations are NOT in any pre-approval list — the shadow is unavailable", () => {
  // ⚠ THE INVARIANT `main/agent-self-ops.js` BREAKS AND THIS MUST NOT INHERIT. Its two verbs ride
  // `allowedTools` and are therefore shadowed past the gate entirely; that is defensible for a
  // display verb and indefensible for a channel op, which is the call that HAS to gate.
  for (const profile of ["read_only", "dopl_only", "full"]) {
    assert.deepEqual(registry.runtimeFor("cursor").toolConfigFor(profile).preApproved, [], profile);
  }
  const opsNames = require(join(MAIN, "agent-self-ops.js")).AGENT_OPS_TOOL_NAMES;
  return surface().then(({ tools }) => {
    for (const t of tools) {
      assert.ok(!opsNames.includes(t.name), `${t.name} collides with the shadowed agent-ops surface`);
    }
  });
});

test("⚠ F-382: the gate answers CORE's `{behavior}` shape, and only then is it translated", async () => {
  // ⚠ THE ORDER IS THE TRAP, NOT THE OUTCOME. `main/session-outbound.js › wrapGate` observes
  // `verdict.behavior === 'allow'` to resolve the card an allowed post painted; an adapter that
  // translated to a platform word BEFORE that wrapper saw it would leave an already-delivered post
  // reading "awaiting your approval" forever. Driven here on the raw gate rather than inferred.
  const s = session({ state: { toolMode: "allowlist", messageMode: "auto_outbound", allowForTask: [] } });
  const gate = axisB.makeGate(s, () => {}, () => {});
  const verdict = await gate("mcp__dopl__dopl_channel", { op: "send", body: "hi" }, { toolUseID: "tc_1" });
  assert.equal(verdict.behavior, "allow", "the gate must answer core's vocabulary, not Cursor's");
  assert.ok(!("content" in verdict), "a tool result at this seam is a translation that happened too early");
  // The tag rides that allow as `updatedInput`, which is how core expresses a rewrite on a verdict.
  assert.equal(verdict.updatedInput.thread, "task-9");
  // …and the translation to this platform's shape is a separate step, with the same information.
  const translated = require(join(MAIN, "runtime", "cursor", "approval.js")).answerApproval({ text: "ok" }, "allow");
  assert.ok(Array.isArray(translated.content));
});

test("a gate with NO DISPATCH denies, because a question nobody can be asked is answered `no`", async () => {
  // ⚠ FAIL CLOSED. `decision.park` paints a card through the engine's dispatch; a session wired
  // without one has no surface to ask on, and allowing here would make an unwired harness the
  // widest posture in the tree.
  const gate = axisB.makeGate(session(), null, () => {});
  const verdict = await gate("mcp__dopl__dopl_channel", { op: "send", body: "hi" }, {});
  assert.equal(verdict.behavior, "deny");
  assert.match(verdict.message, /no surface/);
});

test("after close(), every Dopl tool refuses — and it is a mitigation, not an interrupt", async () => {
  // ⚠ THE ONE THING DOPL CAN REALLY STOP ON THIS RUNTIME (§5 item X0). An ended session cannot
  // post, read the channel or write the workspace, whatever it is still doing on its own side.
  // The RUN keeps going, which is exactly why `session.interrupt` stays `'unverified'` and the
  // Stop control is refused rather than this being treated as an answer to X0.
  const { s, byName, sent } = await surface({ answer: "allow" });
  axisB.closeSession(s);
  const out = await byName("dopl_channel").execute({ op: "send", body: "hi" });
  assert.equal(out.isError, true);
  assert.match(text(out), /ended/);
  assert.deepEqual(sent, [], "a closed session reaches the server not at all");
  assert.equal(D.session.interrupt, "unverified", "…and this does not make the runtime stoppable");
});

test("a forward that FAILS is reported as a refusal, not as a delivery", async () => {
  // ⚠ THE DIRECTION MATTERS. Telling an agent its post landed when it did not is how a thread goes
  // silent while everyone believes it was answered.
  const s = session({ state: { toolMode: "allowlist", messageMode: "auto_outbound", allowForTask: [] } });
  const tools = await axisB.axisBTools({
    session: s, dispatch: () => {}, emitQuiet: () => {}, policy: null, deny: [],
    list: async () => SERVER_TOOLS,
    call: async () => ({ ok: false, text: "Dopl MCP answered HTTP 503" }),
  });
  const out = await tools.find((t) => t.name === "dopl_channel").execute({ op: "send", body: "hi" });
  assert.equal(out.isError, true);
  assert.match(text(out), /503/);
});

test("the call id is read tolerantly and is NULL rather than minted when absent", () => {
  // ⚠ §5 ITEM X16. The consent card the STREAM paints and the card the GATE paints join on this
  // id; nothing in the research says an `execute()` implementation is handed the stream's
  // `call_id`. A MINTED id would be worse than none — it would join the gate's card to nothing
  // while LOOKING joined, and the renderer would resolve an artifact that does not exist.
  assert.equal(axisB.callIdOf({ call_id: "tc_1" }), "tc_1");
  assert.equal(axisB.callIdOf({ toolCallId: "tc_2" }), "tc_2");
  assert.equal(axisB.callIdOf({}), null);
  assert.equal(axisB.callIdOf(undefined), null);
  assert.equal(axisB.callIdOf({ call_id: 42 }), null, "a non-string id is not an id");
});
