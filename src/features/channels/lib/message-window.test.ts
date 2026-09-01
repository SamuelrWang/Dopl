/**
 * The scroll-back window's rules, with no React and no network.
 *
 * The one worth reading twice is the CONTIGUITY suite: it is the only thing
 * standing between a reader and a silent hole in their own history, and the
 * failing case (`seq` gaps are normal, the newest page outruns the boundary) is
 * not one anybody would guess from the shape of the data.
 */

import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "../types";
import {
  appendOlderPage,
  dropThreadFromWindow,
  EMPTY_MESSAGE_WINDOW,
  isContiguous,
  mergeWindow,
  oldestSeq,
  type MessageWindow,
} from "./message-window";

const CHANNEL = "chan-1";

function msg(seq: number, over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `m-${seq}`,
    seq,
    channelId: CHANNEL,
    authorUserId: "user-1",
    authorKind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-31T00:00:00Z",
    authorName: null,
    authorAvatarUrl: null,
    ...over,
  };
}

function windowOf(
  older: ChannelMessage[],
  boundarySeq: number | null,
  exhausted = false
): MessageWindow {
  return { older, boundarySeq, exhausted };
}

describe("oldestSeq", () => {
  it("is null for an empty page and the minimum otherwise", () => {
    expect(oldestSeq([])).toBeNull();
    // ⚠ NOT `page[0].seq`. Ordering is the caller's business, and a cursor
    // derived from a positional assumption is wrong exactly once.
    expect(oldestSeq([msg(40), msg(12), msg(31)])).toBe(12);
  });
});

describe("isContiguous", () => {
  it("is trivially true before any history is loaded", () => {
    expect(isContiguous(EMPTY_MESSAGE_WINDOW, [msg(900)])).toBe(true);
  });

  it("holds while the newest page still reaches back to the boundary", () => {
    const win = windowOf([msg(10), msg(20)], 30);
    expect(isContiguous(win, [msg(30), msg(40)])).toBe(true);
    // Reaching FURTHER back than the boundary overlaps, which is fine —
    // `mergeWindow` deduplicates.
    expect(isContiguous(win, [msg(20), msg(30), msg(40)])).toBe(true);
  });

  it("BREAKS when the newest page has outrun the boundary", () => {
    // The live case: more than a page of messages landed while the reader sat in
    // history, so the newest page no longer touches where the buffer stopped.
    // Everything between 30 and 500 is held by neither half.
    const win = windowOf([msg(10), msg(20)], 30);
    expect(isContiguous(win, [msg(500), msg(510)])).toBe(false);
  });

  it("does not read a `seq` GAP as a missing row", () => {
    // ⚠ `seq` is a TABLE-wide identity, so two adjacent posts in one channel are
    // never adjacent numbers. A rule that inferred holes from arithmetic would
    // call this discontinuous and drop a perfectly good window.
    const win = windowOf([msg(4), msg(19)], 91);
    expect(isContiguous(win, [msg(91), msg(2400)])).toBe(true);
  });

  it("treats an EMPTY newest page as contiguous", () => {
    expect(isContiguous(windowOf([msg(1)], 5), [])).toBe(true);
  });
});

describe("mergeWindow", () => {
  it("returns the page untouched when no history is loaded", () => {
    const page = [msg(1), msg(2)];
    expect(mergeWindow(EMPTY_MESSAGE_WINDOW, page)).toEqual(page);
  });

  it("puts history in FRONT, ascending by seq", () => {
    const win = windowOf([msg(5), msg(6)], 7);
    expect(mergeWindow(win, [msg(7), msg(8)]).map((m) => m.seq)).toEqual([
      5, 6, 7, 8,
    ]);
  });

  it("deduplicates an overlap, and the PAGE's copy wins", () => {
    // The page is the entry the optimistic writes patch, so its row is fresher.
    const stale = msg(7, { body: "stale" });
    const fresh = msg(7, { body: "fresh" });
    const merged = mergeWindow(windowOf([msg(6), stale], 8), [fresh, msg(8)]);
    expect(merged.map((m) => m.seq)).toEqual([6, 7, 8]);
    expect(merged[1].body).toBe("fresh");
  });

  it("keeps a PENDING row last", () => {
    // `buildPendingMessage` stamps max(seq) + 1 over the whole cache entry, so a
    // not-yet-saved message sorts after every real one even with history loaded.
    const pending = msg(9, { id: "pending:abc", clientMsgId: "abc" });
    const merged = mergeWindow(windowOf([msg(1)], 4), [msg(4), pending]);
    expect(merged.map((m) => m.id)).toEqual(["m-1", "m-4", "pending:abc"]);
  });
});

describe("appendOlderPage", () => {
  it("prepends the page and records the boundary from the FIRST fetch only", () => {
    const first = appendOlderPage(EMPTY_MESSAGE_WINDOW, [msg(8), msg(9)], 10, 2);
    expect(first.older.map((m) => m.seq)).toEqual([8, 9]);
    expect(first.boundarySeq).toBe(10);

    const second = appendOlderPage(first, [msg(6), msg(7)], 8, 2);
    expect(second.older.map((m) => m.seq)).toEqual([6, 7, 8, 9]);
    // ⚠ STILL 10. The witness describes the window's TOP edge — where the newest
    // page stood when history began — and later pages extend the BOTTOM.
    expect(second.boundarySeq).toBe(10);
  });

  it("marks the window exhausted on a SHORT page, and the flag latches", () => {
    const short = appendOlderPage(EMPTY_MESSAGE_WINDOW, [msg(1)], 5, 50);
    expect(short.exhausted).toBe(true);
    expect(appendOlderPage(short, [], 1, 50).exhausted).toBe(true);
  });

  it("does NOT mark exhausted on a full page", () => {
    expect(
      appendOlderPage(EMPTY_MESSAGE_WINDOW, [msg(1), msg(2)], 5, 2).exhausted
    ).toBe(false);
  });

  it("still takes the boundary from an EMPTY first page", () => {
    // An empty page means the channel ended exactly at the cursor. The window
    // must still remember where it stopped or the next newest-page refetch has
    // no witness to check itself against.
    const win = appendOlderPage(EMPTY_MESSAGE_WINDOW, [], 12, 50);
    expect(win.boundarySeq).toBe(12);
    expect(win.exhausted).toBe(true);
  });
});

describe("dropThreadFromWindow", () => {
  it("drops history rows tagged for the deleted thread", () => {
    const win = windowOf(
      [msg(1), msg(2, { metadata: { taskId: "t-1" } }), msg(3)],
      4
    );
    expect(dropThreadFromWindow(win, "t-1").older.map((m) => m.seq)).toEqual([
      1, 3,
    ]);
  });

  it("returns the SAME window when nothing matched", () => {
    // Identity matters: the merge downstream is memoised on this array.
    const win = windowOf([msg(1)], 2);
    expect(dropThreadFromWindow(win, "t-other")).toBe(win);
  });

  it("leaves the boundary and the exhausted flag alone", () => {
    const win = windowOf([msg(1, { metadata: { taskId: "t-1" } })], 9, true);
    const after = dropThreadFromWindow(win, "t-1");
    expect(after.older).toEqual([]);
    // ⚠ Deleting a thread does not un-load history: the window still reaches
    // back to where it did, and it is still exhausted if it was.
    expect(after.boundarySeq).toBe(9);
    expect(after.exhausted).toBe(true);
  });
});
