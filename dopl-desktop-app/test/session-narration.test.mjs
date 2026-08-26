// THE NARRATION RING (main/session-narration.js) — the agent window's work lane, F-212.
//
// Three properties, and the first one is a SECURITY property rather than a correctness one:
//
//  - **`inputFull` MUST NEVER ENTER A RING ENTRY.** `session-io.js › sdkRenderEvents` puts
//    both a capped `inputSummary` and an UNCAPPED `inputFull` on every `tool_use` payload;
//    the second exists for the session window's expandable card and can carry an entire
//    file's contents. This feed crosses to a renderer and fans out to every app window.
//  - **THE RING IS BOUNDED AT THE SOURCE**, and the bound is MULTIPLICATIVE against
//    `MAX_CONCURRENT_SESSIONS` (INVARIANTS §11 — every per-session bound is). An unbounded
//    ring on a long-running agent is a memory leak nothing sweeps.
//  - **AN EVENT THIS LANE HAS NOTHING TO SAY ABOUT PRODUCES NO ENTRY.** `note` runs inside
//    the engine's dispatch funnel on EVERY SDK event, so the fast path has to be a null.
//
// Run: `node --test dopl-desktop-app/test/session-narration.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "session-narration.js"), "utf8");
const m = createRequire(import.meta.url)(join(MAIN, "session-narration.js"));

const NOW = 1_700_000_000_000;

// ── 1. THE SECURITY PROPERTY ─────────────────────────────────────────────────────────

test("SAFETY: a tool entry carries the SUMMARY and never `inputFull`", () => {
  const entry = m.entryFor(
    {
      type: "tool_use",
      payload: {
        toolUseId: "tu-1",
        name: "Read",
        inputSummary: '{"file":"/Users/sam/secrets.env"}',
        // The real payload's other half — unbounded by construction.
        inputFull: { file: "/Users/sam/secrets.env", contents: "A".repeat(50_000) },
      },
    },
    NOW
  );
  assert.equal(entry.kind, "tool");
  assert.equal("inputFull" in entry, false, "inputFull must never enter the ring");
  // And nothing else smuggles it either: the whole entry is small.
  assert.ok(JSON.stringify(entry).length < 600);
});

test("SAFETY: the module never reads `inputFull` at all", () => {
  // A structural belt on the case above: the field is not READ anywhere, so a future edit
  // that reaches for it is a visible change rather than a silent widening.
  // ⚠ CODE ONLY — comments are blanked first, the same concession `app-windows.test.mjs`
  // makes for the same reason: this module's header names `inputFull` deliberately, to
  // explain why it is excluded, and a check that punished the explanation would get the
  // explanation deleted.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.equal(/inputFull/.test(code), false);
});

test("SAFETY: every text field is bounded and single-line", () => {
  const long = "x".repeat(5_000);
  const entry = m.entryFor(
    { type: "assistant", payload: { text: `first\nsecond\t${long}` } },
    NOW
  );
  assert.ok(entry.text.length <= 300);
  assert.equal(/[\r\n\t]/.test(entry.text), false);
  const tool = m.entryFor(
    { type: "tool_use", payload: { name: long, inputSummary: long } },
    NOW
  );
  assert.ok(tool.tool.length <= 40);
  assert.ok(tool.text.length <= 300);
});

// ── 2. THE VOCABULARY ────────────────────────────────────────────────────────────────

test("KINDS: the five an agent-window row can render, and nothing else", () => {
  const cases = [
    [{ type: "assistant", payload: { text: "hi" } }, "assistant"],
    [{ type: "tool_use", payload: { name: "Bash", inputSummary: "ls" } }, "tool"],
    [{ type: "tool_result", payload: { toolUseId: "t", ok: true, resultSummary: "done" } }, "result"],
    [{ type: "outbound_post", payload: { text: "sent it" } }, "post"],
    [{ type: "idle_timeout" }, "status"],
    // 2026-08-22 — the three kinds Samuel's narration ruling added.
    [{ type: "thinking", payload: { text: "weighing two options" } }, "thinking"],
    [{ type: "steer", private: true, rawText: "what did they decide?" }, "operator"],
  ];
  for (const [event, kind] of cases) {
    assert.equal(m.entryFor(event, NOW).kind, kind, event.type);
  }
});

// 2026-08-25 (Samuel's outbound-review ruling) — the gate is a FACT ABOUT THE FRAME, and the
// work stream's card is the review surface. A post that is still waiting on the operator's
// Send must not arrive looking like one that left the machine.
test("KINDS: a GATED post carries pending:true, and an ungated one carries no flag at all", () => {
  const gated = m.entryFor(
    { type: "outbound_post", payload: { text: "draft", pending: true, ownChannel: true } },
    NOW
  );
  assert.equal(gated.kind, "post");
  assert.equal(gated.lane, "channel");
  assert.equal(gated.pending, true);

  const plain = m.entryFor({ type: "outbound_post", payload: { text: "sent it" } }, NOW);
  assert.equal("pending" in plain, false, "an ungated post must be byte-identical to before");
});

test("KINDS: only an EXPLICIT true gates — a truthy string never reads as pending", () => {
  // Fail-suspicious, the same way `session-io.js` reads `ownChannel`: anything but `true`
  // is "not gated", so a malformed payload can never paint a Post button over a sent post.
  for (const pending of ["true", 1, {}, null, undefined]) {
    const entry = m.entryFor({ type: "outbound_post", payload: { text: "x", pending } }, NOW);
    assert.equal("pending" in entry, false, String(pending));
  }
});

// 2026-08-25 — THE GATE NOTE AND THE CARD ARE THE SAME EVENT, so only one of them speaks.
// Samuel saw "Waiting for permission" sitting under a post that had already been delivered:
// this ring is append-only, so a transient line written here is permanent.
test("KINDS: an OUTBOUND post gate emits NO status line — the card carries it", () => {
  const entry = m.entryFor(
    { type: "permission_request", payload: { type: "outbound_gate", requestId: "r1" } },
    NOW
  );
  assert.equal(entry, null);
});

// 2026-08-25 (F-321) — a POST gate rides its own outbound_post frame, but a
// CREATE_THREAD gate has none: it renders as a plain tool_use. Without a pending
// frame here the operator saw a dopl_channel row then silence to the 24h TTL. The
// gate is stamped `threadOpen`, and this branch mints the SAME pending sent-lane
// frame a post gets so the card renders a Send control.
test("KINDS: a CREATE_THREAD gate DOES surface a pending sent-lane frame", () => {
  const entry = m.entryFor(
    {
      type: "permission_request",
      payload: {
        type: "outbound_gate",
        requestId: "r2",
        threadOpen: true,
        text: "the requester's initial request",
      },
    },
    NOW
  );
  assert.ok(entry, "a threadOpen gate must not go silent");
  assert.equal(entry.kind, "post");
  assert.equal(entry.lane, "channel"); // the SPA maps this to the sent lane + its Send card
  assert.equal(entry.pending, true);
  assert.equal(entry.text, "the requester's initial request");
});

test("KINDS: only a THREAD-OPEN gate speaks — a post gate without the flag stays silent", () => {
  // The discriminator is explicit, so a post gate (no threadOpen) is byte-for-byte
  // the null it was, and the two never cross.
  assert.equal(
    m.entryFor(
      { type: "permission_request", payload: { type: "outbound_gate", threadOpen: false, text: "x" } },
      NOW
    ),
    null
  );
});

test("KINDS: the DOCK's tool gate still speaks — it has no card to say it", () => {
  const entry = m.entryFor(
    { type: "permission_request", payload: { type: "permission_request", name: "Bash" } },
    NOW
  );
  assert.equal(entry.kind, "status");
  assert.equal(entry.text, "Waiting for permission");
  // ⚠ A payload-less gate is NOT an outbound one — it keeps the line rather than
  // going silent on a shape this branch does not recognise.
  assert.equal(m.entryFor({ type: "permission_request" }, NOW).text, "Waiting for permission");
});

test("KINDS: the RAW tool name rides, because the RENDERER shortens it", () => {
  // ⚠ ONE shortener, at render, shared with the pill's `detail` — two would name the same
  // call two different ways on one screen (F-139's rule about the client's server segment).
  const entry = m.entryFor(
    { type: "tool_use", payload: { name: "mcp__dopl__dopl_channel", inputSummary: "{}" } },
    NOW
  );
  assert.equal(entry.tool, "mcp__dopl__dopl_channel");
});

test("KINDS: a result carries ok:false so a failure can be toned differently", () => {
  const bad = m.entryFor({ type: "tool_result", payload: { ok: false } }, NOW);
  assert.equal(bad.ok, false);
  // ⚠ ABSENT means OK, not failed: an older payload without the flag must not paint every
  // result red.
  assert.equal(m.entryFor({ type: "tool_result", payload: {} }, NOW).ok, true);
});

test("KINDS: a result joins its CALL by toolUseId — this module invents no name", () => {
  // The SDK gives a tool_result an id and nothing else. Inventing a name here would be a
  // second, wrong answer to "which call was that".
  const entry = m.entryFor({ type: "tool_result", payload: { toolUseId: "tu-7" } }, NOW);
  assert.equal(entry.toolUseId, "tu-7");
  assert.equal("tool" in entry, false);
});

test("NOTHING TO SAY: an unremarkable event produces NO entry", () => {
  // ⚠ THE FAST PATH. `note` runs on every SDK event inside the dispatch funnel.
  for (const event of [
    { type: "context", payload: { tokens: 1 } },
    { type: "result" },
    { type: "modes" },
    { type: "unknown-future-event" },
    null,
    undefined,
    {},
  ]) {
    assert.equal(m.entryFor(event, NOW), null, JSON.stringify(event));
  }
});

test("NOTHING TO SAY: an assistant turn with no text is not a line", () => {
  assert.equal(m.entryFor({ type: "assistant", payload: { text: "" } }, NOW), null);
  assert.equal(m.entryFor({ type: "assistant", payload: {} }, NOW), null);
});

// ── 3. THE BOUND ─────────────────────────────────────────────────────────────────────

test("RING: it is bounded, and it drops the OLDEST", () => {
  const s = {};
  for (let i = 0; i < m.NARRATION_MAX + 50; i += 1) {
    m.push(s, { at: NOW + i, kind: "status", text: `#${i}` });
  }
  assert.equal(s.narration.length, m.NARRATION_MAX);
  assert.equal(s.narration[s.narration.length - 1].text, `#${m.NARRATION_MAX + 49}`);
  assert.equal(s.narration[0].text, "#50", "the oldest 50 were dropped");
});

test("RING: the bound is small enough to be multiplicative-safe", () => {
  // INVARIANTS §11: every per-session bound is multiplied by MAX_CONCURRENT_SESSIONS.
  // This is a sanity floor on the arithmetic in the module header, not a tuning knob.
  assert.ok(m.NARRATION_MAX > 0 && m.NARRATION_MAX <= 500);
});

test("RING: it dies with the session — nothing persists it and nothing sweeps it", () => {
  // The retention argument `session-summary.js` makes for an ended pill: the channel
  // transcript is the record, this is a view of a run.
  assert.equal(/electron-store|writeFile|saveRecord/.test(SRC), false);
  assert.deepEqual(m.ringFor(null), []);
  assert.deepEqual(m.ringFor({}), []);
});

test("RING: `ringFor` hands back a COPY — a renderer frame cannot mutate the ring", () => {
  const s = {};
  m.push(s, { at: NOW, kind: "status", text: "one" });
  const ring = m.ringFor(s);
  ring.push({ at: NOW, kind: "status", text: "forged" });
  assert.equal(s.narration.length, 1);
});

// ── 4. THE STAMP ─────────────────────────────────────────────────────────────────────

test("NOTE: it is inert on junk rather than throwing into the SDK event loop", () => {
  for (const bad of [null, undefined, {}, { key: "" }]) {
    m.note(bad, { type: "assistant", payload: { text: "hi" } });
  }
  const s = { key: "c:t" };
  m.note(s, null);
  assert.equal(s.narration, undefined, "an event with nothing to say allocates no ring");
});

test("NOTE: a session with something to say gets a ring keyed to it", () => {
  const s = { key: "c:t" };
  m.note(s, { type: "tool_use", payload: { name: "Bash", inputSummary: "ls" } });
  assert.equal(s.narration.length, 1);
  assert.equal(s.narration[0].kind, "tool");
});

// ── 5. THE FAN-OUT ───────────────────────────────────────────────────────────────────

test("PUSH: it fans out over the app-window REGISTRY, like every other main->renderer push", () => {
  // INVARIANTS §11: "EVERY MAIN→RENDERER PUSH FANS OUT OVER THE REGISTRY, or the pop-out is
  // stale with no error anywhere." Three pushes were widened in Phase 10 for exactly this.
  assert.match(SRC, /appWindows\.liveWindows\(\)/);
  assert.match(SRC, /for \(const win of wins\)/);
});

test("PUSH: frames are keyed by sessionKey so a window can filter", () => {
  // Main deliberately tracks no subscriptions — a subscription protocol's only failure mode
  // is the two sides going out of step, and the filter here is a string compare.
  assert.match(SRC, /sessionKey: key/);
});

// ── THE 2026-08-22 KINDS: thinking, and the 1:1 lane in both directions ──────────────
//
// ⚠ FOUR TEXT KINDS EXIST BECAUSE THEY ARE FOUR AUDIENCES, not four stylings. `post` LEFT THE
// MACHINE and the counterparty has it. `private-in` / `private-reply` are the operator's 1:1
// lane and nobody else can ever see them. `assistant` is the agent narrating a public turn, and
// `thinking` is addressed to nobody. Collapsing any pair makes the view claim something was
// shared when it was not, or the reverse — which is the whole point of the private turn.

test("THINKING: it rides as its own kind and is bounded like every other caption", () => {
  const entry = m.entryFor({ type: "thinking", payload: { text: "x".repeat(1000) } }, NOW);
  assert.equal(entry.kind, "thinking");
  assert.equal(entry.text.length, 300, "a reasoning block is unbounded by construction");
  // Nothing to say is nothing to push — the ring is not padded with empty lines.
  assert.equal(m.entryFor({ type: "thinking", payload: { text: "   " } }, NOW), null);
  assert.equal(m.entryFor({ type: "thinking", payload: {} }, NOW), null);
});

test("OPERATOR: it shows what the OPERATOR TYPED, never the framed prompt", () => {
  // ⚠ `text` on a steer is `frameOperatorTurn`'s output — an instruction to a model, complete
  // with nonce fences and the private contract. It is not a caption for a human. `rawText`
  // rides beside it for exactly this.
  const entry = m.entryFor(
    { type: "steer", private: true, rawText: "check the thread", text: "BEGIN-OPERATOR-n0nce..." },
    NOW
  );
  assert.equal(entry.kind, "operator");
  assert.equal(entry.lane, "operator", "the LANE is the fact; a kind rename must not move it");
  assert.equal(entry.text, "check the thread");
});

test("OPERATOR: an ORDINARY steer still produces nothing", () => {
  // Only the 1:1 lane sets `private`. A steer from anywhere else is not an operator message and
  // must not be drawn as one.
  assert.equal(m.entryFor({ type: "steer", rawText: "x" }, NOW), null);
  assert.equal(m.entryFor({ type: "steer", private: false, rawText: "x" }, NOW), null);
  assert.equal(m.entryFor({ type: "steer", private: true }, NOW), null, "and an empty one is nothing");
});

test("PRIVATE: an `assistant` line inside a private turn is re-tagged, and only that", () => {
  const line = { at: NOW, kind: "assistant", text: "they decided to ship" };
  assert.equal(m.retagPrivate(line, true).kind, "private");
  assert.equal(m.retagPrivate(line, true).lane, "private", "the LANE outranks the kind");
  assert.equal(m.retagPrivate(line, true).text, "they decided to ship", "the text is untouched");
  assert.equal(m.retagPrivate(line, false).kind, "assistant");
  // ⚠ ONLY `assistant` MOVES. A post inside a private turn is the ONE thing that did not stay
  // private — mislabelling it would hide exactly that.
  for (const kind of ["post", "tool", "result", "status", "thinking"]) {
    assert.equal(m.retagPrivate({ at: NOW, kind }, true).kind, kind, kind);
  }
  assert.equal(m.retagPrivate(null, true), null);
});

test("PRIVATE: the re-tag does not MUTATE the entry it was given", () => {
  // `entryFor`'s result is pushed into the ring; mutating in place would retro-tag a line that
  // is already on a renderer's screen if the two ever shared an object.
  const line = { at: NOW, kind: "assistant", text: "hi" };
  m.retagPrivate(line, true);
  assert.equal(line.kind, "assistant");
});
