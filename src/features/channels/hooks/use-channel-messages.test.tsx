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
import { useChannelMessages } from "./use-channel-messages";
import type { ChannelMessage } from "../types";

const WORKSPACE = "ws-1";
const CHANNEL = "c-1";
const OTHER = "c-2";

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
async function mount(channelId: string | null = CHANNEL) {
  // ⚠ ONE client for the whole mount. Minting it inside a `wrapper` component
  // makes a fresh cache on every rerender, which reads as a query that never
  // resolves.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
