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
import { useEffect, type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/shared/api/api-client", () => ({ apiRequest: vi.fn() }));

import { apiRequest } from "@/shared/api/api-client";
import { CHANNEL_TRANSCRIPT_PAGE_SIZE } from "../constants";
import { channelMessagesParams, channelMessagesPath } from "../client/query-keys";
import { appendPendingMessage, buildPendingMessage } from "../lib/optimistic-cache";
import { useChannelMessages } from "./use-channel-messages";
import type {
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../types";

const WORKSPACE = "ws-1";
const CHANNEL = "c-1";
const OTHER = "c-2";

/** ⚠ BUILT, never retyped: `[path, workspaceId, query]` is the tuple the read
 *  registers and the writes patch, and one differing element is a silent no-op. */
const cacheKey = () =>
  [channelMessagesPath(CHANNEL), WORKSPACE, channelMessagesParams()] as const;

function msg(seq: number, over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `m-${seq}`,
    seq,
    channelId: CHANNEL,
    authorUserId: "u-1",
    authorKind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    authorName: null,
    authorAvatarUrl: null,
    ...over,
  };
}

/** A run of `count` messages ending at `top`, ascending — one server page. */
function page(top: number, count: number): ChannelMessage[] {
  return Array.from({ length: count }, (_, i) => msg(top - count + 1 + i));
}

type Hook = ReturnType<typeof useChannelMessages>;

/** The reads this mount saw, as `{limit, before?}` — the query half alone. */
function requests(): Array<Record<string, unknown>> {
  return vi
    .mocked(apiRequest)
    .mock.calls.map(([, opts]) => (opts?.query ?? {}) as Record<string, unknown>);
}

/**
 * ONE MACROTASK. `await act(async () => {})` drains microtasks only, and
 * TanStack schedules its observer notifications on a timer — so a query whose
 * fetch has already resolved still renders its old data until a real tick has
 * passed.
 */
const settle = () =>
  act(async () => {
    // ⚠ TWO, not one: the fetch resolving and the observer notifying are
    // separate ticks, and `useApiQuery`'s stranded-query nudge adds a third
    // timer on top of them.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Publishes from an effect — a render-phase write trips `react-hooks/immutability`. */
async function mount(
  channelId: string | null = CHANNEL,
  /**
   * A cache entry written BEFORE this mount — the §8 case. It is the RAW response
   * body, because that is what `useApiQuery` stores and what the optimistic
   * writes patch.
   */
  seed?: Record<string, unknown>
) {
  // ⚠ ONE client for the whole mount. Minting it inside a `wrapper` component
  // makes a fresh cache on every rerender, which reads as a query that never
  // resolves.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (seed) client.setQueryData(cacheKey(), seed);
  const holder: { value: Hook | null } = { value: null };
  function Probe({ id }: { id: string | null }) {
    const state = useChannelMessages(id, WORKSPACE);
    useEffect(() => {
      holder.value = state;
    });
    return null;
  }
  const tree = (id: string | null): ReactNode => (
    <QueryClientProvider client={client}>
      <Probe id={id} />
    </QueryClientProvider>
  );
  const view = render(tree(channelId));
  await settle();
  return {
    holder,
    client,
    read: () => holder.value as Hook,
    async select(next: string | null) {
      view.rerender(tree(next));
      await settle();
    },
    async loadOlder() {
      await act(async () => {
        holder.value?.loadOlder();
      });
      await settle();
    },
  };
}

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
});
afterEach(cleanup);

describe("the newest page", () => {
  it("opens on ONE page, with no cursor", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ messages: page(50, 50) });

    const h = await mount();

    expect(requests()).toEqual([{ limit: CHANNEL_TRANSCRIPT_PAGE_SIZE }]);
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

    expect(requests()[1]).toEqual({
      limit: CHANNEL_TRANSCRIPT_PAGE_SIZE,
      before: 11,
    });
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

  it("STOPS at the oldest message — a short page exhausts the window", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) })
      .mockResolvedValueOnce({ messages: page(10, 3) });

    const h = await mount();
    await h.loadOlder();
    expect(h.read().hasOlder).toBe(false);

    // And the affordance being gone is not the only guard: calling anyway is a
    // no-op, because a scroll listener can always fire once more.
    await h.loadOlder();
    expect(requests()).toHaveLength(2);
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
    // degrade to "no more history", never to a blank transcript.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ messages: page(60, 50) })
      .mockResolvedValueOnce({});

    const h = await mount();
    await h.loadOlder();

    expect(h.read().messages).toHaveLength(50);
    expect(h.read().hasOlder).toBe(false);
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
