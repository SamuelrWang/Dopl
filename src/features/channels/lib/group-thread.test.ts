/**
 * THE GROUPING STATE MACHINE — how a flat transcript becomes cards, and what the
 * single open FALLBACK WINDOW will and will not absorb.
 *
 * §2 split (2026-08-08): this file was 983 lines and is the seam it kept when it
 * was cut. The status/summary DERIVATION moved to `group-thread-status.test.ts`,
 * the N-party pair-join and author gate to `group-thread-pairs.test.ts`, and the
 * render-lane helpers to `group-thread-render.test.ts` — the same four seams the
 * source split along. Each file rolls its own message factory, matching the
 * convention the sibling `group-thread-*.test.ts` files already set.
 */

import { describe, expect, it } from "vitest";
import {
  groupThread,
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

describe("groupThread", () => {
  it("keeps human messages and system rows as standalone items", () => {
    const items = groupThread([
      msg({ kind: "message", authorKind: "user", body: "hi" }),
      msg({ kind: "system", authorKind: "system", body: "joined" }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.type === "message")).toBe(true);
  });

  it("attaches an agent reply that lacks a taskId to the open session (fallback)", () => {
    const t = "task-c1-9";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      // Terminal-mode reply posted via MCP: no taskId of its own.
      msg({ kind: "message", authorKind: "agent", body: "Terminal reply." }),
    ]);
    expect(sessions(items)).toHaveLength(1);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.entries).toHaveLength(1);
    expect(s.session.entries[0].body).toBe("Terminal reply.");
    // task_started + a delivered reply but no finish -> Done: terminal mode is
    // detached and never emits a finish, so a delivered reply is the completion
    // signal (a perpetual "Active" pulse would be wrong).
    expect(s.session.status).toBe("done");
  });

  it("treats a taskId-tagged reply with no lifecycle markers as a done session", () => {
    const t = "task-c1-10";
    const items = groupThread([
      // task_started/finished never landed, but the reply carries the taskId.
      msg({ kind: "message", authorKind: "agent", body: "Answer.", metadata: { taskId: t } }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.status).toBe("done");
  });

  it("does NOT group a plain agent message with no taskId and no open session", () => {
    const items = groupThread([
      msg({ kind: "message", authorKind: "agent", body: "just chatting" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("message");
  });

  it("keeps two non-interleaving sessions as separate cards in order", () => {
    const a = "task-c1-1";
    const b = "task-c1-4";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: a } }),
      msg({ kind: "message", authorKind: "agent", body: "reply A", metadata: { taskId: a } }),
      msg({ kind: "task_finished", authorKind: "agent", metadata: { taskId: a } }),
      msg({ kind: "message", authorKind: "user", body: "second request" }),
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: b } }),
      msg({ kind: "message", authorKind: "agent", body: "reply B", metadata: { taskId: b } }),
      msg({ kind: "task_finished", authorKind: "agent", metadata: { taskId: b } }),
    ]);
    const kinds = items.map((i) => i.type);
    expect(kinds).toEqual(["session", "message", "session"]);
    const s = sessions(items);
    if (s[0].type !== "session" || s[1].type !== "session") throw new Error("expected sessions");
    expect(s[0].session.taskId).toBe(a);
    expect(s[1].session.taskId).toBe(b);
  });

  it("folds task_progress lines into the session body in order", () => {
    const t = "task-c1-7";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({ kind: "task_progress", authorKind: "agent", body: "Reading files…", metadata: { taskId: t } }),
      msg({ kind: "message", authorKind: "agent", body: "Done.", metadata: { taskId: t } }),
      msg({ kind: "task_finished", authorKind: "agent", metadata: { taskId: t } }),
    ]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.entries.map((e) => e.kind)).toEqual(["task_progress", "message"]);
  });

  it("keeps interleaved concurrent sessions apart — taskId routing never cross-absorbs", () => {
    const a = "task-c1-20";
    const b = "task-c1-21";
    // Two task_started fire before either finishes; their replies interleave.
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: a } }),
      msg({ kind: "message", authorKind: "agent", body: "A first", metadata: { taskId: a } }),
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: b } }),
      msg({ kind: "message", authorKind: "agent", body: "B first", metadata: { taskId: b } }),
      msg({ kind: "message", authorKind: "agent", body: "A second", metadata: { taskId: a } }),
      msg({ kind: "task_finished", authorKind: "agent", metadata: { taskId: b } }),
      msg({ kind: "task_finished", authorKind: "agent", metadata: { taskId: a } }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(2);
    if (s[0].type !== "session" || s[1].type !== "session") throw new Error("expected sessions");
    expect(s[0].session.taskId).toBe(a);
    expect(s[1].session.taskId).toBe(b);
    // A owns both its replies even though B opened in between; B owns only its
    // own — the second `task_started` never lets B swallow A's later reply.
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["A first", "A second"]);
    expect(s[1].session.entries.map((e) => e.body)).toEqual(["B first"]);
    expect(s[0].session.status).toBe("done");
    expect(s[1].session.status).toBe("done");
  });

  it("routes a no-taskId reply to the most-recent open session, not an earlier one", () => {
    const a = "task-c1-22";
    const b = "task-c1-23";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: a } }),
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: b } }),
      // No taskId of its own: it may only attach to the currently-open window
      // (b), never fold back into the superseded earlier session (a).
      msg({ kind: "message", authorKind: "agent", body: "which one?" }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(2);
    if (s[0].type !== "session" || s[1].type !== "session") throw new Error("expected sessions");
    expect(s[0].session.taskId).toBe(a);
    expect(s[0].session.entries).toHaveLength(0);
    expect(s[1].session.taskId).toBe(b);
    expect(s[1].session.entries.map((e) => e.body)).toEqual(["which one?"]);
  });

  it("does NOT absorb a later agent post once a human message intervened", () => {
    const t = "task-c1-24";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({ kind: "message", authorKind: "agent", body: "reply", metadata: { taskId: t } }),
      // Human row is a hard boundary: it closes the still-open (unfinished)
      // fallback window.
      msg({ kind: "message", authorKind: "user", body: "thanks" }),
      // Unrelated agent chat with no taskId must stand alone, not fold into t.
      msg({ kind: "message", authorKind: "agent", body: "different topic" }),
    ]);
    expect(sessions(items)).toHaveLength(1);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    expect(s.session.entries.map((e) => e.body)).toEqual(["reply"]);
    // The trailing agent post is a standalone plain bubble.
    const types = items.map((i) => i.type);
    expect(types).toEqual(["session", "message", "message"]);
    const last = items[items.length - 1];
    if (last.type !== "message") throw new Error("expected standalone message");
    expect(last.message.body).toBe("different topic");
  });

  it("does NOT absorb a later agent post once a system row intervened", () => {
    const t = "task-c1-25";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      msg({ kind: "system", authorKind: "system", body: "Alex joined" }),
      msg({ kind: "message", authorKind: "agent", body: "after the join" }),
    ]);
    const types = items.map((i) => i.type);
    expect(types).toEqual(["session", "message", "message"]);
    const s = sessions(items)[0];
    if (s.type !== "session") throw new Error("expected session");
    // Session opened but the system row closed its window before any reply.
    expect(s.session.entries).toHaveLength(0);
  });

  it("groups a human request and its agent replies sharing an explicit UUID taskId into one card", () => {
    // A first-class task: the requester's own message carries the task id, and
    // both replies share it. Everything folds into one card, including the
    // human request (old lifecycle grouping never absorbed a human row).
    const t = "3f1c8e42-9b7a-4c2e-8d6f-2a1b0c9d8e7f";
    const items = groupThread([
      msg({ kind: "message", authorKind: "user", body: "please do X", metadata: { taskId: t } }),
      msg({ kind: "message", authorKind: "agent", body: "On it.", metadata: { taskId: t } }),
      msg({ kind: "message", authorKind: "agent", body: "Done.", metadata: { taskId: t } }),
    ]);
    // A single session card, no standalone bubbles.
    expect(items).toHaveLength(1);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.taskId).toBe(t);
    // The requester's own message folds into the body alongside the replies.
    expect(s[0].session.entries.map((e) => e.body)).toEqual([
      "please do X",
      "On it.",
      "Done.",
    ]);
    // No overlay -> derived: delivered replies imply Done, and no first-class
    // title/mode.
    expect(s[0].session.status).toBe("done");
    expect(s[0].session.title).toBeNull();
    expect(s[0].session.mode).toBeNull();
  });

  it("terminal session groups its one reply and is Done; a later agent post is not absorbed", () => {
    const t = "task-c1-27";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", metadata: { taskId: t } }),
      // Terminal-mode reply, no taskId, no finish: joins the session and marks
      // it Done, and consumes the fallback window.
      msg({ kind: "message", authorKind: "agent", body: "terminal result" }),
      // A later unrelated no-taskId post — with no boundary in between — must
      // still stand alone, because the window was spent by the reply above.
      msg({ kind: "message", authorKind: "agent", body: "unrelated later" }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.status).toBe("done");
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["terminal result"]);
    const types = items.map((i) => i.type);
    expect(types).toEqual(["session", "message"]);
    const last = items[items.length - 1];
    if (last.type !== "message") throw new Error("expected standalone message");
    expect(last.message.body).toBe("unrelated later");
  });

  it("backfills the legacy seq-N request into its task-{channel}-N card as the opening entry", () => {
    // Legacy flow: the requester's proposal (seq 50, addressed to the responder,
    // no task id) spawned `task-c1-50`. It should be pulled into that card as the
    // opening entry, ahead of the agent reply, and removed from the loose stream.
    const t = "task-c1-50";
    const items = groupThread([
      msg({ seq: 50, kind: "message", authorKind: "user", authorUserId: "u_req", body: "the proposal", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 51, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
      msg({ seq: 52, kind: "message", authorKind: "agent", authorUserId: "u_resp", body: "done reply", metadata: { taskId: t } }),
      msg({ seq: 53, kind: "task_finished", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
    ]);
    // Just the one card — the standalone proposal was absorbed.
    expect(items).toHaveLength(1);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.taskId).toBe(t);
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["the proposal", "done reply"]);
    expect(s[0].session.status).toBe("done");
  });
});
