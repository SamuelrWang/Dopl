/**
 * ⚠ A TERMINAL MARKER'S BODY IS RENDERABLE WHEN IT SAYS SOMETHING.
 * `task_finished` / `task_failed` set `draft.endEvent` and are never pushed to
 * `draft.entries`, so without this their body has NO RENDER PATH AT ALL.
 *
 * ⚠ Needed even though the post is now refused from an agent — the refusal stops
 * NEW ones only. It does nothing for rows that ALREADY EXIST, the desktop
 * runtime's legitimate `bodyOverride` ends, or a human's CLOSE SUMMARY riding
 * out as the echo's body. All three are content.
 *
 * ⚠ The line is "does this marker say something the GENERATORS do not", drawn by
 * calm FLAG first (a flagged marker is status whatever its wording) and then by
 * the enumerated generated bodies. NEVER by length: "Task failed" is short and
 * generated, a one-line close summary is short and real.
 */

import { describe, it, expect } from "vitest";
import {
  groupThread,
  splitSessionEntries,
  substantiveEndBody,
  type SessionGroup,
} from "./group-thread";
import type { ChannelMessage, ChannelMessageKind } from "../types";

const CHANNEL = "c1";
const REQUESTER = "u-req";
const RESPONDER = "u-res";

let seq = 0;
function msg(over: Partial<ChannelMessage> = {}): ChannelMessage {
  seq += 1;
  return {
    id: `m-${seq}`,
    seq,
    channelId: CHANNEL,
    authorUserId: RESPONDER,
    authorKind: "agent",
    authorName: "Agent",
    kind: "message" as ChannelMessageKind,
    body: "body",
    metadata: {},
    clientMsgId: null,
    createdAt: new Date(1_800_000_000_000 + seq * 1000).toISOString(),
    ...over,
  } as ChannelMessage;
}

function onlySession(items: ReturnType<typeof groupThread>): SessionGroup {
  const found = items.find((i) => i.type === "session");
  if (!found || found.type !== "session") throw new Error("expected one session");
  return found.session;
}

// ── 1. the incident, end to end ────────────────────────────────────────────────

describe("the answer posted as task_finished (the incident)", () => {
  /** Exact wire shape: opener with the ASK as its summary, then the answer. */
  const ANSWER =
    "Here is the analysis you asked for: the listener drops the trigger when the CLI probe fails, and the fix is to probe the bundled binary instead.";
  const THREAD = "task-c1-11";

  function incident() {
    return groupThread([
      msg({
        seq: 11,
        kind: "message",
        authorKind: "user",
        authorUserId: REQUESTER,
        body: "Can you look at why channels went quiet?",
        metadata: { taskId: THREAD, summary: "Why did channels go quiet?", to_user_id: RESPONDER },
      }),
      msg({
        kind: "task_started",
        body: "Started working on this request.",
        metadata: { taskId: THREAD, summary: "Why did channels go quiet?" },
      }),
      msg({ kind: "task_finished", body: ANSWER, metadata: { taskId: THREAD } }),
    ]);
  }

  it("the answer REACHES a render lane instead of vanishing", () => {
    const session = onlySession(incident());
    // ⚠ Without the fix this is 1 (the opener) and the answer is nowhere in the
    // render model at all.
    const { replies } = splitSessionEntries(session.entries);
    expect(replies.map((r) => r.body)).toContain(ANSWER);
  });

  it("…and the header stops describing the ASK once the exchange has ended", () => {
    // ⚠ Scanning the START first takes its server-stamped opening ASK, so an
    // answered card keeps describing the question.
    const session = onlySession(incident());
    expect(session.summary).toBe(ANSWER.slice(0, 119) + "…");
  });

  it("the status chip is unchanged — the belt adds a body, it does not restate the outcome", () => {
    const session = onlySession(incident());
    expect(session.status).toBe("done");
    expect(session.calmEndStatus).toBeNull();
  });
});

// ── 2. what must NOT be promoted ───────────────────────────────────────────────

describe("substantiveEndBody — status is not content", () => {
  const CALM_FLAGS = ["declined", "dropped", "interrupted", "capped", "ended"] as const;

  it.each(CALM_FLAGS)("a %s marker is status, whatever its body says", (flag) => {
    // ⚠ Checked by FLAG, not by string, so a re-wording cannot leak a status
    // line into the reply lane.
    const m = msg({
      kind: "task_failed",
      body: "some wording a future build invents",
      metadata: { taskId: "t", [flag]: true },
    });
    expect(substantiveEndBody(m)).toBeNull();
  });

  it.each([
    "Finished this request.",
    "Could not complete this request.",
    "Task completed",
    "Task failed",
    "Session ended",
    "Turn limit reached",
  ])("the generated body %s is not promoted", (body) => {
    expect(substantiveEndBody(msg({ kind: "task_finished", body }))).toBeNull();
  });

  it("an empty or whitespace body is not content either", () => {
    expect(substantiveEndBody(msg({ kind: "task_finished", body: "   " }))).toBeNull();
  });

  it("a calm-flagged end leaves `entries` exactly as it was", () => {
    // ⚠ A lone dropped/declined echo is a card with NO body and must stay one.
    const session = onlySession(
      groupThread([
        msg({ kind: "task_failed", body: "Reply not sent", metadata: { taskId: "t-1", dropped: true } }),
      ])
    );
    expect(session.entries).toHaveLength(0);
    expect(session.status).toBe("dropped");
  });
});

// ── 3. the other two content shapes the belt exists for ────────────────────────

describe("the belt covers every terminal that carries real words", () => {
  it("a human's CLOSE SUMMARY (the echo's body) renders", () => {
    // `closeTask` writes the operator's one-line outcome as the echo body — the
    // most-read sentence on a finished thread.
    const SUMMARY = "Shipped in 1.8.5; the listener now probes the bundled binary.";
    const session = onlySession(
      groupThread([
        msg({ kind: "task_started", body: "Started working on this request.", metadata: { taskId: "t-2" } }),
        msg({ kind: "task_finished", body: SUMMARY, metadata: { taskId: "t-2" } }),
      ])
    );
    expect(splitSessionEntries(session.entries).replies.map((r) => r.body)).toEqual([SUMMARY]);
  });

  it("a genuine FAILURE with a real reason renders (and stays `failed`)", () => {
    // A `task_failed` with no calm flag is a real failure: chip says failed, body
    // says why.
    const REASON = "The upstream export endpoint returned 502 on every retry.";
    const session = onlySession(
      groupThread([msg({ kind: "task_failed", body: REASON, metadata: { taskId: "t-3" } })])
    );
    expect(session.status).toBe("failed");
    expect(splitSessionEntries(session.entries).replies.map((r) => r.body)).toEqual([REASON]);
  });

  it("a substantive end lands AFTER the replies it follows, in seq order", () => {
    const session = onlySession(
      groupThread([
        msg({ kind: "task_started", body: "Started working on this request.", metadata: { taskId: "t-4" } }),
        msg({ kind: "message", body: "first pass", metadata: { taskId: "t-4" } }),
        msg({ kind: "task_finished", body: "and the final word", metadata: { taskId: "t-4" } }),
      ])
    );
    expect(splitSessionEntries(session.entries).replies.map((r) => r.body)).toEqual([
      "first pass",
      "and the final word",
    ]);
  });

  it("a promoted terminal joins REPLIES, never the milestone lane", () => {
    // ⚠ An entry in NEITHER lane is invisible exactly the way `endEvent` was —
    // the lane is load-bearing, not cosmetic.
    const session = onlySession(
      groupThread([
        msg({ kind: "task_progress", body: "schema half landed", metadata: { taskId: "t-5" } }),
        msg({ kind: "task_finished", body: "the whole answer", metadata: { taskId: "t-5" } }),
      ])
    );
    const { milestones, replies } = splitSessionEntries(session.entries);
    expect(milestones.map((m) => m.body)).toEqual(["schema half landed"]);
    expect(replies.map((r) => r.body)).toEqual(["the whole answer"]);
  });
});

// ── 4. the header, without over-reaching ───────────────────────────────────────

describe("computeSummary — the header describes the outcome, not the ask", () => {
  it("an explicit summary on the END wins over one on the START", () => {
    const session = onlySession(
      groupThread([
        msg({ kind: "task_started", body: "x", metadata: { taskId: "t-6", summary: "the ask" } }),
        msg({ kind: "task_finished", body: "y", metadata: { taskId: "t-6", summary: "the outcome" } }),
      ])
    );
    expect(session.summary).toBe("the outcome");
  });

  it("with no end at all, the start's summary still carries the card", () => {
    // ⚠ The reorder must not cost a RUNNING session its header.
    const session = onlySession(
      groupThread([
        msg({ kind: "task_started", body: "x", metadata: { taskId: "t-7", summary: "the ask" } }),
      ])
    );
    expect(session.summary).toBe("the ask");
    expect(session.status).toBe("active");
  });
});
