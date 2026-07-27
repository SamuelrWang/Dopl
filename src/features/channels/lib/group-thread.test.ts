import { describe, expect, it } from "vitest";
import {
  groupThread,
  isCalmTerminalStatus,
  truncateSummary,
  type TaskOverlay,
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

  it("lets the task overlay status win over the message-derived status", () => {
    // The task row is still open (mid-flight), so it must read 'active' even
    // though a delivered reply would derive 'done' on its own.
    const t = "8c2d1e90-4a5b-4f3c-9e1d-7b6a5c4d3e2f";
    const overlays = new Map<string, TaskOverlay>([
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

  it("joins an addressed requester follow-up into the open pair session", () => {
    // While the session is open, a follow-up from the requester addressed to the
    // responder (no task id of its own) still belongs to the exchange.
    const t = "task-c1-100";
    const items = groupThread([
      msg({ seq: 100, kind: "message", authorKind: "user", authorUserId: "u_req", body: "please do X", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 101, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
      msg({ seq: 102, kind: "message", authorKind: "agent", authorUserId: "u_resp", body: "On it.", metadata: { taskId: t } }),
      msg({ seq: 103, kind: "message", authorKind: "user", authorUserId: "u_req", body: "and also Y", metadata: { to_user_id: "u_resp" } }),
    ]);
    expect(items).toHaveLength(1);
    const s = sessions(items);
    if (s[0].type !== "session") throw new Error("expected session");
    // Backfilled opener + agent reply + requester follow-up, in order.
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["please do X", "On it.", "and also Y"]);
  });

  it("keeps a third party's addressed message OUT of a two-party session (3-member channel)", () => {
    // In a channel with a third member, a message to/from that third party is
    // not in {requester, responder} — it must not fold into the session, and it
    // stops the pair-join window.
    const t = "task-c1-60";
    const items = groupThread([
      msg({ seq: 60, kind: "message", authorKind: "user", authorUserId: "u_req", body: "start", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 61, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
      msg({ seq: 62, kind: "message", authorKind: "user", authorUserId: "u_third", body: "hello", metadata: { to_user_id: "u_resp" } }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    // Only the backfilled opener — the third party's message is not an entry.
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["start"]);
    const last = items[items.length - 1];
    if (last.type !== "message") throw new Error("expected standalone message");
    expect(last.message.body).toBe("hello");
  });

  it("leaves a lone decision-echo card untouched by the seq-N backfill", () => {
    // A denied request never started: a lone task_failed decision echo carrying
    // the deterministic id, with no task_started. The seq-N opener must NOT be
    // pulled in (nothing to open into).
    const t = "task-c1-70";
    const items = groupThread([
      msg({ seq: 70, kind: "message", authorKind: "user", authorUserId: "u_req", body: "the proposal", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 71, kind: "task_failed", authorKind: "agent", authorUserId: "u_resp", body: "Request declined", metadata: { taskId: t, declined: true } }),
    ]);
    expect(items).toHaveLength(2);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.status).toBe("declined");
    expect(s[0].session.entries).toHaveLength(0);
    const standalone = items.find((i) => i.type === "message");
    if (!standalone || standalone.type !== "message") throw new Error("expected standalone message");
    expect(standalone.message.body).toBe("the proposal");
  });

  it("stops accepting addressed follow-ups once the session has finished", () => {
    // A follow-up that arrives after task_finished is outside the window and
    // stays standalone; only the backfilled opener remains in the card.
    const t = "task-c1-80";
    const items = groupThread([
      msg({ seq: 80, kind: "message", authorKind: "user", authorUserId: "u_req", body: "start", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 81, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
      msg({ seq: 82, kind: "task_finished", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
      msg({ seq: 83, kind: "message", authorKind: "user", authorUserId: "u_req", body: "more?", metadata: { to_user_id: "u_resp" } }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["start"]);
    expect(s[0].session.status).toBe("done");
    const last = items[items.length - 1];
    if (last.type !== "message") throw new Error("expected standalone message");
    expect(last.message.body).toBe("more?");
  });

  it("a responder's pair-joined reply spends the window so the next task's opener is not absorbed", () => {
    // The first session's task_finished never arrives (dropped). The responder's
    // addressed no-taskId reply joins the card AND closes the window, so the
    // next exchange's seq-N opener stays standalone and backfills into its own
    // card instead of being swallowed by the stale one.
    const t1 = "task-c1-70";
    const t2 = "task-c1-73";
    const items = groupThread([
      msg({ seq: 70, kind: "message", authorKind: "user", authorUserId: "u_req", body: "first ask", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 71, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t1 } }),
      msg({ seq: 72, kind: "message", authorKind: "agent", authorUserId: "u_resp", body: "here you go", metadata: { to_user_id: "u_req" } }),
      msg({ seq: 73, kind: "message", authorKind: "user", authorUserId: "u_req", body: "second ask", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 74, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t2 } }),
      msg({ seq: 75, kind: "message", authorKind: "agent", authorUserId: "u_resp", body: "second answer", metadata: { taskId: t2 } }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(2);
    if (s[0].type !== "session" || s[1].type !== "session") throw new Error("expected sessions");
    expect(s[0].session.taskId).toBe(t1);
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["first ask", "here you go"]);
    expect(s[1].session.taskId).toBe(t2);
    expect(s[1].session.entries.map((e) => e.body)).toEqual(["second ask", "second answer"]);
  });
});

describe("truncateSummary", () => {
  it("collapses whitespace and leaves short text intact", () => {
    expect(truncateSummary("hello   world\nthere")).toBe("hello world there");
  });
  it("truncates with an ellipsis past the max", () => {
    expect(truncateSummary("abcdefghij", 5)).toBe("abcd…");
  });
});
