/**
 * F-176 (2026-08-08) — A REOPENED THREAD MUST NOT ANNOUNCE ITSELF WITH A ✓.
 *
 * `reopenTask` posts an echo so the peer's surfaces learn about a status change
 * that reaches them no other way (`channel_tasks` is in neither realtime table
 * set; close survived only by accident of posting its terminal marker). The echo
 * is `kind:"task_progress"` BY CONSTRUCTION — it must never become an `endEvent`,
 * and `task_started` would take over `draft.head` and open the fallback window.
 *
 * That construction is right and this file does not touch it. What it fixes is
 * one layer up: `splitSessionEntries` routed EVERY `task_progress` to the
 * milestones lane, and the card draws that lane as a green-checked accomplishment
 * list under the heading "Milestones". So the thread that had just come back to
 * LIFE rendered its resumption as a completed item — the single glyph on the card
 * saying "done" about the one state that is defined by not being done.
 *
 * THE FIX IS A LANE, DRAWN BY FLAG. `notices` is the status lane: rendered as a
 * calm one-liner with a neutral dot, the same treatment the calm terminal/end
 * notes already get, because it is the same kind of thing. Drawn by the reserved
 * `threadReopened` marker and never by matching the body text — `substantiveEndBody`
 * draws that same status/content line by flag first for the same reason, and the
 * echo's copy already has two forms (with and without a prior outcome), so a
 * string match would regress to the ✓ the first time somebody improved the wording.
 *
 * WHAT MUST NOT MOVE, and is pinned below: the echo stays an ordinary ENTRY (a
 * marker whose fallback rendering is invisible is worse than none), it never
 * becomes an outcome, it never sets `calmEndStatus` (a reopen is the OPPOSITE
 * signal to a session end), and an ordinary agent milestone is untouched.
 */

import { describe, expect, it } from "vitest";
import {
  groupThread,
  isThreadReopenedMarker,
  splitSessionEntries,
  THREAD_REOPENED_KEY,
  type SessionGroup,
} from "./group-thread";
import type { ChannelMessage, ChannelMessageKind } from "../types";

const THREAD = "task-c1-9";
const REOPEN_BODY = "Thread reopened (was closed as completed).";

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
    createdAt: new Date(1_900_000_000_000 + seq * 1000).toISOString(),
    ...over,
  } as ChannelMessage;
}

const started = () =>
  msg({ kind: "task_started", body: "Started working on this request." });
const milestone = (body: string) => msg({ kind: "task_progress", body });
const reopenEcho = () =>
  msg({
    kind: "task_progress",
    body: REOPEN_BODY,
    metadata: { taskId: THREAD, [THREAD_REOPENED_KEY]: true },
  });

function onlySession(items: ReturnType<typeof groupThread>): SessionGroup {
  const found = items.find((i) => i.type === "session");
  if (!found || found.type !== "session") throw new Error("expected one session");
  return found.session;
}

describe("the reopen marker", () => {
  // THE KEY IS A WIRE CONTRACT, SO IT IS PINNED AS A LITERAL — deliberately not
  // as `THREAD_REOPENED_KEY`, which every other assertion in this file uses to
  // build its fixtures. A test that spells the key the same way on both sides
  // moves WITH a rename and proves nothing: renaming the constant here would
  // silently stop matching the server's `REOPEN_MARKER_KEY`, every reopen echo
  // would fall back into the milestones lane, and the whole suite would stay
  // green. (Found by mutation, not by inspection — the first version of this
  // file survived exactly that edit.)
  it("spells the key exactly as the server stamps it", () => {
    expect(THREAD_REOPENED_KEY).toBe("threadReopened");
    // And the predicate reads THAT key off the wire, not merely its own name.
    expect(
      isThreadReopenedMarker(
        msg({ kind: "task_progress", metadata: { taskId: THREAD, threadReopened: true } })
      )
    ).toBe(true);
  });

  it("routes the SERVER'S echo shape to notices, spelled out verbatim", () => {
    // The echo exactly as `service-tasks-lifecycle.reopenTask` writes it, with
    // no constant of ours in the fixture. This is the end-to-end pin: if the key
    // drifts from the server's, this lands back under the green ✓.
    const wireEcho = msg({
      kind: "task_progress",
      body: "Thread reopened (was closed as completed).",
      metadata: { taskId: THREAD, threadReopened: true },
    });
    const { milestones, notices } = splitSessionEntries([wireEcho]);
    expect(notices).toHaveLength(1);
    expect(milestones).toHaveLength(0);
  });

  it("is recognised only as a task_progress carrying the flag strictly", () => {
    expect(isThreadReopenedMarker(reopenEcho())).toBe(true);
    // A TERMINAL kind carrying the same key is not this signal. The whole point
    // of the echo riding task_progress is that it can never be an outcome;
    // reading the flag off a terminal kind would launder exactly that shape.
    for (const kind of ["task_failed", "task_finished", "message"] as const) {
      expect(
        isThreadReopenedMarker(
          msg({ kind, metadata: { taskId: THREAD, [THREAD_REOPENED_KEY]: true } })
        )
      ).toBe(false);
    }
    // Strict `=== true`, like every other reserved marker: an
    // attacker-influenceable truthy value must not pass.
    for (const value of ["yes", 1, {}, "true"]) {
      expect(
        isThreadReopenedMarker(
          msg({ kind: "task_progress", metadata: { taskId: THREAD, [THREAD_REOPENED_KEY]: value } })
        )
      ).toBe(false);
    }
  });

  it("does not match a plain milestone", () => {
    expect(isThreadReopenedMarker(milestone("Reading files…"))).toBe(false);
  });
});

describe("the lane split — the bug this fixes", () => {
  it("routes the reopen echo to NOTICES, never to the check-marked milestones lane", () => {
    const { milestones, replies, notices } = splitSessionEntries([reopenEcho()]);
    expect(notices.map((n) => n.body)).toEqual([REOPEN_BODY]);
    // The regression itself: a green ✓ on a thread that just came back to life.
    expect(milestones).toHaveLength(0);
    // And it is not a deliverable either — it says nothing about the work.
    expect(replies).toHaveLength(0);
  });

  it("leaves an ordinary agent milestone in the milestones lane", () => {
    const { milestones, notices } = splitSessionEntries([
      milestone("Read the schema"),
      reopenEcho(),
      milestone("Wrote the migration"),
    ]);
    expect(milestones.map((m) => m.body)).toEqual([
      "Read the schema",
      "Wrote the migration",
    ]);
    expect(notices.map((n) => n.body)).toEqual([REOPEN_BODY]);
  });

  it("draws the line by FLAG, not by the echo's wording", () => {
    // The body is server-generated and already has two forms; a later build may
    // word it differently. A string-matching renderer would regress to the ✓.
    const reworded = msg({
      kind: "task_progress",
      body: "This thread is open again.",
      metadata: { taskId: THREAD, [THREAD_REOPENED_KEY]: true },
    });
    expect(splitSessionEntries([reworded]).notices).toHaveLength(1);
    // The converse: the FAMILIAR WORDING with no flag is somebody typing a
    // milestone, and it stays a milestone.
    const impostor = msg({ kind: "task_progress", body: REOPEN_BODY });
    expect(splitSessionEntries([impostor]).milestones).toHaveLength(1);
    expect(splitSessionEntries([impostor]).notices).toHaveLength(0);
  });

  it("keeps every lane in seq order", () => {
    const { milestones, replies, notices } = splitSessionEntries([
      milestone("one"),
      msg({ body: "a reply" }),
      reopenEcho(),
      milestone("two"),
      msg({ body: "another reply" }),
    ]);
    expect(milestones.map((m) => m.body)).toEqual(["one", "two"]);
    expect(replies.map((r) => r.body)).toEqual(["a reply", "another reply"]);
    expect(notices).toHaveLength(1);
  });
});

describe("what the state machine must NOT do with it", () => {
  it("keeps the echo an ordinary entry, so it is never invisible", () => {
    // The reason the echo rides task_progress at all is that its fallback
    // rendering is visible. Dropping it from `entries` would be a worse bug
    // than the ✓.
    const session = onlySession(groupThread([started(), reopenEcho()]));
    expect(session.entries.map((e) => e.body)).toEqual([REOPEN_BODY]);
  });

  it("never becomes the exchange's outcome", () => {
    const session = onlySession(groupThread([started(), reopenEcho()]));
    expect(session.status).toBe("active");
    // A reopen after a close is the live case: the thread is open again.
    const afterClose = onlySession(
      groupThread([
        started(),
        msg({ kind: "task_finished", body: "Finished this request." }),
        reopenEcho(),
      ])
    );
    // The derived status still reflects the terminal marker (the authoritative
    // `channel_tasks` overlay is what actually flips the card back to open) —
    // what matters is that the echo did not ADD an outcome of its own.
    expect(afterClose.status).toBe("done");
    expect(afterClose.entries.map((e) => e.body)).toEqual([REOPEN_BODY]);
  });

  it("never sets calmEndStatus — a reopen is the opposite signal to a session end", () => {
    const session = onlySession(groupThread([started(), reopenEcho()]));
    expect(session.calmEndStatus).toBeNull();
  });

  it("does not hijack the header summary", () => {
    const session = onlySession(
      groupThread([
        started(),
        msg({ body: "Here is the answer." }),
        reopenEcho(),
      ])
    );
    expect(session.summary).toBe("Here is the answer.");
  });
});
