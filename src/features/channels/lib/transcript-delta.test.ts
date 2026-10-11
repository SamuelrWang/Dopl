/**
 * **THE DELTA MERGE** — the half of option A (2026-10-10) that can silently
 * duplicate or lose a message. No React, no network: these are the rules, stated
 * where they are cheap to pin.
 *
 * The WHEN (which switch sends a delta, and the four ways one ends) is
 * `hooks/use-channel-messages-delta.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import { mergeDeltaPage, newestCachedSeq } from "./transcript-delta";
import { buildPendingMessage } from "./optimistic-cache";
import type {
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../types";

function msg(seq: number, over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `m-${seq}`,
    seq,
    channelId: "c-1",
    authorUserId: "u-1",
    authorKind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-10-10T00:00:00.000Z",
    authorName: null,
    authorAvatarUrl: null,
    ...over,
  };
}

function artifactEntry(id: string, count = 0): ChannelReadEntry {
  const folded = {
    artifact: { id, name: `card ${id}` },
    count,
    messages: [],
  } as unknown as ChannelFoldedArtifact;
  return { type: "artifact", folded };
}

/** The rendered member count off one folded card — `count` is a CHANNEL-WIDE fact. */
function countsOf(entries: ChannelReadEntry[] | null): Array<number | undefined> {
  return (entries ?? []).flatMap((entry) =>
    entry.type === "artifact"
      ? [(entry.folded as unknown as { count?: number }).count]
      : []
  );
}

describe("newestCachedSeq", () => {
  it("is the MAX, not the last element", () => {
    expect(newestCachedSeq([msg(7), msg(9), msg(8)])).toBe(9);
  });

  it("is null for nothing to read forward from", () => {
    expect(newestCachedSeq([])).toBeNull();
    expect(newestCachedSeq(undefined)).toBeNull();
  });

  it("🔒 SKIPS A PENDING ROW — its seq is synthetic and no server assigned it", () => {
    const cache = { messages: [msg(50)] };
    const pending = buildPendingMessage(cache, {
      channelId: "c-1",
      clientMsgId: "idem-1",
      body: "mine",
      authorUserId: "u-1",
    });
    // `buildPendingMessage` takes `max + 1`, so the pending row looks newer.
    expect(pending.seq).toBe(51);
    // Reading `since: 51` would skip every real message between 50 and the next.
    expect(newestCachedSeq([...cache.messages, pending])).toBe(50);
  });
});

describe("mergeDeltaPage", () => {
  it("appends the new rows", () => {
    const merged = mergeDeltaPage(
      { messages: [msg(1), msg(2)], hasMore: true },
      { messages: [msg(3), msg(4)] }
    );

    expect(merged.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it("orders by seq, so a delta row cannot land behind a pending one", () => {
    const cache = { messages: [msg(10)] };
    const pending = buildPendingMessage(cache, {
      channelId: "c-1",
      clientMsgId: "idem-2",
      body: "mine",
      authorUserId: "u-1",
    });

    // Someone else's message arrives while the reader's own send is in flight.
    const merged = mergeDeltaPage(
      { messages: [...cache.messages, pending] },
      { messages: [msg(11)] }
    );

    // 🔒 The pending row stays LAST even though its synthetic seq TIES the
    // arriving one — `max + 1` of the cache it was built against is exactly the
    // seq the server hands the next message anybody sends. A row nobody has
    // acknowledged must not render above a message that has really landed.
    expect(merged.messages.map((m) => m.id)).toEqual(["m-10", "m-11", pending.id]);
  });

  it("🔒 REPLACES A PENDING TWIN IN PLACE, matched on clientMsgId", () => {
    const cache = { messages: [msg(10)] };
    const pending = buildPendingMessage(cache, {
      channelId: "c-1",
      clientMsgId: "idem-3",
      body: "mine",
      authorUserId: "u-1",
    });
    const saved = msg(11, { clientMsgId: "idem-3", body: "mine" });

    const merged = mergeDeltaPage(
      { messages: [...cache.messages, pending] },
      { messages: [saved] }
    );

    // One message, and it is the server's row — not two of the reader's send.
    expect(merged.messages.map((m) => m.id)).toEqual(["m-10", "m-11"]);
  });

  it("is idempotent — the same delta twice is the same transcript", () => {
    const first = mergeDeltaPage({ messages: [msg(1)] }, { messages: [msg(2)] });
    const second = mergeDeltaPage(first, { messages: [msg(2)] });

    expect(second.messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("🔒 KEEPS THE CACHED `hasMore` — the two flags answer different questions", () => {
    // Cached: "is there older HISTORY". Delta: "did this forward read hit its
    // ceiling". Overwriting the first with the second latches `exhausted` and
    // hides the channel's past.
    const merged = mergeDeltaPage(
      { messages: [msg(1)], hasMore: true },
      { messages: [msg(2)] }
    );

    expect(merged.hasMore).toBe(true);
  });

  it("holds the message identity when nothing arrived", () => {
    const messages = [msg(1)];
    const merged = mergeDeltaPage({ messages, hasMore: false }, { messages: [] });

    // No new rows, so no memo downstream of this array may be invalidated.
    expect(merged.messages).toBe(messages);
    expect(merged.hasMore).toBe(false);
  });

  it("UNIONS the artifact cards, first copy winning, and drops the message arms", () => {
    const merged = mergeDeltaPage(
      {
        messages: [msg(1)],
        entries: [artifactEntry("a-1"), { type: "message", message: msg(1) }],
      },
      { messages: [msg(2)], entries: [artifactEntry("a-1"), artifactEntry("a-2")] }
    );

    // ⚠ The MESSAGE arms are rebuilt over the merged list by the hook
    // (`message-window.ts › mergeEntries`), which is why only the cards survive:
    // a page's message arms describe a page that no longer exists.
    expect(merged.entries?.map((e) => e.type)).toEqual(["artifact", "artifact"]);
    expect(
      merged.entries?.flatMap((e) => (e.type === "artifact" ? [e.folded.artifact.id] : []))
    ).toEqual(["a-1", "a-2"]);
  });

  it("🔒 KEEPS BOTH AUTHORS when two of them share one `clientMsgId`", () => {
    // ⚠ A MESSAGE VANISHING, SILENTLY. `client_msg_id` is unique per (channel,
    // key, AUTHOR) by design, it rides every peer's DTO, and desktop keys are
    // shaped `agent-<publicAgentId>-<n>` — so a collision across authors is a
    // shape the product produces. An author-free match REPLACED the older row in
    // place: no duplicate, no gap, just one fewer message in the transcript.
    const merged = mergeDeltaPage(
      { messages: [msg(10, { clientMsgId: "k", authorUserId: "u-A" })] },
      { messages: [msg(60, { clientMsgId: "k", authorUserId: "u-B" })] }
    );

    expect(merged.messages.map((m) => m.seq)).toEqual([10, 60]);
    expect(merged.messages.map((m) => m.authorUserId)).toEqual(["u-A", "u-B"]);
  });

  it("🔒 THE DELTA'S CARD WINS ON ID — a card that grew while the reader was away", () => {
    // `count` / `firstSeq` / `lastSeq` are CHANNEL-WIDE facts that move as the
    // room talks, and `count` is rendered. First-copy-wins is only sound WITHIN
    // one read (`message-window.ts › addArtifacts`); these two copies are reads
    // minutes apart, so holding the cached one painted a stale member count after
    // every switch-back.
    const merged = mergeDeltaPage(
      { messages: [msg(1)], entries: [artifactEntry("a-1", 3)] },
      { messages: [msg(2)], entries: [artifactEntry("a-1", 5)] }
    );

    expect(countsOf(merged.entries ?? null)).toEqual([5]);
  });

  it("keeps the fresher card IN ITS SLOT, so the envelope does not reorder", () => {
    const merged = mergeDeltaPage(
      { messages: [msg(1)], entries: [artifactEntry("a-1", 3), artifactEntry("a-2", 1)] },
      { messages: [msg(2)], entries: [artifactEntry("a-1", 9)] }
    );

    expect(
      merged.entries?.flatMap((e) => (e.type === "artifact" ? [e.folded.artifact.id] : []))
    ).toEqual(["a-1", "a-2"]);
    expect(countsOf(merged.entries ?? null)).toEqual([9, 1]);
  });

  it("🔒 SURVIVES A CACHE ENTRY WITH NO `messages` KEY (§8)", () => {
    // The stale-cache rule every sibling on this path defends: an entry written
    // by a build that had no such key is read by this one after an upgrade. A
    // throw here happens INSIDE the hook's `.then`, where the trailing `.catch`
    // turns it into a silent full refetch — the read option A exists to avoid,
    // paid on every switch and attributed to nothing.
    const stale = { hasMore: true } as unknown as Parameters<typeof mergeDeltaPage>[0];

    expect(mergeDeltaPage(stale, { messages: [msg(4)] }).messages.map((m) => m.seq)).toEqual([4]);
    expect(mergeDeltaPage(stale, { messages: [] }).messages).toEqual([]);
  });

  it("is null entries when nothing on either side folded", () => {
    const merged = mergeDeltaPage(
      { messages: [msg(1)], entries: null },
      { messages: [msg(2)], entries: null }
    );

    expect(merged.entries).toBeNull();
  });
});
