// @vitest-environment jsdom
/**
 * THE TRANSCRIPT'S PAGED READ — the newest page, the `before` cursor behind
 * scroll-up, and the three ways the window is allowed to end.
 *
 * ⚠ IT DRIVES THE REAL `useApiQuery` OVER A MOCKED TRANSPORT, not a mocked
 * hook. The newest page and the older pages are two DIFFERENT mechanisms — one
 * is a TanStack query, one is a bare `apiRequest` — and the whole point of the
 * design is how they compose. Mocking the query out would leave exactly that
 * seam untested.
 *
 * ⚠ THE CURSOR IS KEYSET, AND `pages the second call re-reads` is the assertion
 * that proves it: an offset implementation passes every other test here and
 * fails that one by asking for the same block twice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";

vi.mock("@/shared/api/api-client", () => ({ apiRequest: vi.fn() }));

import { apiRequest } from "@/shared/api/api-client";
// ⚠ FIXTURES AND MOUNT LIVE IN THE HARNESS (split 2026-09-08 at the 500-line
// cap). Never retype one here — a second `page()` is a second definition of
// what one transcript page looks like.
import {
  cacheKey,
  CHANNEL,
  mount,
  msg,
  OTHER,
  page,
  PAGE_PARAMS,
  requests,
  settle,
  WORKSPACE,
} from "./use-channel-messages-harness";
import { appendPendingMessage, buildPendingMessage } from "../lib/optimistic-cache";
import type {
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../types";

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
});
afterEach(cleanup);

describe("the newest page", () => {
  it("opens on ONE page, with no cursor", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ messages: page(50, 50) });

    const h = await mount();

    expect(requests()).toEqual([PAGE_PARAMS]);
    expect(h.read().messages).toHaveLength(50);
    expect(h.read().hasOlder).toBe(true);
  });

  it("fetches nothing at all with no channel selected", async () => {
    await mount(null);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("scrolling back", () => {
  it("asks for `before` the OLDEST loaded row and prepends the answer", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) }) // seq 11..60
      .mockResolvedValueOnce({ messages: page(10, 10) }); // seq 1..10

    const h = await mount();
    await h.loadOlder();

    expect(requests()[1]).toEqual({ ...PAGE_PARAMS, before: 11 });
    const seqs = h.read().messages.map((m) => m.seq);
    expect(seqs[0]).toBe(1);
    expect(seqs.at(-1)).toBe(60);
    expect(seqs).toHaveLength(60);
  });

  it("moves the cursor down — the second page never re-reads the first", async () => {
    // ⚠ THE KEYSET ASSERTION. An offset implementation asks for the same rows
    // again with a bigger window; this one asks below where it stopped.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(200, 50) }) // 151..200
      .mockResolvedValueOnce({ messages: page(150, 50) }) // 101..150
      .mockResolvedValueOnce({ messages: page(100, 50) }); // 51..100

    const h = await mount();
    await h.loadOlder();
    await h.loadOlder();

    expect(requests().map((q) => q.before)).toEqual([undefined, 151, 101]);
    expect(h.read().messages).toHaveLength(150);
  });

  it("STOPS when the SERVER says there is nothing older", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50), hasMore: true })
      .mockResolvedValueOnce({ messages: page(10, 3), hasMore: false });

    const h = await mount();
    await h.loadOlder();
    expect(h.read().hasOlder).toBe(false);

    // And the affordance being gone is not the only guard: calling anyway is a
    // no-op, because a scroll listener can always fire once more.
    await h.loadOlder();
    expect(requests()).toHaveLength(2);
  });

  it("🔒 `hasOlder` IS NOT `rows.length === <page size>` (2026-09-08)", async () => {
    // THE REGRESSION THIS WHOLE CHANGE IS ABOUT. The transcript pages by an
    // ESTIMATED LINE budget, so a THREE-ROW page against a 200-row cap is the
    // ordinary answer for a channel of long messages. Every row-count test —
    // `=== limit`, `< limit`, `=== CHANNEL_TRANSCRIPT_PAGE_SIZE` — calls that
    // channel exhausted and hides the rest of its history. Only the server's
    // flag may decide.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 3), hasMore: true })
      .mockResolvedValueOnce({ messages: page(57, 2), hasMore: true });

    const h = await mount();
    expect(h.read().messages).toHaveLength(3);
    expect(h.read().hasOlder).toBe(true);

    await h.loadOlder();
    expect(h.read().messages).toHaveLength(5);
    expect(h.read().hasOlder).toBe(true);
  });

  it("stops on the NEWEST page's own flag, before any scroll", async () => {
    // A channel shorter than one budget: the server says so on the first read
    // and the affordance is never offered.
    vi.mocked(apiRequest).mockResolvedValue({
      messages: page(3, 3),
      hasMore: false,
    });
    const h = await mount();
    expect(h.read().messages).toHaveLength(3);
    expect(h.read().hasOlder).toBe(false);
  });

  it("is idempotent against a burst — a scroll listener fires many times a frame", async () => {
    // ⚠ `loading` has not committed yet inside the burst, so the guard that has
    // to hold here is the synchronous ref, not the rendered flag.
    vi.mocked(apiRequest).mockResolvedValue({ messages: page(60, 50) });
    const h = await mount();

    await act(async () => {
      h.read().loadOlder();
      h.read().loadOlder();
      h.read().loadOlder();
    });
    await settle();

    expect(requests().filter((q) => q.before !== undefined)).toHaveLength(1);
  });

  it("survives a page body with NO `messages` key", async () => {
    // ⚠ STALE-SHAPE FALLBACK (§8's rule, on a live payload): an older build's
    // route answers without the key rather than with an empty array, and
    // `.length` on `undefined` throws inside a scroll handler. The read must
    // degrade to "no more history", never to a blank transcript. ⚠ That body
    // carries no `hasMore` either, so the "maybe more" fallback says keep going
    // — and `appendOlderPage`'s empty-page latch is what still stops it.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) })
      .mockResolvedValueOnce({});

    const h = await mount();
    await h.loadOlder();

    expect(h.read().messages).toHaveLength(50);
    expect(h.read().hasOlder).toBe(false);
  });

  it("treats a MISSING `hasMore` as maybe-more, never as exhausted", async () => {
    // §8 on a persisted cache entry written by a build that predates the key.
    // The two ways to be wrong are not symmetric: `false` hides the channel's
    // history until the revalidation lands; `true` costs one fetch.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 4) })
      .mockResolvedValueOnce({ messages: page(56, 4) });

    const h = await mount();
    expect(h.read().hasOlder).toBe(true);
    await h.loadOlder();
    expect(h.read().messages).toHaveLength(8);
    expect(h.read().hasOlder).toBe(true);
  });

  it("keeps the window when the page FAILS, so the next scroll retries", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ messages: page(10, 10) });

    const h = await mount();
    await h.loadOlder();
    expect(h.read().hasOlder).toBe(true);
    expect(h.read().loadingOlder).toBe(false);

    await h.loadOlder();
    expect(h.read().messages).toHaveLength(60);
  });
});

describe("the window's two resets", () => {
  it("drops the history when the newest page has OUTRUN it", async () => {
    // The live case: a burst larger than a page lands while the reader sits in
    // history. Concatenating anyway would render a hole as if it were not there.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) })
      .mockResolvedValueOnce({ messages: page(10, 10) });

    const h = await mount();
    await h.loadOlder();
    expect(h.read().messages).toHaveLength(60);

    vi.mocked(apiRequest).mockResolvedValue({ messages: page(900, 50) });
    await act(async () => {
      await h.read().refetch();
    });
    await settle();

    expect(h.read().messages.map((m) => m.seq)).toEqual(
      page(900, 50).map((m) => m.seq)
    );
  });

  it("starts over on a channel switch", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) })
      .mockResolvedValueOnce({ messages: page(10, 10) });

    const h = await mount();
    await h.loadOlder();
    expect(h.read().messages).toHaveLength(60);

    vi.mocked(apiRequest).mockResolvedValue({ messages: page(5, 5) });
    await h.select(OTHER);

    expect(h.read().messages).toHaveLength(5);
    expect(h.read().hasOlder).toBe(true);
  });
});

/**
 * THE ARTIFACT ENVELOPE, THROUGH THE REAL HOOK — the wire that makes the card
 * visible, and the two hazards that stopped it being one prop.
 *
 * ⚠ The pure rules are pinned without React in `lib/message-window.test.ts ›
 * mergeEntries`. What is only testable HERE is the composition: a query cache
 * entry, a bare `before` fetch and an optimistic patch are three different
 * mechanisms, and the invariant has to survive all three at once.
 */
function foldedFixture(id: string): ChannelFoldedArtifact {
  return {
    artifact: {
      id,
      channelId: CHANNEL,
      workspaceId: WORKSPACE,
      name: `artifact ${id}`,
      summary: "a summary",
      createdBy: "u-1",
      createdByAgent: null,
      dissolvedAt: null,
      createdAt: "2026-08-31T00:00:00.000Z",
    },
    count: 2,
    firstSeq: 51,
    lastSeq: 52,
  };
}

function envelopeFixture(
  unfolded: ChannelMessage[],
  cards: ChannelFoldedArtifact[]
): ChannelReadEntry[] {
  return [
    ...unfolded.map((message) => ({ type: "message", message }) as const),
    ...cards.map((card) => ({ type: "artifact", folded: card }) as const),
  ];
}

function armSeqs(entries: ChannelReadEntry[] | null): number[] {
  return (entries ?? [])
    .filter((e) => e.type === "message")
    .map((e) => (e.type === "message" ? e.message.seq : -1));
}

describe("the artifact envelope", () => {
  it("is NULL on an ordinary channel — byte-identical to before artifacts", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ messages: page(50, 50) });
    const h = await mount();
    expect(h.read().entries).toBeNull();
  });

  it("HAZARD A: a card on the newest page loses no history row", async () => {
    // The newest page folds two of its three rows; then the reader scrolls back
    // through fifty rows the envelope has never heard of.
    const folded = foldedFixture("a-1");
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        messages: [
          msg(51, { artifactId: "a-1" }),
          msg(52, { artifactId: "a-1" }),
          msg(53),
        ],
        entries: envelopeFixture([msg(53)], [folded]),
      })
      .mockResolvedValueOnce({ messages: page(50, 50) }); // 1..50, unfolded

    const h = await mount();
    expect(armSeqs(h.read().entries)).toEqual([53]);

    await h.loadOlder();
    // ⚠ THE ASSERTION THE WHOLE SLICE EXISTS FOR. Fifty history rows plus the one
    // unfolded row of the newest page: nothing dropped, the folded pair still
    // folded exactly once.
    expect(armSeqs(h.read().entries)).toHaveLength(51);
    expect(h.read().messages).toHaveLength(53);
  });

  it("keeps the `entries` key the `before` fetch used to DISCARD", async () => {
    // A lone `before` folds on the server exactly as the newest page does, so a
    // card whose members are all in history has to survive the fetch that
    // previously read `body.messages` and threw the rest away.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) })
      .mockResolvedValueOnce({
        messages: [msg(9, { artifactId: "a-1" }), msg(10)],
        entries: envelopeFixture([msg(10)], [foldedFixture("a-1")]),
      });

    const h = await mount();
    expect(h.read().entries).toBeNull();

    await h.loadOlder();
    const cards = (h.read().entries ?? []).filter((e) => e.type === "artifact");
    expect(cards).toHaveLength(1);
    // The folded row is gone from the arms and still present in `messages` —
    // the additive envelope, both halves.
    expect(armSeqs(h.read().entries)).not.toContain(9);
    expect(h.read().messages.some((m) => m.seq === 9)).toBe(true);
  });

  it("HAZARD B: a just-typed pending row renders while the envelope is non-null", async () => {
    // ⚠ THE REAL OPTIMISTIC PATCH, not a hand-built cache. `appendPendingMessage`
    // patches `{ messages }` and knows no `entries` key at all; the row still has
    // to reach the screen the frame after the click.
    vi.mocked(apiRequest).mockResolvedValue({
      messages: [msg(51, { artifactId: "a-1" }), msg(52)],
      entries: envelopeFixture([msg(52)], [foldedFixture("a-1")]),
    });
    const h = await mount();

    await act(async () => {
      h.client.setQueryData(
        cacheKey(),
        (cache: { messages: ChannelMessage[] } | undefined) =>
          appendPendingMessage(
            cache,
            buildPendingMessage(cache, {
              channelId: CHANNEL,
              clientMsgId: "abc",
              body: "just typed",
              authorUserId: "u-1",
            })
          )
      );
    });
    await settle();

    const arms = h.read().entries ?? [];
    expect(
      arms.some((e) => e.type === "message" && e.message.id === "pending:abc")
    ).toBe(true);
  });

  it("survives a cache entry written BEFORE `entries` existed", async () => {
    // ⚠ §8, and the fixture has the key DELETED — not `null`, not `[]`. The query
    // cache is IndexedDB-persisted with a 24h gcTime, so the first paint after an
    // upgrade reads a body the previous bundle wrote. The refetch is made to FAIL
    // so the stale entry is what renders, which is the moment being pinned.
    vi.mocked(apiRequest).mockRejectedValue(new Error("offline"));
    const h = await mount(CHANNEL, { messages: page(50, 50) });

    expect(h.read().messages).toHaveLength(50);
    expect(h.read().entries).toBeNull();
  });
});

describe("dropThread", () => {
  it("removes the deleted thread's rows from the loaded history", async () => {
    // The window is not in the query cache, so the optimistic patch that clears
    // the newest page cannot reach it — this is the other half.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) })
      .mockResolvedValueOnce({
        messages: [msg(8), msg(9, { metadata: { taskId: "t-1" } }), msg(10)],
      });

    const h = await mount();
    await h.loadOlder();
    expect(h.read().messages.some((m) => m.metadata.taskId === "t-1")).toBe(true);

    await act(async () => {
      h.read().dropThread("t-1");
    });
    await settle();

    expect(h.read().messages.some((m) => m.metadata.taskId === "t-1")).toBe(false);
    expect(h.read().messages).toHaveLength(52);
  });
});
