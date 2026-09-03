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
  // ⚠ PROSE, NOT A CAPTION, SINCE 2026-08-27 — bounded at `PROSE_CAP`, which is the UI's own
  // expanded ceiling. Still BOUNDED, which is what this case is about.
  assert.ok(entry.text.length <= m.PROSE_CAP);
  // ⚠ **PROSE KEEPS ITS NEWLINES SINCE 2026-08-31 (F-376b), AND THIS CASE ASSERTED THE BUG.**
  // It required `\n` to be gone from an `assistant` frame — which is what deleted every heading,
  // bullet, numbered step and fenced code block on the way to the operator's panel, on the one
  // class of frame this ring is the ONLY copy of. Prose is bounded by CHARACTERS and never by
  // SHAPE. ⚠ WHAT IS STILL NORMALIZED: `\r` and `\t` (one spelling of a break; a tab inside a
  // line is a horizontal run and collapses), so those two stay asserted.
  assert.equal(/[\r\t]/.test(entry.text), false);
  assert.match(entry.text, /^first\nsecond /, "the break survives; the tab collapsed");
  const tool = m.entryFor(
    { type: "tool_use", payload: { name: long, inputSummary: long } },
    NOW
  );
  assert.ok(tool.tool.length <= 40);
  // ⚠ THE CAPTIONS DID NOT MOVE, and must not: `inputSummary` is already 140 by the time it gets
  // here (`session-io.js › summarizeInput`) and `inputFull` never enters the ring at all.
  assert.ok(tool.text.length <= 300);
  const result = m.entryFor(
    { type: "tool_result", payload: { toolUseId: "t", ok: true, resultSummary: long } },
    NOW
  );
  assert.equal(result.text.length, 300, "a tool result is a caption ABOUT a payload");
});

/**
 * THE AGENT'S PROSE SURVIVES TO THE UI'S OWN CEILING (Samuel, live review 2026-08-27).
 *
 * ⚠ THE BUG THIS PINS WAS INVISIBLE FROM THE RENDERER. `assistant` / `thinking` / the operator's
 * own 1:1 text were capped at 300 HERE, so the SPA's "Show more" — which raises a DISPLAY clamp
 * from 140 to 2000 — expanded onto a string that had already been cut, mid-word, with no marker.
 * The reader pressed the control meant to undo the truncation and the text stayed cut.
 *
 * ⚠ THE NUMBER IS `agent-stream-log.tsx › EXPANDED_CHARS`, so main is never the one doing a cut
 * nobody is told about; past it the UI clips AND SAYS SO.
 */
/**
 * ⚠ THE POST CAP HAD NO PIN ON EITHER SIDE UNTIL 2026-08-28, AND IT IS THE ONE CAP A DRIFT
 * BREAKS SILENTLY. `PROSE_CAP` above is pinned here and `EXPANDED_CHARS` is bracketed by the
 * SPA's own render tests, but `POST_CAP` was asserted nowhere in this tree — `grep -rn POST_CAP
 * dopl-desktop-app/test/` returned nothing — and the SPA only brackets it from ABOVE
 * (`agent-stream-consent.test.tsx` re-slices at a hand-written 1000, which still passes if both
 * caps drop together).
 *
 * ⚠ AND THE DIRECTION THAT BREAKS IS *THIS* SIDE GOING SHORTER. `channels-v2/agent-stream-model.ts
 * › postEcho` runs the frame text (already cut HERE) and the untruncated server body through one
 * normalizer and joins them on equality. If this cap drops below the web's, a long post gives the
 * two chains different prefixes, the join never matches, and the Post card reads **Pending
 * forever over a message that was delivered**. So this number is the web copy's UPPER bound, and
 * lowering it is the mutation that must go red here rather than in production.
 */
test("POST: the outbound echo cap is the SPA's join constant, character for character", () => {
  assert.equal(
    m.POST_CAP,
    1000,
    "`channels-v2/agent-stream-model.ts › POST_CAP` joins against this — change both or neither"
  );
  // ⚠ AND IT IS THE CAP THE POST BRANCH ACTUALLY APPLIES, not just a constant that agrees with
  // the SPA while the code uses another one.
  const entry = m.entryFor(
    { type: "outbound_post", payload: { text: "z".repeat(5_000) } },
    NOW
  );
  assert.equal(entry.text.length, m.POST_CAP, "a post was not cut at POST_CAP");
  // ⚠ AND IT IS NOT THE PROSE CAP. The two are different numbers for different reasons (a post
  // is an ECHO the transcript also holds; prose has no second copy) and collapsing them is the
  // drift this pins against.
  assert.notEqual(m.POST_CAP, m.PROSE_CAP);
});

test("PROSE: the agent's own words reach the UI's ceiling, not the caption cap", () => {
  const long = "y".repeat(m.PROSE_CAP + 5_000);
  // ⚠ 8000 SINCE 2026-08-31 — `session-directed.js › REPLY_CAP`'s number: the operator's own
  // panel must not show LESS of a private reply than the MCP mailbox carries off-machine.
  assert.equal(m.PROSE_CAP, 8000, "the SPA's EXPANDED_CHARS — change both or neither");
  for (const type of ["assistant", "thinking"]) {
    const entry = m.entryFor({ type, payload: { text: long } }, NOW);
    assert.equal(entry.text.length, m.PROSE_CAP, `${type} was cut at the caption cap`);
    // ⚠ THE CUT CONFESSES (2026-08-31, Samuel's cutoff report). The cap EQUALS the UI's expanded
    // ceiling, so the renderer's own `length >` clip check is false on every line cut here — the
    // flag is the only marker that can ever reach the reader, and the tail exists nowhere.
    assert.equal(entry.truncated, true, `${type} was cut without saying so`);
  }
  // What the operator TYPED is a message too, and the 1:1 lane posts nothing — this ring is the
  // only copy of those words anywhere.
  const steer = m.entryFor(
    { type: "steer", private: true, rawText: long, payload: {} },
    NOW
  );
  assert.equal(steer.text.length, m.PROSE_CAP);
  assert.equal(steer.truncated, true, "the operator's own cut line must say so too");
  // ⚠ AND A LINE THAT FITS IS RETURNED WHOLE — no ellipsis, no tail, byte-for-byte. `truncated`
  // is ABSENT rather than false: absent-means-unremarkable, the discipline `pending` carries.
  const whole = "the tests are green and I pushed the branch";
  const fit = m.entryFor({ type: "assistant", payload: { text: whole } }, NOW);
  assert.equal(fit.text, whole);
  assert.equal("truncated" in fit, false, "a line that fits carries no flag");
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

// 2026-08-25 (F-321), CLOSED BY THE COLLAPSE 2026-09-02 (B8) — a POST gate rides
// its own `outbound_post` frame, and a CREATE_THREAD gate had none: it rendered as
// a plain `tool_use`, so without a pending frame minted here the operator saw a
// `dopl_channel` row and then silence to the 24h TTL. That op is `send(thread="new")`
// now and an escalation is `send(kind="decision")`, so both are `isOutboundPost` and
// `renderEvents` emits the frame for them. The `threadOpen` discriminator is deleted
// at its source; minting a second frame here would be the DUPLICATE the branch above
// this one exists to avoid.
test("KINDS: every outbound gate stays silent — its own outbound_post frame carries the card", () => {
  for (const payload of [
    { type: "outbound_gate", requestId: "r2", text: "the requester's initial request" },
    // ⚠ AND A STRAY FLAG BUYS NOTHING: the arm is gone, not merely unreached, so a
    // payload carrying the retired discriminator cannot resurrect a second card.
    { type: "outbound_gate", requestId: "r2", threadOpen: true, text: "x" },
    { type: "outbound_gate", threadOpen: false, text: "x" },
  ]) {
    assert.equal(m.entryFor({ type: "permission_request", payload }, NOW), null,
      JSON.stringify(payload));
  }
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

test("THINKING: it rides as its own kind and is bounded — at the PROSE cap", () => {
  const entry = m.entryFor(
    { type: "thinking", payload: { text: "x".repeat(m.PROSE_CAP + 5000) } },
    NOW
  );
  assert.equal(entry.kind, "thinking");
  // ⚠ A reasoning block is unbounded by construction, so it is bounded here — but at the cap the
  // UI can actually SHOW (2026-08-27). At 300 the SPA's "Show more" revealed nothing.
  assert.equal(entry.text.length, m.PROSE_CAP, "a reasoning block is unbounded by construction");
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

// ⚠ **THE CHARACTER-BUDGET CASES MOVED TO `test/session-narration-budget.test.mjs` ON
// 2026-08-31**, under the §1 500-line cap. THE SEAM IS THE SUBJECT: everything here is about
// WHAT A FRAME SAYS (which event becomes which kind, what is bounded, what never enters the
// ring); the cases that moved are about WHAT A FLUSH COSTS — `RING_CHAR_BUDGET`, the 17 GB dev
// incident's regression, and the arithmetic that derives the number instead of restating it.
// Nothing was rewritten and no case was dropped.
