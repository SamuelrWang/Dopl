/**
 * P1-7 — A LOCAL SESSION ENDING IS NOT AN OUTCOME FOR THE SHARED THREAD.
 *
 * Samuel's decision 3 (2026-08-04). `session-effects.endLifecycle('operator')`
 * mapped "the operator closed this window" onto `task_failed` + `{ended:true}`.
 * The flag kept the CHIP calm, so it read fine locally — but the KIND is
 * terminal: `groupThread` folds a `task_failed` into `draft.endEvent` and
 * `computeStatus` reads a terminal marker as the exchange's OUTCOME. So one
 * member parking their own window painted the SHARED thread as ended on the
 * peer's card, while the thread was open, still routing, and the other member
 * might still be working it.
 *
 * THE DESIGN, and the constraint that chose it. The signal is non-terminal BY
 * CONSTRUCTION rather than by flag: it rides on `task_progress`, which is an
 * ENTRY here and can never be an `endEvent`, so there is no path by which it
 * becomes an outcome. It is a metadata marker rather than a new `kind` because
 * `channel_messages.kind` carries a CHECK constraint — a first-class
 * `session_ended` kind is a schema change, deployed ahead of every desktop that
 * would write it, for what is a render hint.
 *
 * WHAT THE OLD KIND WAS ACTUALLY BUYING was the honest "Working…" replacement,
 * and that is kept: the marker feeds `calmEndStatus` directly. Both halves are
 * pinned below — the status must NOT move, and the note must still appear.
 */

import { describe, it, expect } from "vitest";
import {
  groupThread,
  isSessionEndedMarker,
  SESSION_ENDED_KEY,
  type SessionGroup,
  type ThreadOverlay,
} from "./group-thread";
import type { ChannelMessage, ChannelMessageKind } from "../types";

const THREAD = "task-c1-7";

let seq = 0;
function msg(over: Partial<ChannelMessage> = {}): ChannelMessage {
  seq += 1;
  return {
    id: `m-${seq}`,
    seq,
    channelId: "c1",
    authorUserId: "u-res",
    authorKind: "agent",
    authorName: "Agent",
    kind: "message" as ChannelMessageKind,
    body: "body",
    metadata: { taskId: THREAD },
    clientMsgId: null,
    createdAt: new Date(1_800_000_000_000 + seq * 1000).toISOString(),
    ...over,
  } as ChannelMessage;
}

const started = () =>
  msg({ kind: "task_started", body: "Started working on this request." });
const sessionEnded = () =>
  msg({
    kind: "task_progress",
    body: "Session ended",
    metadata: { taskId: THREAD, [SESSION_ENDED_KEY]: true },
  });

function onlySession(items: ReturnType<typeof groupThread>): SessionGroup {
  const found = items.find((i) => i.type === "session");
  if (!found || found.type !== "session") throw new Error("expected one session");
  return found.session;
}

describe("the session-ended marker", () => {
  it("is recognised only as a task_progress carrying the flag strictly", () => {
    expect(isSessionEndedMarker(sessionEnded())).toBe(true);
    // A terminal kind carrying the same key is NOT this signal — that shape is
    // the bug, and treating it as the fix would launder it.
    expect(
      isSessionEndedMarker(
        msg({ kind: "task_failed", metadata: { taskId: THREAD, [SESSION_ENDED_KEY]: true } })
      )
    ).toBe(false);
    // Strict `=== true`, like every other flag here: an attacker-influenceable
    // truthy value must not pass.
    for (const value of ["yes", 1, {}, "true"]) {
      expect(
        isSessionEndedMarker(
          msg({ kind: "task_progress", metadata: { taskId: THREAD, [SESSION_ENDED_KEY]: value } })
        )
      ).toBe(false);
    }
  });
});

describe("what it must NOT do — the whole point of the change", () => {
  it("does not make the thread read as failed, or as ended at all", () => {
    const session = onlySession(groupThread([started(), sessionEnded()]));
    // The old shape produced "ended" here off a terminal marker. The exchange is
    // still in flight as far as the THREAD is concerned.
    expect(session.status).toBe("active");
    expect(session.status).not.toBe("failed");
  });

  it("does not survive an authoritative overlay either", () => {
    // The `channel_tasks` row is what actually decides an open thread's state.
    const overlays = new Map<string, ThreadOverlay>([
      [THREAD, { status: "active", title: "Ship it", mode: "interactive" }],
    ]);
    const session = onlySession(groupThread([started(), sessionEnded()], overlays));
    expect(session.status).toBe("active");
  });

  it("a REAL failure in the same thread still reads as failed", () => {
    // The control. If the fix had made terminal markers non-terminal generally,
    // "nothing says failed" would look like success.
    const session = onlySession(
      groupThread([started(), msg({ kind: "task_failed", body: "The export endpoint 502'd." })])
    );
    expect(session.status).toBe("failed");
  });

  it("a turn/cost CAP stays terminal — it is a refusal, not a tidied window", () => {
    const session = onlySession(
      groupThread([
        started(),
        msg({ kind: "task_failed", body: "Turn limit reached", metadata: { taskId: THREAD, capped: true } }),
      ])
    );
    expect(session.status).toBe("capped");
  });
});

describe("what it must still do — the note the old kind was buying", () => {
  it("stops the card claiming 'Working…' for a session that stopped", () => {
    const session = onlySession(groupThread([started(), sessionEnded()]));
    expect(session.calmEndStatus).toBe("ended");
  });

  it("a RESUME clears the note, exactly as it does for a terminal marker", () => {
    const session = onlySession(groupThread([started(), sessionEnded(), started()]));
    expect(session.calmEndStatus).toBeNull();
  });

  it("a real terminal end OUTRANKS a parked window when both are present", () => {
    // Order matters more than recency here: an interrupted run is a fact about
    // the work, a closed window is a fact about a desk.
    const session = onlySession(
      groupThread([
        started(),
        sessionEnded(),
        msg({ kind: "task_failed", body: "Request interrupted", metadata: { taskId: THREAD, interrupted: true } }),
      ])
    );
    expect(session.calmEndStatus).toBe("interrupted");
  });

  it("the marker is an ordinary entry, so 'Session ended' is visible in the log", () => {
    const session = onlySession(groupThread([started(), sessionEnded()]));
    expect(session.entries.map((e) => e.body)).toEqual(["Session ended"]);
  });

  it("a thread with no marker at all is byte-for-byte what it was", () => {
    const session = onlySession(groupThread([started()]));
    expect(session.calmEndStatus).toBeNull();
    expect(session.status).toBe("active");
    expect(session.entries).toHaveLength(0);
  });
});
