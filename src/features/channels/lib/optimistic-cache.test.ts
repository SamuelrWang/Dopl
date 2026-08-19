/**
 * The rules that decide whether an optimistic send can duplicate a message.
 *
 * The server has always had the answer — `channel_messages.client_msg_id` is
 * unique per channel and `postMessage` short-circuits on it — and until now no
 * client sent one, so the question never came up on this side. It does now:
 * the pending row and the saved row are two objects describing one message,
 * and every case below is a way they could both end up in the transcript.
 */

import { describe, expect, it } from "vitest";
import type { ChannelMessage, ChannelThread } from "../types";
import {
  addTrustRuleRow,
  appendPendingMessage,
  buildPendingMessage,
  buildPendingThread,
  dropConsentRequest,
  isPendingId,
  newClientMsgId,
  patchChannel,
  pendingMessageId,
  reconcileMessage,
  removeTrustRuleRow,
  retagPendingMessage,
  setFavorite,
  setToolProfile,
  upsertThread,
  type MessagesCache,
} from "./optimistic-cache";

const CHANNEL = "11111111-1111-4111-8111-111111111111";
const ME = "user-me";

function saved(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: "srv-1",
    seq: 5,
    channelId: CHANNEL,
    authorUserId: ME,
    authorKind: "user",
    kind: "message",
    body: "hello",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-07T10:00:00.000Z",
    authorName: "Sam",
    authorAvatarUrl: null,
    ...overrides,
  };
}

function cacheOf(...messages: ChannelMessage[]): MessagesCache {
  return { messages };
}

describe("pending message rows", () => {
  it("builds a real ChannelMessage with a pending id and the idempotency key", () => {
    const key = "c-1";
    const row = buildPendingMessage(cacheOf(saved({ seq: 12 })), {
      channelId: CHANNEL,
      clientMsgId: key,
      body: "typed",
      authorUserId: ME,
      authorName: "Sam",
      createdAt: "2026-08-07T10:01:00.000Z",
    });
    expect(row.id).toBe(pendingMessageId(key));
    expect(isPendingId(row.id)).toBe(true);
    expect(row.clientMsgId).toBe(key);
    expect(row.authorKind).toBe("user");
    expect(row.authorName).toBe("Sam");
    // Sorts after everything already on screen.
    expect(row.seq).toBe(13);
  });

  it("does not seed an unloaded transcript with a one-message list", () => {
    const row = buildPendingMessage(undefined, {
      channelId: CHANNEL,
      clientMsgId: "c-1",
      body: "typed",
      authorUserId: ME,
    });
    expect(appendPendingMessage(undefined, row)).toBeUndefined();
  });

  it("IDEMPOTENCY: re-appending the same clientMsgId replaces, never duplicates", () => {
    const key = "c-retry";
    const first = buildPendingMessage(cacheOf(), {
      channelId: CHANNEL,
      clientMsgId: key,
      body: "attempt one",
      authorUserId: ME,
    });
    const once = appendPendingMessage(cacheOf(), first);
    const twice = appendPendingMessage(once, first);
    expect(twice?.messages).toHaveLength(1);
    expect(twice?.messages[0].clientMsgId).toBe(key);
  });

  it("IDEMPOTENCY: the saved row replaces its pending twin IN PLACE", () => {
    const key = "c-2";
    const pending = buildPendingMessage(cacheOf(saved({ id: "srv-0", seq: 1 })), {
      channelId: CHANNEL,
      clientMsgId: key,
      body: "typed",
      authorUserId: ME,
    });
    const optimistic = appendPendingMessage(
      cacheOf(saved({ id: "srv-0", seq: 1 })),
      pending
    );
    const settled = reconcileMessage(
      optimistic,
      saved({ id: "srv-9", seq: 2, clientMsgId: key, body: "typed" })
    );
    expect(settled?.messages.map((m) => m.id)).toEqual(["srv-0", "srv-9"]);
    expect(settled?.messages.some((m) => isPendingId(m.id))).toBe(false);
  });

  it("IDEMPOTENCY: a retry that gets back the FIRST attempt's stored row still collapses to one", () => {
    // What the server does on a repeat `clientMsgId`: it answers with the row
    // the first attempt created. The cache must land on one message either way.
    const key = "c-3";
    const stored = saved({ id: "srv-1", clientMsgId: key, body: "typed" });
    const afterFirst = reconcileMessage(cacheOf(), stored);
    const afterRetry = reconcileMessage(afterFirst, stored);
    expect(afterRetry?.messages).toHaveLength(1);
    expect(afterRetry?.messages[0].id).toBe("srv-1");
  });

  it("appends a saved row that has no pending twin (someone else's message)", () => {
    const settled = reconcileMessage(
      cacheOf(saved({ id: "srv-0" })),
      saved({ id: "srv-1", authorUserId: "other" })
    );
    expect(settled?.messages.map((m) => m.id)).toEqual(["srv-0", "srv-1"]);
  });

  it("re-points a pending row at the thread id the server minted", () => {
    const key = "c-4";
    const pending = buildPendingMessage(cacheOf(), {
      channelId: CHANNEL,
      clientMsgId: key,
      body: "do the thing",
      authorUserId: ME,
      metadata: { taskId: pendingMessageId(key), to_user_id: "peer" },
    });
    const retagged = retagPendingMessage(
      appendPendingMessage(cacheOf(), pending),
      key,
      { taskId: "real-thread" }
    );
    expect(retagged?.messages[0].metadata).toEqual({
      taskId: "real-thread",
      to_user_id: "peer",
    });
  });

  it("mints distinct client message ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newClientMsgId()));
    expect(ids.size).toBe(50);
  });
});

describe("pending thread rows", () => {
  it("is OPEN, so the session card reads active rather than complete", () => {
    const thread = buildPendingThread({
      id: pendingMessageId("c-5"),
      channelId: CHANNEL,
      workspaceId: "ws",
      title: "Ship the thing",
      createdBy: ME,
      targetUserId: "peer",
    });
    expect(thread.status).toBe("open");
    expect(thread.outcome).toBeNull();
    expect(thread.title).toBe("Ship the thing");
  });

  it("swaps the pending row for the server's, keeping one card", () => {
    const pendingId = pendingMessageId("c-6");
    const cache = upsertThread({ tasks: [] }, {
      ...buildPendingThread({
        id: pendingId,
        channelId: CHANNEL,
        workspaceId: "ws",
        title: "T",
        createdBy: ME,
        targetUserId: "peer",
      }),
    });
    const real: ChannelThread = {
      ...buildPendingThread({
        id: "real-thread",
        channelId: CHANNEL,
        workspaceId: "ws",
        title: "T",
        createdBy: ME,
        targetUserId: "peer",
      }),
    };
    const settled = upsertThread(cache, real, pendingId);
    expect(settled?.tasks).toHaveLength(1);
    expect(settled?.tasks[0].id).toBe("real-thread");
  });
});

// Four until 2026-08-08, when notify scope was removed from the product
// (F-170) and its cache patch went with it.
describe("the writes that used to be hand-rolled overrides", () => {
  it("sets a channel's tool profile in the list cache", () => {
    const next = setToolProfile(
      {
        channels: [
          { id: CHANNEL, myAgentToolProfile: "full" },
          { id: "other", myAgentToolProfile: "full" },
        ] as never,
      },
      CHANNEL,
      "read_only"
    );
    expect(next?.channels.map((c) => c.myAgentToolProfile)).toEqual([
      "read_only",
      "full",
    ]);
  });

  /**
   * THE FAVOURITE'S PATCH IS A NULLABLE TIMESTAMP, NOT A FLAG, and the
   * un-favourite is the case that has to be spelled out: it writes `null` into
   * the row rather than leaving the field where it was. The sidebar's section
   * membership is `myFavoritedAt !== null`, so a patch that dropped the field on
   * `false` would leave the shortcut row standing under a bookmark the operator
   * just cleared.
   */
  it("sets and CLEARS a channel's favourite in the list cache", () => {
    const cache = {
      channels: [
        { id: CHANNEL, myFavoritedAt: null },
        { id: "other", myFavoritedAt: null },
      ] as never,
    };
    const on = setFavorite(cache, CHANNEL, true, "2026-08-19T10:00:00.000Z");
    expect(on?.channels.map((c) => c.myFavoritedAt)).toEqual([
      "2026-08-19T10:00:00.000Z",
      null,
    ]);

    const off = setFavorite(on, CHANNEL, false);
    expect(off?.channels.map((c) => c.myFavoritedAt)).toEqual([null, null]);
  });

  it("declines on a cold cache, like every other patch here", () => {
    // ⚠ Writing a one-channel list into a query that never loaded renders a
    // sidebar of exactly that channel and then flips when the read lands.
    expect(setFavorite(undefined, CHANNEL, true)).toBeUndefined();
  });

  /**
   * THE ROLLBACK DEPENDS ON THIS AND CANNOT SEE IT FAIL. `onMutate` snapshots
   * the cache object by REFERENCE and `onError` writes that same reference
   * back, so a patch that edited a row in place would "roll back" to the
   * optimistic value — and every rollback test in this feature holds a live
   * reference to the object it is comparing against, which is exactly the
   * shape that passes anyway. Pinned the way `features/members`'
   * `optimistic-cache.test.ts` pins it: the INPUT is re-read after the patch.
   */
  it("patchChannel returns a new cache and never edits the input in place", () => {
    const cache = {
      channels: [
        { id: CHANNEL, visibility: "public", myAgentToolProfile: "full" },
        { id: "other", visibility: "private", myAgentToolProfile: "full" },
      ] as never,
    };
    const rows = cache.channels as unknown as Array<{
      id: string;
      visibility: string;
    }>;
    const next = patchChannel(cache, CHANNEL, { visibility: "private" });

    expect(next).not.toBe(cache);
    expect(next?.channels).not.toBe(cache.channels);
    // The input still says what it said before the patch.
    expect(rows[0].visibility).toBe("public");
    // Untouched rows keep their identity, so nothing else re-renders.
    expect(next?.channels[1]).toBe(rows[1] as never);
  });

  it("adds and removes a trust rule row, and is idempotent on add", () => {
    const added = addTrustRuleRow(
      { rules: [] },
      { trustedUserId: "peer", operatorUserId: ME, workspaceId: "ws" }
    );
    const again = addTrustRuleRow(added, {
      trustedUserId: "peer",
      operatorUserId: ME,
      workspaceId: "ws",
    });
    expect(again?.rules).toHaveLength(1);
    expect(removeTrustRuleRow(again, "peer")?.rules).toHaveLength(0);
  });

  it("drops a decided consent request from the inbox", () => {
    const next = dropConsentRequest(
      { requests: [{ id: "r1" }, { id: "r2" }] as never },
      "r1"
    );
    expect(next?.requests.map((r) => r.id)).toEqual(["r2"]);
  });
});
