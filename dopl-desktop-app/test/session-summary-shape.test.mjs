// SESSION SUMMARIES — the wire shape (main/session-summary.js › liveSummary / endedSummary).
//
// Split out of `session-summary.test.mjs` under the 500-line cap on `test/**/*.mjs`, as a pure
// MOVE: every case kept its name and its body. That file keeps what is about BEHAVIOUR — the
// mapping, the naming, the ended retention rule, the renderer frame. This one keeps the CONTRACT:
// what a summary carries, what an absence looks like, and what is bounded on the way out.
//
// Source extraction with injection, through the shared `_session-summary-harness.mjs`.
//
// Run: `node --test dopl-desktop-app/test/session-summary-shape.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { load, session, endedRecord } from "./_session-summary-harness.mjs";


test("SHAPE: a live summary carries exactly what the Agents tab and the agent view need", () => {
  // The five MEASUREMENT fields joined 2026-08-18 (Phase 5); `detail` / `toolLabel` 2026-08-20.
  // `state` is unchanged deliberately: the pill vocabulary is the SERVER's
  // (`channel_sessions.state`'s CHECK), zod validates the ARRAY and `retryable(400)` is false, so
  // a fourth pill value would 400 the whole push unretryably. The finer signal rides BESIDE the
  // pill and never reaches the server — `session-state-push.js › reportRow` picks its columns BY
  // NAME, which is the property every field below relies on.
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  assert.deepEqual(m.list(), [
    {
      sessionId: "sess-1",
      channelId: "chan-1",
      workspaceId: "ws-1", // on the wire since 2026-09-14 — the pop-out rail routes by it
      taskId: "task-1",
      agentId: "a1b2c3d4",
      name: "a1b2c3d4",
      // `displayName` (2026-08-25, Samuel's rename ruling) rides BESIDE `agentId`/`name` and
      // replaces neither: those two are the ADDRESS and nothing resolves an agent by this string.
      // `null` is the ordinary answer — most agents are never renamed (INVARIANTS §11).
      displayName: null,
      // `description` (2026-08-27, launch-panel ruling) rides off the same store as `displayName`
      // (`main/agent-names.js`), under the same machine-local rule; `null` is the ordinary answer.
      description: null,
      listening: true,
      endedAt: null,
      state: "working",
      // A session mid-turn that has rendered nothing yet — the ported `thinkingVisible`
      // rule's own answer, and the fixture's state (no `lastEventKind` stamped).
      detail: "thinking",
      toolLabel: null,
      // `diag` (2026-09-13, F-692) is set only when a launch could not run at all
      // (`mcp-connect-guard.js › failVisibly`, when the Dopl MCP server never connected) — the one
      // state the server's three-value `state` cannot express. It rides BESIDE `state`, never
      // instead of it, and nothing downstream may branch on it to decide a session is over.
      diag: null,
      // The live POSTURE pair (2026-08-20) is read-only on this wire and is the REDUCER's state,
      // not the channel's stored launch posture: a running session can be moved OFF what it
      // launched on. An absent state reads fail-closed (`manual` / `ask`).
      toolMode: "manual",
      messageMode: "ask",
      // `model` (2026-08-22, Samuel's model-selection ruling), and the fixture shows the
      // PRECEDENCE: the SDK's own reported id (`s.liveModel`) beats the operator's pick, because
      // 'default' means "whatever the CLI chose" and the CLI is the one that knows.
      model: "claude-haiku-4-5",
      channelName: "general",
      threadTitle: "Ship the thing",
      // `templateName` (2026-08-22, agent templates) is the SPAWN-TIME capture
      // `context.template.name` and can never move. THE NAME, never the id. Unlike the fields
      // above it DOES reach the server, onto `channel_sessions.template_name`, which is
      // operator-only by construction on that side (`collab-dto.ts › mapOwnSessionStateRow`).
      templateName: null,
      // `color` (2026-09-13, docs/specs/agent-colors.md) is THE ASK, not the assignment:
      // uniqueness is per channel across EVERY member and no machine can evaluate that, so the
      // server may substitute. It DOES reach the server (`channel_sessions.color`), peer-visible
      // by design. Until this field existed `reportRow` read `e.color` off a summary that carried
      // none, so the ask was `undefined` on every push.
      color: null,
      // `heldGates` (2026-09-17, Samuel's inline-approval ruling). `[]` is UNIFORM rather than
      // omitted, so no reader branches on absence to decide whether this build reports held calls;
      // an older main answers `undefined` and the SPA reads that as "cannot say". It is a
      // PROJECTION of `state.pendingPermissions`, never a second set. It does not reach the
      // server: an entry carries a one-line summary of a TOOL INPUT, nobody else's business.
      heldGates: [],
      contextUsed: 84000,
      contextWindow: 200000, // the frozen table's row for claude-haiku-4-5
      tokensSpent: 1200000,
      startedAt: 1700000000000,
      lastActivityAt: 1700000600000,
      // The HEALTH half (2026-09-01, T25 / T50 / T51 / T83) answers a different question from the
      // metrics beside it: those say what the run has COST, these whether it is getting anywhere
      // and what has been refused to it. Every count is NULL until something measures it —
      // `deniedCalls: 0` would be a claim no machine made. `tokensDelta` is not null because the
      // fixture HAS spent and never posted, and `stale` is the one DERIVATION (its false branches
      // are driven with an injected clock in `session-health.test.mjs`). All seven DO reach the
      // server, onto OPERATOR-ONLY columns.
      turns: null,
      tokensDelta: 1200000,
      stale: true,
      deniedCalls: null,
      lastDeniedTool: null,
      lastWakeSeq: null,
      lastWakeAt: null,
    },
  ]);
});

test("SHAPE: an UNMEASURED metric is null — never a confident zero", () => {
  // `Number(null)` is 0, so a coercion-only guard reports an empty context window on a session
  // that has simply not reported usage yet, and the meter paints 0% of a window that may be nearly
  // full. A model this build has no window for must show raw tokens, never a made-up percentage.
  const m = load();
  const s = session({
    promptTokens: undefined,
    liveModel: "some-model-from-the-future",
    tokensSpent: undefined,
    startedAt: undefined,
    lastActivityAt: undefined,
  });
  m.bind({ sessions: new Map([[s.key, s]]) });
  const row = m.list()[0];
  assert.equal(row.contextUsed, null);
  assert.equal(row.contextWindow, null, "an unknown model gets NO denominator, not 0");
  assert.equal(row.tokensSpent, null);
  assert.equal(row.startedAt, null);
  assert.equal(row.lastActivityAt, null);
  // …and the identity half is untouched by any of it.
  assert.equal(row.name, "a1b2c3d4");
  assert.equal(row.state, "working");
});

test("SHAPE: a RETAINED ENDED pill keeps the measurement it settled with", () => {
  // The session object is gone by then, so a live read would blank every number at exactly the
  // moment the operator wants to read what the run cost. `noteEnded` freezes them into the durable
  // record (2026-08-22), so an ended card survives a restart with its numbers.
  const m = load();
  m.bind({ sessions: new Map(), endedRecords: () => [endedRecord()] });
  const [row] = m.list();
  assert.equal(row.state, "ended");
  assert.equal(row.contextUsed, 84000);
  assert.equal(row.contextWindow, 200000);
  assert.equal(row.tokensSpent, 1200000);
  assert.equal(row.startedAt, 1700000000000);
});

test("SHAPE: counterparty-influenced text is bounded and single-line", () => {
  const m = load();
  m.bind({
    sessions: new Map([
      ["chan-1:task-1", session({ context: { channelName: "a\nb\tc", taskTitle: "x".repeat(200) } })],
    ]),
  });
  const row = m.list()[0];
  assert.equal(row.channelName, "a b c");
  assert.equal(row.threadTitle.length, 80);
  // Same discipline session-store.durableName applies, and for the same reason.
});

test("SHAPE: a thread-less responder session is a real row, not a dropped one", () => {
  const m = load();
  const s = session({ taskId: "", context: {} });
  m.bind({ sessions: new Map([[s.key, s]]) });
  const row = m.list()[0];
  assert.equal(row.taskId, "");
  assert.equal(row.threadTitle, null);
  assert.equal(row.channelName, null);
});

test("SHAPE: a settled registry entry is never listed", () => {
  const m = load();
  m.bind({ sessions: new Map([["chan-1:task-1", session({ settled: true })]]) });
  assert.deepEqual(m.list(), []);
});
