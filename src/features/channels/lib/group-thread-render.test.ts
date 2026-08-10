/**
 * THE CARD READ SIDE — `splitSessionEntries` lanes and `truncateSummary`.
 *
 * Split out of `group-thread.test.ts` (§2, 983 lines) along the source split
 * (`group-thread-render.ts`). The REOPEN echo's notices lane has its own file,
 * `group-thread-reopen.test.ts`, next to the marker it is about.
 */

import { describe, expect, it } from "vitest";
import {
  groupThread,
  splitSessionEntries,
  truncateSummary,
  type ThreadItem,
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

describe("truncateSummary", () => {
  it("collapses whitespace and leaves short text intact", () => {
    expect(truncateSummary("hello   world\nthere")).toBe("hello world there");
  });
  it("truncates with an ellipsis past the max", () => {
    expect(truncateSummary("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("splitSessionEntries", () => {
  it("separates task_progress milestones from chat replies, preserving order", () => {
    const entries = [
      msg({ kind: "task_progress", authorKind: "agent", body: "step one" }),
      msg({ kind: "message", authorKind: "agent", body: "reply one" }),
      msg({ kind: "task_progress", authorKind: "agent", body: "step two" }),
      msg({ kind: "message", authorKind: "user", body: "a follow-up" }),
    ];
    const { milestones, replies } = splitSessionEntries(entries);
    expect(milestones.map((m) => m.body)).toEqual(["step one", "step two"]);
    expect(replies.map((m) => m.body)).toEqual(["reply one", "a follow-up"]);
  });

  it("returns empty lanes for an empty entry list", () => {
    const { milestones, replies, notices } = splitSessionEntries([]);
    expect(milestones).toHaveLength(0);
    expect(replies).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });

  it("routes a session_ended marker to notices, never milestones (F-183)", () => {
    // The key is spelled as a LITERAL on purpose — a fixture built from the
    // constant under test would survive a rename that desynced it from the
    // server's reserved key (the F-176 lesson, pinned the same way there).
    const lanes = splitSessionEntries([
      msg({ kind: "task_progress", authorKind: "agent", body: "Found the bug" }),
      msg({
        kind: "task_progress",
        authorKind: "user",
        body: "Session ended",
        metadata: { session_ended: true },
      }),
    ]);
    expect(lanes.milestones.map((m) => m.body)).toEqual(["Found the bug"]);
    expect(lanes.notices.map((n) => n.body)).toEqual(["Session ended"]);
  });

  it("keeps a session_ended notice OUT of the lane but IN the card's end state — the two jobs F-183 separates", () => {
    const t = "task-c1-701";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "user", metadata: { taskId: t } }),
      msg({
        kind: "task_progress",
        authorKind: "user",
        body: "Session ended",
        metadata: { taskId: t, session_ended: true },
      }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    const lanes = splitSessionEntries(s.session.entries);
    expect(lanes.milestones).toEqual([]);
    expect(lanes.notices).toHaveLength(1);
    // calmEndStatus is CURRENT STATE and stays — routing the history entry to
    // notices must not silence the card's honest "the session stopped" note.
    expect(s.session.calmEndStatus).toBe("ended");
  });

  it("leaves the notices lane empty for a session with no status markers", () => {
    // The lane exists for reserved server-stamped markers only (F-176: the
    // reopen echo — see `group-thread-reopen.test.ts`). An ordinary transcript
    // is byte-for-byte what it was, and both other lanes still fill.
    const { milestones, replies, notices } = splitSessionEntries([
      msg({ kind: "task_progress", authorKind: "agent", body: "step one" }),
      msg({ kind: "message", authorKind: "agent", body: "reply one" }),
    ]);
    expect(notices).toHaveLength(0);
    expect(milestones).toHaveLength(1);
    expect(replies).toHaveLength(1);
  });

  it("splits a grouped session's entries the same way the card renders them", () => {
    // groupThread keeps task_progress inside entries (byte-for-byte unchanged);
    // the render-layer split then pulls the two lanes apart.
    const t = "task-c1-700";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({ kind: "task_progress", authorKind: "agent", body: "Reading files…", metadata: { taskId: t } }),
      msg({ kind: "message", authorKind: "agent", body: "Done.", metadata: { taskId: t } }),
      msg({ kind: "task_finished", authorKind: "agent", metadata: { taskId: t } }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.entries.map((e) => e.kind)).toEqual([
      "task_progress",
      "message",
    ]);
    const { milestones, replies } = splitSessionEntries(s.session.entries);
    expect(milestones.map((m) => m.body)).toEqual(["Reading files…"]);
    expect(replies.map((m) => m.body)).toEqual(["Done."]);
  });
});
