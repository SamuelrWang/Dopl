import { describe, expect, it } from "vitest";
import {
  deriveMessageReceipt,
  isCalmReceiptStatus,
  RECEIPT_LABEL,
} from "./message-receipt";
import type {
  ChannelMessage,
  ChannelMessageKind,
  MessageAuthorKind,
} from "../types";

let seq = 0;

/** Minimal ChannelMessage factory — only the fields the receipt fn reads. */
function msg(
  over: Partial<ChannelMessage> & {
    kind: ChannelMessageKind;
    authorKind: MessageAuthorKind;
  },
): ChannelMessage {
  seq += 1;
  return {
    id: over.id ?? `m${seq}`,
    seq: over.seq ?? seq,
    channelId: over.channelId ?? "c1",
    authorUserId: over.authorUserId ?? "op",
    authorKind: over.authorKind,
    kind: over.kind,
    body: over.body ?? "",
    metadata: over.metadata ?? {},
    clientMsgId: null,
    createdAt:
      over.createdAt ?? new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    authorName: over.authorName ?? null,
    authorAvatarUrl: over.authorAvatarUrl ?? null,
  };
}

const ME = "me";
const PEER = "peer";

describe("deriveMessageReceipt", () => {
  // (1)
  it("returns null for another user's message", () => {
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: "other",
      body: "hi",
      metadata: { to_user_id: PEER },
    });
    expect(deriveMessageReceipt(mine, [mine], ME)).toBeNull();
  });

  // (2)
  it("returns null for my unaddressed broadcast (no recipient, no task)", () => {
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "anyone around?",
    });
    expect(deriveMessageReceipt(mine, [mine], ME)).toBeNull();
  });

  // (3)
  it("returns 'sent' for my addressed message with no lifecycle yet", () => {
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "please do X",
      metadata: { to_user_id: PEER },
    });
    expect(deriveMessageReceipt(mine, [mine], ME)).toBe("sent");
  });

  // (4)
  it("returns 'working' for an explicit-taskId message with a later task_started", () => {
    const t = "3f1c8e42-9b7a-4c2e-8d6f-2a1b0c9d8e7f";
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "please do X",
      metadata: { taskId: t, to_user_id: PEER },
    });
    const started = msg({
      kind: "task_started",
      authorKind: "agent",
      authorUserId: PEER,
      metadata: { taskId: t },
    });
    expect(deriveMessageReceipt(mine, [mine, started], ME)).toBe("working");
  });

  // (5)
  it("returns 'replied' once a linked agent reply lands on the explicit task", () => {
    const t = "3f1c8e42-9b7a-4c2e-8d6f-2a1b0c9d8e7f";
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "please do X",
      metadata: { taskId: t, to_user_id: PEER },
    });
    const started = msg({
      kind: "task_started",
      authorKind: "agent",
      authorUserId: PEER,
      metadata: { taskId: t },
    });
    const reply = msg({
      kind: "message",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Done.",
      metadata: { taskId: t },
    });
    expect(deriveMessageReceipt(mine, [mine, started, reply], ME)).toBe(
      "replied",
    );
  });

  // (6)
  it("links a legacy task-{ch}-{N} start by the opener's seq (working, then replied)", () => {
    // The desktop spawner mints `task-{channelId}-{seq}` for the opener at seq N;
    // the receipt reconstructs that id from the message's own channelId + seq.
    const mine = msg({
      seq: 500,
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "the proposal",
      metadata: { to_user_id: PEER },
    });
    const legacyId = `task-c1-500`;
    const started = msg({
      seq: 501,
      kind: "task_started",
      authorKind: "agent",
      authorUserId: PEER,
      metadata: { taskId: legacyId },
    });
    expect(deriveMessageReceipt(mine, [mine, started], ME)).toBe("working");
    const reply = msg({
      seq: 502,
      kind: "message",
      authorKind: "agent",
      authorUserId: PEER,
      body: "done reply",
      metadata: { taskId: legacyId },
    });
    expect(deriveMessageReceipt(mine, [mine, started, reply], ME)).toBe(
      "replied",
    );
  });

  // (7)
  it("returns 'replied' for a pair reply (agent -> me) with no taskId", () => {
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "please do X",
      metadata: { to_user_id: PEER },
    });
    const reply = msg({
      kind: "message",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Here you go.",
      metadata: { to_user_id: ME },
    });
    expect(deriveMessageReceipt(mine, [mine, reply], ME)).toBe("replied");
  });

  // (8)
  it("returns 'declined' for a linked task_failed carrying declined:true", () => {
    const t = "8c2d1e90-4a5b-4f3c-9e1d-7b6a5c4d3e2f";
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "please do X",
      metadata: { taskId: t, to_user_id: PEER },
    });
    const failed = msg({
      kind: "task_failed",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Request declined",
      metadata: { taskId: t, declined: true },
    });
    expect(deriveMessageReceipt(mine, [mine, failed], ME)).toBe("declined");
  });

  // (9)
  it("returns 'failed' for a bare linked task_failed", () => {
    const t = "8c2d1e90-4a5b-4f3c-9e1d-7b6a5c4d3e2f";
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "please do X",
      metadata: { taskId: t, to_user_id: PEER },
    });
    const failed = msg({
      kind: "task_failed",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Crashed.",
      metadata: { taskId: t },
    });
    expect(deriveMessageReceipt(mine, [mine, failed], ME)).toBe("failed");
  });

  // (10)
  it("maps dropped:true -> 'dropped' and interrupted:true -> 'interrupted'", () => {
    const mkFailed = (t: string, flag: Record<string, unknown>) => {
      const mine = msg({
        kind: "message",
        authorKind: "user",
        authorUserId: ME,
        body: "please do X",
        metadata: { taskId: t, to_user_id: PEER },
      });
      const failed = msg({
        kind: "task_failed",
        authorKind: "agent",
        authorUserId: PEER,
        metadata: { taskId: t, ...flag },
      });
      return deriveMessageReceipt(mine, [mine, failed], ME);
    };
    expect(mkFailed("t-dropped", { dropped: true })).toBe("dropped");
    expect(mkFailed("t-interrupted", { interrupted: true })).toBe(
      "interrupted",
    );
  });

  // (11)
  it("keeps a truthy-not-true calm flag as 'failed' (strict === true)", () => {
    const t = "t-strict";
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "please do X",
      metadata: { taskId: t, to_user_id: PEER },
    });
    const failed = msg({
      kind: "task_failed",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Crashed.",
      metadata: { taskId: t, declined: "yes" },
    });
    expect(deriveMessageReceipt(mine, [mine, failed], ME)).toBe("failed");
  });

  // (12)
  it("lets a terminal failure win over an earlier agent reply", () => {
    const t = "t-terminal-wins";
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "please do X",
      metadata: { taskId: t, to_user_id: PEER },
    });
    const reply = msg({
      kind: "message",
      authorKind: "agent",
      authorUserId: PEER,
      body: "partial",
      metadata: { taskId: t },
    });
    const failed = msg({
      kind: "task_failed",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Crashed.",
      metadata: { taskId: t },
    });
    expect(deriveMessageReceipt(mine, [mine, reply, failed], ME)).toBe("failed");
  });

  // (13)
  it("returns 'replied' for a DM auto-addressed message once the peer agent replies", () => {
    const mine = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "can you check this?",
      metadata: { to_user_id: PEER },
    });
    const reply = msg({
      kind: "message",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Checked, all good.",
      metadata: { to_user_id: ME },
    });
    expect(deriveMessageReceipt(mine, [mine, reply], ME)).toBe("replied");
  });

  it("binds a no-taskId pair-reply to the NEAREST preceding ask only (stacked asks stay 'sent')", () => {
    // Two quick asks to the same peer, then one agent reply: the reply answers
    // the SECOND ask. The first must stay "sent" — one reply must never light
    // up "Replied" on every stacked ask before it.
    const askX = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "do X",
      metadata: { to_user_id: PEER },
    });
    const askY = msg({
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "do Y",
      metadata: { to_user_id: PEER },
    });
    const reply = msg({
      kind: "message",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Y done.",
      metadata: { to_user_id: ME },
    });
    const thread = [askX, askY, reply];
    expect(deriveMessageReceipt(askX, thread, ME)).toBe("sent");
    expect(deriveMessageReceipt(askY, thread, ME)).toBe("replied");
  });

  // Q10 (web-render half) — the legacy `task-{channelId}-{seq}` id is DERIVABLE
  // by any channel member (the DTO exposes `seq`), and the server does not gate
  // a non-UUID taskId on participation (F-083 / P2). Linking on string equality
  // alone therefore let any third member stamp a chip on someone else's request.
  // Every fixture below is a 3-party channel: ME, PEER, and THIRD.
  const THIRD = "third";

  it("ignores a THIRD member's task_failed carrying my legacy id (no forged 'Failed')", () => {
    const mine = msg({
      seq: 500,
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "the proposal",
      metadata: { to_user_id: PEER },
    });
    const forged = msg({
      seq: 501,
      kind: "task_failed",
      authorKind: "agent",
      authorUserId: THIRD,
      body: "Crashed.",
      metadata: { taskId: "task-c1-500" },
    });
    expect(deriveMessageReceipt(mine, [mine, forged], ME)).toBe("sent");
  });

  it("ignores a THIRD member's forged 'replied' and 'working' on my legacy id", () => {
    const mine = msg({
      seq: 600,
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "the proposal",
      metadata: { to_user_id: PEER },
    });
    const legacyId = "task-c1-600";
    const forgedStart = msg({
      seq: 601,
      kind: "task_started",
      authorKind: "agent",
      authorUserId: THIRD,
      metadata: { taskId: legacyId },
    });
    const forgedReply = msg({
      seq: 602,
      kind: "message",
      authorKind: "agent",
      authorUserId: THIRD,
      body: "All done!",
      metadata: { taskId: legacyId },
    });
    expect(deriveMessageReceipt(mine, [mine, forgedStart], ME)).toBe("sent");
    expect(
      deriveMessageReceipt(mine, [mine, forgedStart, forgedReply], ME),
    ).toBe("sent");
  });

  it("still reports the addressee's own legacy-linked lifecycle (gate is party-scoped, not a blanket drop)", () => {
    // Same 3-party channel, but the events come from PEER — the addressee whose
    // desktop mints that id. These must keep working exactly as before.
    const mine = msg({
      seq: 700,
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "the proposal",
      metadata: { to_user_id: PEER },
    });
    const legacyId = "task-c1-700";
    const noise = msg({
      seq: 701,
      kind: "message",
      authorKind: "agent",
      authorUserId: THIRD,
      body: "unrelated",
      metadata: { taskId: legacyId },
    });
    const failed = msg({
      seq: 702,
      kind: "task_failed",
      authorKind: "agent",
      authorUserId: PEER,
      body: "Crashed.",
      metadata: { taskId: legacyId },
    });
    expect(deriveMessageReceipt(mine, [mine, noise, failed], ME)).toBe("failed");
  });

  it("accepts my OWN legacy-linked event (I am a party to my own exchange)", () => {
    const mine = msg({
      seq: 800,
      kind: "message",
      authorKind: "user",
      authorUserId: ME,
      body: "the proposal",
      metadata: { to_user_id: PEER },
    });
    const dropped = msg({
      seq: 801,
      kind: "task_failed",
      authorKind: "agent",
      authorUserId: ME,
      metadata: { taskId: "task-c1-800", dropped: true },
    });
    expect(deriveMessageReceipt(mine, [mine, dropped], ME)).toBe("dropped");
  });

  it("has a label and calm classification for every status", () => {
    expect(RECEIPT_LABEL.working).toBe("Accepted, agent working");
    expect(RECEIPT_LABEL.dropped).toBe("Reply not sent");
    expect(isCalmReceiptStatus("declined")).toBe(true);
    expect(isCalmReceiptStatus("dropped")).toBe(true);
    expect(isCalmReceiptStatus("interrupted")).toBe(true);
    expect(isCalmReceiptStatus("failed")).toBe(false);
    expect(isCalmReceiptStatus("replied")).toBe(false);
  });
});
