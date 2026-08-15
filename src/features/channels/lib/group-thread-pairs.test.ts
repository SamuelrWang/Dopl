/**
 * N-PARTY CHANNELS — pair-join, author gate, legacy seq-N backfill.
 *
 * ⚠ "One session per channel at a time" is a DM invariant that a three-member
 * channel breaks. The open fallback window is CHANNEL-WIDE while a session
 * belongs to ONE operator, so every case here asks: may THIS author take THAT
 * window. A stranger closes it, the requester leaves it standing, the responder
 * spends it.
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

describe("N-party grouping — pair-join, author gate, seq-N backfill", () => {
  it("joins an addressed requester follow-up into the open pair session", () => {
    // While open, a requester follow-up addressed to the responder (no task id)
    // still belongs to the exchange.
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
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["please do X", "On it.", "and also Y"]);
  });

  it("keeps a third party's addressed message OUT of a two-party session (3-member channel)", () => {
    // ⚠ A third party is not in {requester, responder} — must not fold into the
    // session, and stops the pair-join window.
    const t = "task-c1-60";
    const items = groupThread([
      msg({ seq: 60, kind: "message", authorKind: "user", authorUserId: "u_req", body: "start", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 61, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
      msg({ seq: 62, kind: "message", authorKind: "user", authorUserId: "u_third", body: "hello", metadata: { to_user_id: "u_resp" } }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["start"]);
    const last = items[items.length - 1];
    if (last.type !== "message") throw new Error("expected standalone message");
    expect(last.message.body).toBe("hello");
  });

  // ⚠ The fallback window is CHANNEL-WIDE but a session belongs to ONE
  // operator. Without the author gate, any untagged agent post falls into
  // whatever window is open, whoever wrote it.
  it("keeps a THIRD member's untagged agent post OUT of an open pair session (3-member channel)", () => {
    // A asks B; B's agent starts; C's agent posts an untagged, unaddressed note.
    // ⚠ Must not become the session's reply — that titles the card with a
    // stranger's text AND flips A's still-running request to Done.
    const t = "task-c1-1";
    const items = groupThread([
      msg({ seq: 1, kind: "message", authorKind: "user", authorUserId: "u_a", body: "please do X", metadata: { to_user_id: "u_b" } }),
      msg({ seq: 2, kind: "task_started", authorKind: "agent", authorUserId: "u_b", body: "Started working on this request.", metadata: { taskId: t } }),
      msg({ seq: 3, kind: "message", authorKind: "agent", authorUserId: "u_c", body: "unrelated note from C" }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["please do X"]);
    // ⚠ Card is NOT titled with C's text — the summary is A's own ask.
    expect(s[0].session.status).toBe("active");
    expect(s[0].session.summary).toBe("please do X");
    const last = items[items.length - 1];
    if (last.type !== "message") throw new Error("expected standalone message");
    expect(last.message.body).toBe("unrelated note from C");
  });

  it("does not let one pair's untagged reply land in another pair's concurrent session", () => {
    // T1 (A↔B) then T2 (C↔D). B's untagged terminal reply arrives while T2 holds
    // the channel-wide window. ⚠ Must stand alone, not become T2's reply.
    const t1 = "task-c1-10";
    const t2 = "task-c1-12";
    const items = groupThread([
      msg({ seq: 10, kind: "message", authorKind: "user", authorUserId: "u_a", body: "A asks B", metadata: { to_user_id: "u_b" } }),
      msg({ seq: 11, kind: "task_started", authorKind: "agent", authorUserId: "u_b", metadata: { taskId: t1 } }),
      msg({ seq: 12, kind: "message", authorKind: "user", authorUserId: "u_c", body: "C asks D", metadata: { to_user_id: "u_d" } }),
      msg({ seq: 13, kind: "task_started", authorKind: "agent", authorUserId: "u_d", metadata: { taskId: t2 } }),
      msg({ seq: 14, kind: "message", authorKind: "agent", authorUserId: "u_b", body: "B's untagged answer" }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(2);
    if (s[0].type !== "session" || s[1].type !== "session") throw new Error("expected sessions");
    expect(s[1].session.taskId).toBe(t2);
    expect(s[1].session.entries.map((e) => e.body)).toEqual(["C asks D"]);
    expect(s[1].session.status).toBe("active");
    expect(s[1].session.summary).toBe("C asks D");
    const last = items[items.length - 1];
    if (last.type !== "message") throw new Error("expected standalone message");
    expect(last.message.body).toBe("B's untagged answer");
  });

  it("does not let the FIRST responder's untagged reply join a SECOND responder's session", () => {
    // Two task_started from different responders; the untagged reply belongs to
    // the FIRST while the second holds the window.
    const t1 = "task-c1-20";
    const t2 = "task-c1-21";
    const items = groupThread([
      msg({ seq: 20, kind: "task_started", authorKind: "agent", authorUserId: "u_b", metadata: { taskId: t1 } }),
      msg({ seq: 21, kind: "task_started", authorKind: "agent", authorUserId: "u_d", metadata: { taskId: t2 } }),
      msg({ seq: 22, kind: "message", authorKind: "agent", authorUserId: "u_b", body: "B answers late" }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(2);
    if (s[0].type !== "session" || s[1].type !== "session") throw new Error("expected sessions");
    expect(s[0].session.entries).toHaveLength(0);
    expect(s[1].session.taskId).toBe(t2);
    expect(s[1].session.entries).toHaveLength(0);
    expect(s[1].session.status).toBe("active");
    const last = items[items.length - 1];
    if (last.type !== "message") throw new Error("expected standalone message");
    expect(last.message.body).toBe("B answers late");
  });

  it("still folds the open session's OWN responder's untagged reply in (author gate is not a blanket close)", () => {
    // The gate must not break the case the window exists for: the responder's
    // own terminal-mode reply, no taskId, 3-member channel.
    const t = "task-c1-30";
    const items = groupThread([
      msg({ seq: 30, kind: "message", authorKind: "user", authorUserId: "u_a", body: "please do X", metadata: { to_user_id: "u_b" } }),
      msg({ seq: 31, kind: "task_started", authorKind: "agent", authorUserId: "u_b", metadata: { taskId: t } }),
      msg({ seq: 32, kind: "message", authorKind: "agent", authorUserId: "u_b", body: "Here is the answer." }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["please do X", "Here is the answer."]);
    expect(s[0].session.status).toBe("done");
  });

  it("closes the window on a third member's untagged agent post, so a LATER responder reply stands alone", () => {
    // A stranger's post means the exchange moved on — nothing after it folds in.
    const t = "task-c1-40";
    const items = groupThread([
      msg({ seq: 40, kind: "task_started", authorKind: "agent", authorUserId: "u_b", metadata: { taskId: t } }),
      msg({ seq: 41, kind: "message", authorKind: "agent", authorUserId: "u_c", body: "stranger" }),
      msg({ seq: 42, kind: "message", authorKind: "agent", authorUserId: "u_b", body: "responder, too late" }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.entries).toHaveLength(0);
    expect(items.map((i) => i.type)).toEqual(["session", "message", "message"]);
  });

  it("lets the REQUESTER's untagged agent post stand alone without spending the window", () => {
    // Inside the pair but not the responder: does not join, but is no stranger
    // either, so the responder's real reply still lands.
    const t = "task-c1-45";
    const items = groupThread([
      msg({ seq: 45, kind: "message", authorKind: "user", authorUserId: "u_a", body: "please do X", metadata: { to_user_id: "u_b" } }),
      msg({ seq: 46, kind: "task_started", authorKind: "agent", authorUserId: "u_b", metadata: { taskId: t } }),
      msg({ seq: 47, kind: "message", authorKind: "agent", authorUserId: "u_a", body: "A's own agent muses" }),
      msg({ seq: 48, kind: "message", authorKind: "agent", authorUserId: "u_b", body: "Here is the answer." }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["please do X", "Here is the answer."]);
    const standalone = items.filter((i) => i.type === "message");
    expect(standalone).toHaveLength(1);
    if (standalone[0].type !== "message") throw new Error("expected message");
    expect(standalone[0].message.body).toBe("A's own agent muses");
  });

  it("keeps the anonymous-author transcript byte-for-byte (responder unknown -> fallback unchanged)", () => {
    // No author ids at all (legacy/anonymous) = no responder to compare, so the
    // window behaves as before.
    const t = "task-c1-50";
    const items = groupThread([
      msg({ kind: "task_started", authorKind: "agent", authorUserId: null, metadata: { taskId: t } }),
      msg({ kind: "message", authorKind: "agent", authorUserId: null, body: "anonymous reply" }),
    ]);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["anonymous reply"]);
    expect(s[0].session.status).toBe("done");
  });

  it("leaves a lone decision-echo card untouched by the seq-N backfill", () => {
    // Denied request never started — lone task_failed echo, no task_started.
    // ⚠ The seq-N opener must NOT be pulled in.
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
    // A follow-up after task_finished is outside the window and stays standalone.
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
    // First session's task_finished never arrives. The responder's addressed
    // no-taskId reply joins the card AND closes the window, so the next
    // exchange's seq-N opener backfills into its own card.
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

  it("DM (2-member): an auto-addressed request + the peer agent's addressed reply group into one done pair card", () => {
    // DM auto-address → peer's agent spawns (task_started, legacy id) and
    // self-posts an addressed reply with no task id. Backfill + pair-join group
    // both into one card with NO grouping-logic change.
    const t = "task-c1-200";
    const items = groupThread([
      msg({ seq: 200, kind: "message", authorKind: "user", authorUserId: "u_req", body: "please review", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 201, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
      msg({ seq: 202, kind: "message", authorKind: "agent", authorUserId: "u_resp", body: "reviewed", metadata: { to_user_id: "u_req" } }),
    ]);
    expect(items).toHaveLength(1);
    const s = sessions(items);
    expect(s).toHaveLength(1);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.taskId).toBe(t);
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["please review", "reviewed"]);
    // A delivered agent reply implies Done even with no finish marker.
    expect(s[0].session.status).toBe("done");
  });

  it("DM (2-member): a legacy task-{ch}-{N} start backfills its auto-addressed seq-N opener as the opening entry", () => {
    // The DM opener spawned `task-c1-300`; backfill pulls it in as the opening
    // entry ahead of the agent reply and removes it from the loose stream.
    const t = "task-c1-300";
    const items = groupThread([
      msg({ seq: 300, kind: "message", authorKind: "user", authorUserId: "u_req", body: "the DM proposal", metadata: { to_user_id: "u_resp" } }),
      msg({ seq: 301, kind: "task_started", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
      msg({ seq: 302, kind: "message", authorKind: "agent", authorUserId: "u_resp", body: "done reply", metadata: { taskId: t } }),
      msg({ seq: 303, kind: "task_finished", authorKind: "agent", authorUserId: "u_resp", metadata: { taskId: t } }),
    ]);
    expect(items).toHaveLength(1);
    const s = sessions(items);
    if (s[0].type !== "session") throw new Error("expected session");
    expect(s[0].session.taskId).toBe(t);
    expect(s[0].session.entries.map((e) => e.body)).toEqual(["the DM proposal", "done reply"]);
    expect(s[0].session.status).toBe("done");
  });
});
