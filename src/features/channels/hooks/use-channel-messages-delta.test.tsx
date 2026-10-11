// @vitest-environment jsdom
/**
 * **THE SWITCH-IN DELTA** (2026-10-10, option A of KB `dopl-development ›
 * Channel Switch Latency 2026-10-10`).
 *
 * Switching back to a channel used to repaint the cached rows and then wait on a
 * FULL newest-page read — 5-7 serial database waves fetching up to 200 rows to
 * show ~40 — as the entire delivery path for everything that landed while the
 * reader was away. These cases pin the read it sends instead, and the four ways
 * that read is allowed to end.
 *
 * ⚠ **A SECOND SUITE RATHER THAN MORE CASES IN
 * `use-channel-messages.test.tsx`** — that file is at 419 lines against the
 * 500-line cap (INVARIANTS §1). Same harness, so the fixtures are not retyped.
 *
 * ⚠ IT DRIVES THE REAL `useApiQuery` OVER A MOCKED TRANSPORT. The newest page is
 * a TanStack query and the delta is a bare `apiRequest` into the same cache
 * entry; the seam between them is the whole subject, so mocking the query out
 * would leave it untested.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("@/shared/api/api-client", () => ({ apiRequest: vi.fn() }));

import { apiRequest } from "@/shared/api/api-client";
import {
  cacheKey,
  CHANNEL,
  mount,
  OTHER,
  page,
  PAGE_PARAMS,
  requests,
  settle,
} from "./use-channel-messages-harness";
import { appendPendingMessage, buildPendingMessage } from "../lib/optimistic-cache";
import { CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS } from "../constants";
import { channelMessagesPath } from "../client/query-keys";
import type { ChannelMessage } from "../types";

/** A cache entry as the transport left it — the RAW body, which is what `useApiQuery` stores. */
function cached(messages: ChannelMessage[], hasMore = true) {
  return { messages, entries: null, hasMore };
}

/**
 * Every read as `[path, query]`.
 *
 * ⚠ **THE PATH MATTERS HERE AND `requests()` DROPS IT.** A fallback aimed at the
 * wrong channel sends the SAME query object to a DIFFERENT URL, so the query half
 * alone cannot tell the bug from the fix.
 */
function addressedRequests(): Array<[string | null, Record<string, unknown>]> {
  return vi
    .mocked(apiRequest)
    .mock.calls.map(([path, opts]) => [
      path as string | null,
      (opts?.query ?? {}) as Record<string, unknown>,
    ]);
}

/** A promise this test resolves by hand — the delta held open across a switch. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** The forward read the hook should send: `since`, `limit`, and NO `lineBudget`. */
const DELTA = (since: number) => ({
  limit: CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS,
  since,
});

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
});
afterEach(cleanup);

describe("switch-in", () => {
  it("reads the DELTA from the newest cached row, never the page again", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ messages: [], hasMore: false });

    await mount(CHANNEL, cached(page(50, 50)));

    // 🔒 ONE read, and it is the forward one. ⚠ **NO `lineBudget` BESIDE
    // `since`** — the server REFUSES the pair (`schema-reads.ts`), so a delta
    // that carried the budget would 400 on every switch.
    expect(requests()).toEqual([DELTA(50)]);
  });

  it("merges the new rows into the SAME cache entry, in seq order", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      messages: page(53, 3),
      hasMore: false,
    });

    const h = await mount(CHANNEL, cached(page(50, 50)));

    expect(h.read().messages).toHaveLength(53);
    expect(h.read().messages.at(-1)?.seq).toBe(53);
    // 🔒 **THE SAME ENTRY, NOT A SECOND KEY.** A `?since=` entry of its own would
    // sit under the prefix the optimistic writes patch, so every send would
    // append its pending row into it (`client/query-keys.ts` records the hazard).
    const entry = h.client.getQueryData<{ messages: ChannelMessage[] }>(cacheKey());
    expect(entry?.messages).toHaveLength(53);
  });

  it("keeps the CACHED `hasMore`, so a delta cannot latch history as exhausted", async () => {
    // The delta's own `hasMore` answers "did this forward read hit its ceiling",
    // never "is there older history". Writing it over the cached answer would
    // hide the channel's past behind one switch.
    vi.mocked(apiRequest).mockResolvedValue({
      messages: page(51, 1),
      hasMore: false,
    });

    const h = await mount(CHANNEL, cached(page(50, 50), true));

    expect(h.read().hasOlder).toBe(true);
  });

  it("DEDUPES the reader's own send: the pending row and the saved row are one message", async () => {
    const base = cached(page(50, 50));
    const pending = buildPendingMessage(base, {
      channelId: CHANNEL,
      clientMsgId: "idem-1",
      body: "mine",
      authorUserId: "u-1",
    });
    const withPending = appendPendingMessage(base, pending) ?? base;
    // The same message as the server saved it — real id, real seq, same key.
    const saved: ChannelMessage = {
      ...pending,
      id: "m-51",
      seq: 51,
      clientMsgId: "idem-1",
    };
    vi.mocked(apiRequest).mockResolvedValue({ messages: [saved], hasMore: false });

    const h = await mount(CHANNEL, cached(withPending.messages));

    // 🔒 51, not 52. Seq-only dedupe renders this message twice: the pending row
    // carries a SYNTHETIC seq (`buildPendingMessage` takes `max + 1`), so the two
    // match on `clientMsgId` and on nothing else.
    expect(h.read().messages).toHaveLength(51);
    expect(h.read().messages.at(-1)?.id).toBe("m-51");
    // ⚠ AND THE CURSOR SKIPPED THE PENDING ROW'S SEQ: reading `since: 51` off it
    // would have skipped every real message between seq 50 and the next one.
    expect(requests()).toEqual([DELTA(50)]);
  });
});

describe("the four ways a delta ends", () => {
  it("NO CACHE ENTRY — the ordinary full page read, and no delta beside it", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ messages: page(50, 50) });

    const h = await mount(CHANNEL);

    // 🔒 ONE read. The query itself is pending on a first visit, so its own read
    // IS the full page; a delta here would be a second read of the same rows.
    expect(requests()).toEqual([PAGE_PARAMS]);
    expect(h.read().messages).toHaveLength(50);
  });

  it("CACHED BUT EMPTY — falls back to the full page read", async () => {
    // Nothing to read forward FROM, and `staleTime: Infinity` means the query
    // will not revalidate on its own: without this fallback a channel that was
    // empty when the reader left it never fills in.
    vi.mocked(apiRequest).mockResolvedValue({ messages: page(3, 3) });

    const h = await mount(CHANNEL, cached([], false));

    expect(requests()).toEqual([PAGE_PARAMS]);
    expect(h.read().messages).toHaveLength(3);
  });

  it("AT ITS CEILING — more arrived than one page holds, so re-read the page", async () => {
    // 🔒 THE GAP CASE. A forward read returns the OLDEST rows past the cursor, so
    // a ceiling-sized answer means the NEWEST are still missing. Merging it would
    // paint a transcript that is wrong in the middle and say nothing.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        messages: page(50 + CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS, CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS),
        hasMore: true,
      })
      .mockResolvedValueOnce({ messages: page(400, 40), hasMore: true });

    const h = await mount(CHANNEL, cached(page(50, 50)));

    expect(requests()).toEqual([DELTA(50), PAGE_PARAMS]);
    expect(h.read().messages.at(-1)?.seq).toBe(400);
  });

  it("FAILED — falls back to the full page read rather than staying in the past", async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ messages: page(52, 52), hasMore: true });

    const h = await mount(CHANNEL, cached(page(50, 50)));

    expect(requests()).toEqual([DELTA(50), PAGE_PARAMS]);
    expect(h.read().messages).toHaveLength(52);
  });
});

/**
 * **WHERE A FALLBACK IS AIMED**, which is only ever in question once the reader
 * has moved: the whole point of a delta is that it is in flight across a switch.
 *
 * A `TranscriptBody` here is always AT ITS CEILING (`hasMore: true`), the arm that
 * cannot merge and must re-read a page.
 */
describe("a delta resolving after the reader moved", () => {
  /** A's delta, held open; every other read answers an ordinary page. */
  function holdTheDelta() {
    const held = deferred<{ messages: ChannelMessage[]; hasMore: boolean }>();
    vi.mocked(apiRequest).mockImplementation((async (_path, opts) => {
      const query = (opts?.query ?? {}) as { since?: number };
      if (query.since !== undefined) return held.promise;
      return { messages: page(80, 30), hasMore: true };
    }) as typeof apiRequest);
    return held;
  }

  /** A ceiling-sized answer: more arrived than one page holds. */
  const CEILING = {
    messages: page(50 + CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS, CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS),
    hasMore: true,
  };

  it("🔒 RE-READS THE CHANNEL IT WAS ISSUED FOR, never the one now on screen", async () => {
    const held = holdTheDelta();

    const h = await mount(CHANNEL, cached(page(50, 50)));
    await h.select(OTHER);
    held.settle(CEILING);
    await settle();

    // 🔒 The third read is **A's** page. TanStack binds an observer's `refetch` in
    // its constructor and it fetches the observer's CURRENT query, so this landed
    // on B: A stayed un-caught-up AND the channel just opened paid a second full
    // line-budgeted read — the exact fast-switch cost this wave removes.
    expect(addressedRequests()).toEqual([
      [channelMessagesPath(CHANNEL), DELTA(50)],
      [channelMessagesPath(OTHER), PAGE_PARAMS],
      [channelMessagesPath(CHANNEL), PAGE_PARAMS],
    ]);
  });

  it("🔒 SENDS NOTHING AT ALL once the reader has DESELECTED", async () => {
    const held = holdTheDelta();

    const h = await mount(CHANNEL, cached(page(50, 50)));
    await h.select(null);
    held.settle(CEILING);
    await settle();

    // 🔒 The delta and nothing else. The observer's current key is `[null, …]`
    // once nothing is selected, and `refetch()` on it fired a real request at a
    // garbage URL — `use-api-query-core.ts` guards that with an `enabled` its
    // wrapper CLOSED OVER while the channel was still selected, so the guard
    // could not save a call made this late. And there is no paint left to
    // correct: the next switch-in re-reads the same delta.
    expect(addressedRequests()).toEqual([[channelMessagesPath(CHANNEL), DELTA(50)]]);
  });
});

describe("A → B → A", () => {
  it("catches A up on the way back, and reads B's page once", async () => {
    vi.mocked(apiRequest).mockImplementation((async (_path, opts) => {
      const query = (opts?.query ?? {}) as { since?: number };
      if (query.since !== undefined) return { messages: page(51, 1), hasMore: false };
      return { messages: page(50, 50), hasMore: true };
    }) as typeof apiRequest);

    const h = await mount(CHANNEL, cached(page(50, 50)));
    await h.select(OTHER);
    await h.select(CHANNEL);

    // A's cache was already warm, so its switch-in is a delta both times; B had
    // no entry, so B pays one full page. ⚠ **AND THE SECOND CURSOR IS 51, NOT
    // 50** — the first delta's row is in the entry, so the cursor it reads from
    // moved with it. A cursor that did not advance would re-read every row it
    // had already merged on every switch.
    expect(requests()).toEqual([DELTA(50), PAGE_PARAMS, DELTA(51)]);
    expect(h.read().messages.at(-1)?.seq).toBe(51);
  });
});
