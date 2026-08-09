/**
 * WHAT STATE THE EXCHANGE IS IN, AND WHAT ONE LINE DESCRIBES IT —
 * `computeStatus` / `computeSummary` (now `group-thread-draft.ts`) through
 * `groupThread`, plus the CALM TERMINAL family and the authoritative overlay.
 *
 * The truth table for one rule stated three ways: a `task_failed` is a genuine
 * failure UNLESS it carries an operator-chosen calm flag; every flag is read
 * STRICTLY (`=== true`) so a truthy string can never launder a real failure; and
 * `calmEndStatus` is a strict subset of that family — the ends that replace a
 * lying "Working…" line, cleared by a later restart, and independent of an
 * overlay that pins the thread "active".
 *
 * Split out of `group-thread.test.ts` (§2, 983 lines) along the source split.
 */

import { describe, expect, it } from "vitest";
import {
  groupThread,
  isCalmTerminalStatus,
  type ThreadItem,
  type ThreadOverlay,
} from "./group-thread";
import type { ChannelMessage, ChannelMessageKind, MessageAuthorKind } from "../types";

let seq = 0;

/** Minimal ChannelMessage factory — only the fields the grouper reads. */
function msg(
  over: Partial<ChannelMessage> & { kind: ChannelMessageKind; authorKind: MessageAuthorKind }
): ChannelMessage {
  seq += 1;
  return {
    id: over.id ?? `m${seq}`,
    seq: over.seq ?? seq,
    channelId: "c1",
    authorUserId: over.authorUserId ?? "op",
    authorKind: over.authorKind,
    kind: over.kind,
    body: over.body ?? "",
    metadata: over.metadata ?? {},
    clientMsgId: null,
    createdAt: over.createdAt ?? new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    authorName: over.authorName ?? null,
    authorAvatarUrl: over.authorAvatarUrl ?? null,
  };
}

function sessions(items: ThreadItem[]) {
  return items.filter((i) => i.type === "session");
}

describe("session status + summary derivation", () => {
  it("collapses a full task_started -> reply -> task_finished run into one done session", () => {
    const t = "task-c1-5";
    const items = groupThread([
      msg({ kind: "message", authorKind: "user", body: "please do X" }),
      msg({ kind: "task_started", authorKind: "agent", body: "Started working on this request.", metadata: { taskId: t } }),
      msg({ kind: "message", authorKind: "agent", body: "Here is the answer.", metadata: { taskId: t } }),
      msg({ kind: "task_finished", authorKind: "agent", body: "Finished this request.", metadata: { taskId: t } }),
    ]);
    // human bubble + one session card.
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe("message");
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.status).toBe("done");
    expect(s[0].session.taskId).toBe(t);
    // Body has only the reply — lifecycle markers became the chip.
    expect(s[0].session.entries).toHaveLength(1);
    expect(s[0].session.entries[0].body).toBe("Here is the answer.");
    expect(s[0].session.summary).toBe("Here is the answer.");
  });

  it("marks a session active while task_started has no matching finish", () => {
    const t = "task-c1-1";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", body: "Started working on this request.", metadata: { taskId: t } }),
    ]);
    const s = sessions(items);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.status).toBe("active");
    // Summary falls back to the task body when no reply exists yet.
    expect(s[0].session.summary).toBe("Started working on this request.");
  });

  it("marks a session failed on task_failed", () => {
    const t = "task-c1-2";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({ kind: "task_failed", authorKind: "agent", body: "Could not complete this request.", metadata: { taskId: t } }),
    ]);
    const s = sessions(items);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.status).toBe("failed");
  });

  it("renders a decline-echo (task_failed + metadata.declined) as a distinct 'declined', not 'failed'", () => {
    // A denied request never spawned: the desktop posts the decision-echo as a
    // lone task_failed carrying the deterministic taskId + declined flag.
    const t = "task-c1-28";
    const items = groupThread([
      msg({
        kind: "task_failed",
        authorKind: "agent",
        body: "Request declined",
        metadata: { taskId: t, declined: true },
      }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.status).toBe("declined");
    // The lifecycle marker becomes the chip; no reply body was delivered.
    expect(s[0].session.entries).toHaveLength(0);
  });

  it("keeps a plain task_failed with NO declined flag as 'failed' (unchanged)", () => {
    const t = "task-c1-29";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({ kind: "task_failed", authorKind: "agent", body: "Crashed.", metadata: { taskId: t } }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("failed");
    expect(s.session.status).not.toBe("declined");
  });

  it("does NOT soften a real failure when declined is truthy-but-not-strictly-true", () => {
    // `declined` is read strictly (=== true) so an attacker-influenceable
    // truthy value (e.g. a string) can never disguise a genuine failure.
    const t = "task-c1-31";
    const items = groupThread([
      msg({
        kind: "task_failed",
        authorKind: "agent",
        body: "Crashed.",
        metadata: { taskId: t, declined: "yes" },
      }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("failed");
  });

  it("renders a cancelled outbound send (task_failed + metadata.dropped) as a calm 'dropped', not 'failed'", () => {
    // The operator cancelled the reply before it went out: the desktop posts a
    // lone task_failed carrying the dropped flag. Calm terminal, not an error.
    const t = "task-c1-32";
    const items = groupThread([
      msg({
        kind: "task_failed",
        authorKind: "agent",
        body: "Reply not sent",
        metadata: { taskId: t, dropped: true },
      }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("dropped");
    expect(s.session.status).not.toBe("failed");
    expect(isCalmTerminalStatus(s.session.status)).toBe(true);
    expect(s.session.entries).toHaveLength(0);
  });

  it("renders a mid-spawn crash (task_failed + metadata.interrupted) as a calm 'interrupted', not 'failed'", () => {
    // The app died mid-spawn: the desktop posts a task_failed carrying the
    // interrupted flag. A calm terminal outcome, not a scary red failure.
    const t = "task-c1-33";
    const items = groupThread([
      msg({
        kind: "task_failed",
        authorKind: "agent",
        body: "Interrupted",
        metadata: { taskId: t, interrupted: true },
      }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("interrupted");
    expect(s.session.status).not.toBe("failed");
    expect(isCalmTerminalStatus(s.session.status)).toBe(true);
  });

  it("does NOT soften a real failure when dropped is truthy-but-not-strictly-true", () => {
    // Every calm flag is read strictly (=== true); a truthy string can never
    // disguise a genuine failure as a calm 'dropped'.
    const t = "task-c1-34";
    const items = groupThread([
      msg({
        kind: "task_failed",
        authorKind: "agent",
        body: "Crashed.",
        metadata: { taskId: t, dropped: "yes" },
      }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("failed");
    expect(isCalmTerminalStatus(s.session.status)).toBe(false);
  });

  it("renders a turn/cost cap (task_failed + metadata.capped) as a calm 'capped'", () => {
    // A cap was hit: the desktop posts task_failed{capped}; the task stays OPEN.
    const t = "task-c1-40";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({
        kind: "task_failed",
        authorKind: "agent",
        body: "Turn limit reached",
        metadata: { taskId: t, capped: true },
      }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("capped");
    expect(s.session.status).not.toBe("failed");
    expect(isCalmTerminalStatus(s.session.status)).toBe(true);
    // A calm session-end with no restart surfaces the honest-Working signal.
    expect(s.session.calmEndStatus).toBe("capped");
  });

  it("renders an operator End (task_failed + metadata.ended) as a calm 'ended'", () => {
    const t = "task-c1-41";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({
        kind: "task_failed",
        authorKind: "agent",
        body: "Session ended",
        metadata: { taskId: t, ended: true },
      }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("ended");
    expect(isCalmTerminalStatus(s.session.status)).toBe(true);
    expect(s.session.calmEndStatus).toBe("ended");
  });

  it("does NOT soften a real failure when capped/ended are truthy-but-not-strictly-true", () => {
    // Same strict === true anti-spoof discipline as the other calm flags.
    for (const spoof of [{ capped: "true" }, { capped: 1 }, { ended: "true" }, { ended: 1 }]) {
      const items = groupThread([
        msg({
          kind: "task_failed",
          authorKind: "agent",
          body: "Crashed.",
          metadata: { taskId: "task-c1-42", ...spoof },
        }),
      ]);
      const s = sessions(items)[0];
      if (s.type !== "session") throw new Error("expected session");
      expect(s.session.status).toBe("failed");
      expect(s.session.calmEndStatus).toBeNull();
    }
  });

  it("clears calmEndStatus when a task_started restarts the session AFTER the calm end", () => {
    // A resume that re-opened work (later task_started) means the session is not
    // stopped — the honest-Working signal must clear so the card can say Working.
    const t = "task-c1-43";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", seq: 1, metadata: { taskId: t } }),
      msg({
        kind: "task_failed",
        authorKind: "agent",
        seq: 2,
        body: "Turn limit reached",
        metadata: { taskId: t, capped: true },
      }),
      msg({ kind: "task_started", authorKind: "agent", seq: 3, metadata: { taskId: t } }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.calmEndStatus).toBeNull();
  });

  it("leaves calmEndStatus null for request-level calm ends (declined/dropped) and real failures", () => {
    // declined/dropped are decisions where work never ran; a bare failure is a
    // genuine error. None replace the "Working…" line.
    for (const meta of [{ declined: true }, { dropped: true }, {}]) {
      const items = groupThread([
        msg({
          kind: "task_failed",
          authorKind: "agent",
          body: "…",
          metadata: { taskId: "task-c1-44", ...meta },
        }),
      ]);
      const s = sessions(items)[0];
      if (s.type !== "session") throw new Error("expected session");
      expect(s.session.calmEndStatus).toBeNull();
    }
  });

  it("keeps calmEndStatus for a calm session-end even when the overlay pins status active", () => {
    // The task row is still OPEN (capped/ended never close it) -> overlay status
    // "active", but calmEndStatus stays "capped" so the card stops saying Working.
    const t = "11111111-1111-4111-8111-111111111111";
    const overlays = new Map<string, ThreadOverlay>([
      [t, { status: "active", title: "Do the thing", mode: null, outcomeSummary: null }],
    ]);
    const items = groupThread(
      [
        msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
        msg({
          kind: "task_failed",
          authorKind: "agent",
          body: "Turn limit reached",
          metadata: { taskId: t, capped: true },
        }),
      ],
      overlays
    );
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("active");
    expect(s.session.calmEndStatus).toBe("capped");
  });

  it("leaves calmEndStatus null for an ordinary done session (no calm end)", () => {
    const t = "task-c1-45";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({ kind: "message", authorKind: "agent", body: "Done.", metadata: { taskId: t } }),
      msg({ kind: "task_finished", authorKind: "agent", metadata: { taskId: t } }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("done");
    expect(s.session.calmEndStatus).toBeNull();
  });

  it("prefers metadata.summary over reply text for the header summary", () => {
    const t = "task-c1-3";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t, summary: "Ship the report" } }),
      msg({ kind: "message", authorKind: "agent", body: "A very long detailed reply body", metadata: { taskId: t } }),
      msg({ kind: "task_finished", authorKind: "agent", metadata: { taskId: t } }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.summary).toBe("Ship the report");
  });

  it("marks a dropped-finish session with a delivered reply as Done", () => {
    const t = "task-c1-26";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      // A real reply landed; the terminating task_finished was dropped.
      msg({ kind: "message", authorKind: "agent", body: "The answer.", metadata: { taskId: t } }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("done");
    expect(s.session.entries.map((e) => e.body)).toEqual(["The answer."]);
  });

  it("lets the task overlay status win over the message-derived status", () => {
    // The task row is still open (mid-flight), so it must read 'active' even
    // though a delivered reply would derive 'done' on its own.
    const t = "8c2d1e90-4a5b-4f3c-9e1d-7b6a5c4d3e2f";
    const overlays = new Map<string, ThreadOverlay>([
      [t, { status: "active", title: "Ship the report", mode: "interactive" }],
    ]);
    const items = groupThread(
      [
        msg({ kind: "message", authorKind: "user", body: "please do X", metadata: { taskId: t } }),
        msg({ kind: "message", authorKind: "agent", body: "Answer.", metadata: { taskId: t } }),
      ],
      overlays
    );
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("active");
    // Overlay title + mode win for the header.
    expect(s.session.title).toBe("Ship the report");
    expect(s.session.mode).toBe("interactive");
  });

  it("surfaces the overlay's outcomeSummary and defaults a legacy group to null", () => {
    // An overlay (a first-class channel_tasks row) carrying an outcome summary
    // surfaces it on the session; a legacy session with no overlay stays null.
    const withRow = "8c2d1e90-4a5b-4f3c-9e1d-7b6a5c4d3e2f";
    const legacy = "task-c1-500";
    const overlays = new Map<string, ThreadOverlay>([
      [
        withRow,
        {
          status: "done",
          title: "Ship it",
          mode: "autonomous",
          outcomeSummary: "Shipped v1.7 to prod.",
        },
      ],
    ]);
    const items = groupThread(
      [
        msg({ kind: "message", authorKind: "agent", body: "done", metadata: { taskId: withRow } }),
        msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: legacy } }),
        msg({ kind: "message", authorKind: "agent", body: "legacy reply", metadata: { taskId: legacy } }),
      ],
      overlays
    );
    const s = sessions(items);
    const overlaid = s.find(
      (i) => i.type === "session" && i.session.taskId === withRow
    );
    const legacyGroup = s.find(
      (i) => i.type === "session" && i.session.taskId === legacy
    );
    if (overlaid?.type !== "session" || legacyGroup?.type !== "session") {
      throw new Error("expected both sessions");
    }
    expect(overlaid.session.outcomeSummary).toBe("Shipped v1.7 to prod.");
    expect(legacyGroup.session.outcomeSummary).toBeNull();
  });
});
