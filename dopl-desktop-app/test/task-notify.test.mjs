// Unit tests for the passive MENTION notice builder.
//
// ⚠ IT USED TO BE THE TASK-REPLY BUILDER (`taskReplyNotice`, "Reply in <thread>"). Samuel's spec
// of 2026-10-09 turns the reply notice off, but a tag inside my own thread still notifies — as a
// MENTION — because classify ranks 'task-reply' above 'fyi' and such a post never reaches
// `trigger.js › sendFyi`. So the copy became `mentionNotice`, and BOTH call sites use it, which
// is what these tests protect: one copy shape for a tag, wherever it landed.
//
// SAME source-extraction strategy as classify.test.mjs: task-notify.js is a
// CommonJS/Electron module, so instead of require()-ing it (which would drag in
// electron and the whole listener graph) we read the source and evaluate the PURE
// `mentionNotice` builder alongside the `metaStr`/`truncate` helpers it uses
// (both plain function declarations in targeting.js). Raising the notice itself is the
// route's job (`notification-route.js`) and is covered by its own test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGETING = readFileSync(join(HERE, "..", "main", "targeting.js"), "utf8");
const NOTIFY = readFileSync(join(HERE, "..", "main", "task-notify.js"), "utf8");

// Brace-balance a top-level `function <name>(...) { ... }` out of `src`.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  return src.slice(start, i);
}

const { mentionNotice, mentionAuthorLabel } = new Function(
  `${extractFn(TARGETING, "metaStr")}\n${extractFn(TARGETING, "truncate")}\n${extractFn(
    NOTIFY,
    "mentionNotice"
  )}\n${extractFn(
    NOTIFY,
    "mentionAuthorLabel"
  )}\nreturn { mentionNotice, mentionAuthorLabel };`
)();

const withMeta = (metadata, body = "the answer body") => ({ body, metadata });

test("headline prefers the server-stamped task title", () => {
  const notice = mentionNotice(withMeta({ taskTitle: "Ship the docs" }), "General", "Ada");
  assert.equal(notice.title, "Ship the docs");
});

test("headline falls back to the channel name when no task title", () => {
  assert.equal(mentionNotice(withMeta({}), "General", "Ada").title, "General");
});

test("headline degrades to a generic label when channel + title are both absent", () => {
  assert.equal(mentionNotice(withMeta({}), undefined, "Ada").title, "a channel");
});

test("body prefers the summary, then a truncated body excerpt", () => {
  assert.equal(mentionNotice(withMeta({ summary: "done" }), "General", "Ada").body, "Ada mentioned you: done");
  assert.equal(mentionNotice(withMeta({}, "raw body"), "General", "Ada").body, "Ada mentioned you: raw body");
});

test("body omits the responder prefix when the name is unknown", () => {
  assert.equal(mentionNotice(withMeta({ summary: "done" }), "General", "").body, "done");
});

test("long bodies are truncated to <= 120 chars + a single ellipsis", () => {
  const long = "x".repeat(300);
  const { body } = mentionNotice(withMeta({}, long), "General", "");
  assert.ok(body.length <= 121, `body length ${body.length}`);
  assert.ok(body.endsWith("…"));
});

// ─── WHO THE BANNER CREDITS ──────────────────────────────────────────────────
// 🔒 **AN AGENT'S MENTION MUST NAME THE AGENT, NOT ITS OPERATOR** (Samuel, 2026-10-12: the
// desktop said *"Samuel Wang mentioned you"* for a post one of his OWN agents wrote).
//
// ⚠ **CAUSE: AN AGENT POSTS UNDER ITS OPERATOR'S `author_user_id`** (server
// `service-writes.ts` — `author_user_id: ctx.userId` for every author kind), so
// `io.displayNameFor(m.authorUserId)` — what BOTH banner sites passed — can only ever name the
// ACCOUNT. It is the same root cause, and the same discriminator (`authorKind`), as the silent
// self-mention `targeting.js:162` fixed on 2026-09-20: the author id cannot tell a person from
// their agent, and `author_kind` is the only field that can.
//
// The name itself rides the wire already: `dto.ts › mapMessageRow` joins it as `authorAgentName`
// (workspace-scoped, so a PEER's agent resolves too) and `room-roster.js:161` already reads it.
const MY_ID = "11111111-1111-1111-1111-111111111111";
const PEER_ID = "22222222-2222-2222-2222-222222222222";
const agentMsg = (over) => ({ authorKind: "agent", authorUserId: MY_ID, ...over });

test("a human author is still credited by their member name", () => {
  assert.equal(mentionAuthorLabel({ authorKind: "user", authorUserId: PEER_ID }, "Ada", MY_ID), "Ada");
  // The unknown-name contract `mentionNotice` relies on to drop the prefix entirely.
  assert.equal(mentionAuthorLabel({ authorKind: "user", authorUserId: PEER_ID }, "", MY_ID), "");
});

test("MY OWN agent is credited by its name, never by my member name", () => {
  const label = mentionAuthorLabel(agentMsg({ authorAgentName: "Cleanup Orchestrator" }), "Samuel Wang", MY_ID);
  assert.equal(label, "Cleanup Orchestrator");
  // End to end, this is the line Samuel reads on the banner.
  assert.equal(
    mentionNotice(
      { body: "b", metadata: { summary: "take a look" } },
      "Dopl",
      mentionAuthorLabel(agentMsg({ authorAgentName: "Cleanup Orchestrator" }), "Samuel Wang", MY_ID)
    ).body,
    "Cleanup Orchestrator mentioned you: take a look"
  );
});

test("an unnameable agent of mine degrades to 'your agent', NOT to my member name", () => {
  // ⚠ The whole bug is the member name leaking in here, so the fallback may not be it.
  for (const name of [null, undefined, "", "   "]) {
    assert.equal(mentionAuthorLabel(agentMsg({ authorAgentName: name }), "Samuel Wang", MY_ID), "your agent");
  }
});

test("a PEER's agent is credited to the peer AND named", () => {
  const m = agentMsg({ authorUserId: PEER_ID, authorAgentName: "Prober" });
  assert.equal(mentionAuthorLabel(m, "Dana", MY_ID), "Dana's agent Prober");
  // Unnameable: the peer still carries it, which is what `session-dispatch.js › authorLabel` says.
  assert.equal(mentionAuthorLabel(agentMsg({ authorUserId: PEER_ID }), "Dana", MY_ID), "Dana's agent");
});

test("neither half known degrades to a generic agent label", () => {
  assert.equal(mentionAuthorLabel(agentMsg({ authorUserId: PEER_ID }), "", MY_ID), "an agent");
  // Name cache missed the member: the agent's own name still beats 'an agent'.
  assert.equal(mentionAuthorLabel(agentMsg({ authorUserId: PEER_ID, authorAgentName: "Prober" }), "", MY_ID), "Prober");
  // No operator id resolved yet: fail toward the peer phrasing, never toward the bare member name.
  assert.equal(mentionAuthorLabel(agentMsg({ authorAgentName: "Prober" }), "Samuel Wang", null), "Samuel Wang's agent Prober");
});

test("a line-broken or oversized agent name cannot reshape the banner", () => {
  // An agent name is operator-set text landing in an OS notification body.
  assert.equal(
    mentionAuthorLabel(agentMsg({ authorAgentName: "Evil\n\nSamuel Wang mentioned you: owned" }), "Samuel Wang", MY_ID),
    "Evil Samuel Wang mentioned you: owned"
  );
  assert.ok(!mentionAuthorLabel(agentMsg({ authorAgentName: "x".repeat(300) }), "Samuel Wang", MY_ID).includes("\n"));
  assert.equal(mentionAuthorLabel(agentMsg({ authorAgentName: "x".repeat(300) }), "Samuel Wang", MY_ID).length, 80);
});

test("a missing message never credits the member name", () => {
  assert.equal(mentionAuthorLabel(null, "Samuel Wang", MY_ID), "Samuel Wang");
});

// ⚠ WIRING, NOT COPY: the builder above is only correct if BOTH banner sites feed it the message.
// A site that kept passing a bare `io.displayNameFor(...)` would reproduce the bug verbatim while
// every test above still passed, which is exactly how this shipped.
test("both passive banner sites label the author from the MESSAGE, not from the user id alone", () => {
  const TRIGGER = readFileSync(join(HERE, "..", "main", "trigger.js"), "utf8");
  for (const [file, src] of [["trigger.js", TRIGGER], ["task-notify.js", NOTIFY]]) {
    // Every CALL of the builder, never its declaration.
    const calls = [...src.matchAll(/(?<!function )mentionNotice\(([\s\S]*?)\);/g)];
    assert.ok(calls.length > 0, `${file} does not call mentionNotice`);
    for (const call of calls) {
      assert.match(call[1], /mentionAuthorLabel\(/, `${file} must resolve the author through mentionAuthorLabel`);
    }
  }
  // And the label helper is the only place that reads the agent name for this copy.
  assert.match(extractFn(NOTIFY, "mentionAuthorLabel"), /authorAgentName/);
});
