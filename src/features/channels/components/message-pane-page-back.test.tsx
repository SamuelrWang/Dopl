// @vitest-environment jsdom
/**
 * **A JUMP OFF THE LOADED PAGE NOW SCROLLS INSTEAD OF APOLOGISING** (Samuel,
 * 2026-10-12) — the pane, driven by a FAKE PAGER, end to end.
 *
 * ⚠ **BEHAVIOURAL ON PURPOSE, BECAUSE THE BUG THIS REPLACES WAS INVISIBLE TO
 * UNIT TESTS.** `message-pane.test.tsx:322-358` already pins the old behaviour —
 * the notice appears and `scrollIntoView` is NOT called — and every one of those
 * cases was green while a citation to anything older than one page was a dead end.
 *
 * ⚠ **THE PAGER IS ASYNCHRONOUS, AND THE FIRST VERSION OF THIS FILE WAS NOT —
 * WHICH IS WHY TWO MUTATIONS SURVIVED IT.** The first pager answered
 * `onLoadOlder` by lowering the oldest seq synchronously, so the whole hunt
 * collapsed into one React cascade and `loadingOlder` was never true in a
 * committed frame. With no observable mid-hunt frame, removing `!hunting` from
 * the notice gate and removing `hunting` from the landing guard BOTH stayed
 * green — the exact shape of gap Review 33 found elsewhere in this wave. A real
 * page is in flight, then settles, so this one models that: `settleMs`, fake
 * timers, and assertions taken WHILE the hunt is running.
 *
 * ⚠ **`settleMs` IS 3s AND THAT IS LOAD-BEARING, NOT ATMOSPHERE.** The landing
 * effect spends its nonce on `MISSING_NOTICE_MS` (6s) when it finds no row. A
 * hunt whose pages settle instantly finishes before that timer could ever fire,
 * so a missing `hunting` guard costs nothing and no assertion can see it. At 3s
 * a hunt of three pages outlives the 6s timer, which is what makes the guard's
 * absence fatal and therefore testable.
 *
 * ⚠ **`hasOlder` IS THE PAGER'S, NOT DERIVED FROM `rows.length`** (INVARIANTS §5:
 * `hasMore` comes from the server and may not be re-derived) — here it is
 * `oldest > 1`, the fake server's honest answer.
 *
 * ⚠ JSDOM has no layout, so `scrollIntoView` is stubbed on the prototype and the
 * cases assert the CALL the pane made, the posture `message-pane.test.tsx` takes.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";

vi.mock("../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

import {
  ChannelsMessagePane,
  SCROLL_TARGET_MISSING_NOTE,
  type ScrollTarget,
} from "./message-pane";
import { indexMembers } from "./view-model";
import { channelRows, threadRows } from "./view-model-rows";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { CHANNEL_ID, ME, member, message, thread } from "./test-fixtures";

const scrollIntoView = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

beforeEach(() => {
  scrollIntoView.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const MEMBERS = [member({ userId: ME })];
const INDEX = indexMembers(MEMBERS, ME);
const THREAD = thread({ id: "t-1" });

/**
 * One page's flight time, and it is pinned BETWEEN two real timers.
 *
 * ⚠ A five-page hunt must OUTLIVE `MISSING_NOTICE_MS` (6s) — otherwise a missing
 * `hunting` guard costs nothing and no assertion can see it — and must FINISH
 * INSIDE `JUMP_PAGE_BACK_DEADLINE_MS` (15s), or the backstop abandons a hunt that
 * was still winning. 2s × 5 pages = 10s sits in that window. The first draft used
 * 3s, which put a five-page hunt at exactly the 15s deadline and made every
 * landing case fail for the opposite reason to the one being tested.
 */
const SETTLE_MS = 2_000;

/**
 * A channel of `total` messages where only the newest `pageSize` are loaded, and
 * every `onLoadOlder` hands back one more page AFTER `SETTLE_MS` — the fake
 * server, with latency, because latency is where the bugs are.
 */
function PagedPane({
  target,
  total,
  pageSize,
  inThread = false,
}: {
  target: ScrollTarget;
  total: number;
  pageSize: number;
  inThread?: boolean;
}) {
  const [state, setState] = useState({
    oldest: Math.max(1, total - pageSize + 1),
    loading: false,
  });
  const all = useMemo(
    () =>
      Array.from({ length: total }, (_, i) =>
        message({
          id: `m-${i + 1}`,
          seq: i + 1,
          body: `line ${i + 1}`,
          metadata: inThread ? { taskId: THREAD.id } : {},
        })
      ),
    [total, inThread]
  );
  const loaded = all.filter((m) => m.seq >= state.oldest);
  const rows = inThread
    ? threadRows(loaded, THREAD.id, INDEX, formatChannelTimestamp)
    : channelRows(loaded, [], INDEX, formatChannelTimestamp);

  return (
    <ChannelsMessagePane
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      channelName="Website"
      thread={inThread ? THREAD : null}
      rows={rows}
      index={INDEX}
      members={MEMBERS}
      loading={false}
      scrollTarget={target}
      infoOpen={false}
      favorited={false}
      gate={{ begin: vi.fn(), end: vi.fn() }}
      onToggleFavorite={vi.fn()}
      onToggleInfo={vi.fn()}
      onExitThread={vi.fn()}
      onOpenThread={vi.fn()}
      hasOlder={state.oldest > 1}
      loadingOlder={state.loading}
      onLoadOlder={() => {
        setState((s) => ({ ...s, loading: true }));
        setTimeout(
          () =>
            setState((s) => ({
              oldest: Math.max(1, s.oldest - pageSize),
              loading: false,
            })),
          SETTLE_MS
        );
      }}
    />
  );
}

/**
 * Let the hunt run for `ms` of fake time, flushing effects as it goes.
 *
 * ⚠ **STEPPED, AND ONE BIG `advanceTimersByTime` DOES NOT WORK — this cost an
 * hour.** A page settles in a timer, which sets state; React then runs the
 * effect that asks for the NEXT page and schedules the next timer. That
 * scheduling happens when `act` flushes, which is AFTER
 * `advanceTimersByTime` has already returned — so a single big advance sees
 * exactly one timer, settles one page, and the hunt stalls with every landing
 * assertion failing for a reason that has nothing to do with the code under
 * test. Stepping with a flush per step is what lets the cascade actually run.
 */
async function advance(ms: number, step = SETTLE_MS / 2) {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(async () => {
      vi.advanceTimersByTime(step);
    });
  }
}

describe("a citation older than the loaded page", () => {
  it("pages back and LANDS on it, instead of stopping at the notice", async () => {
    render(
      <PagedPane
        target={{ messageId: "seq:1", nonce: 1 }}
        total={25}
        pageSize={5}
      />
    );
    // Five pages at SETTLE_MS, plus slack.
    await advance(SETTLE_MS * 6);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText("line 1")).toBeTruthy();
  });

  it("🔒 shows NO notice while the hunt is in flight", async () => {
    // Samuel: no jank. Taken MID-HUNT, in a committed frame where a page is
    // actually in flight — the frame the synchronous pager never produced.
    render(
      <PagedPane
        target={{ messageId: "seq:1", nonce: 1 }}
        total={25}
        pageSize={5}
      />
    );
    await advance(SETTLE_MS / 2);
    expect(screen.queryByText(SCROLL_TARGET_MISSING_NOTE)).toBeNull();
    await advance(SETTLE_MS * 2);
    expect(screen.queryByText(SCROLL_TARGET_MISSING_NOTE)).toBeNull();
  });

  it("🔒 the nonce SURVIVES a hunt longer than the miss timer", async () => {
    // ⚠ THE GUARD'S REASON TO EXIST. Without `hunting` in the landing effect's
    // early return, page one settles, the effect finds no row and arms the 6s
    // `MISSING_NOTICE_MS` timer; that timer then spends the nonce mid-hunt,
    // `live` goes false and the transcript never lands however many pages arrive.
    // This hunt takes ~15s of fake time, so it straddles that timer.
    render(
      <PagedPane
        target={{ messageId: "seq:1", nonce: 1 }}
        total={25}
        pageSize={5}
      />
    );
    await advance(SETTLE_MS * 7);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByText(SCROLL_TARGET_MISSING_NOTE)).toBeNull();
  });

  it("🔒 lands in a THREAD view too", async () => {
    render(
      <PagedPane
        target={{ messageId: "seq:2", nonce: 1 }}
        total={20}
        pageSize={4}
        inThread
      />
    );
    await advance(SETTLE_MS * 6);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText("line 2")).toBeTruthy();
    expect(screen.queryByText(SCROLL_TARGET_MISSING_NOTE)).toBeNull();
  });

  it("🔒 hunts a REAL message id too — the Mentions row's case", async () => {
    // A mention row jumps by id, with no seq to read. Same hunt, same landing.
    render(
      <PagedPane
        target={{ messageId: "m-3", nonce: 1 }}
        total={25}
        pageSize={5}
      />
    );
    await advance(SETTLE_MS * 6);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText("line 3")).toBeTruthy();
  });
});

describe("the honest notice is kept for the cases that deserve it", () => {
  it("🔒 says so at once when there is no older history to page", async () => {
    // The whole channel is loaded and the seq is not in it — nothing to hunt, so
    // this is today's behaviour unchanged, which `message-pane.test.tsx` pins too.
    render(
      <PagedPane
        target={{ messageId: "seq:99", nonce: 1 }}
        total={3}
        pageSize={3}
      />
    );
    expect(screen.getByText(SCROLL_TARGET_MISSING_NOTE)).toBeTruthy();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("🔒 a message that does not exist ends in the notice, not a spin", async () => {
    // A target the ceiling admitted but the channel does not hold — a deleted
    // message. The hunt pages to the beginning, then tells the truth.
    render(
      <PagedPane
        target={{ messageId: "m-does-not-exist", nonce: 1 }}
        total={25}
        pageSize={5}
      />
    );
    // ⚠ Long enough to exhaust the five pages (10s), NOT long enough to outlive
    // the notice: the landing effect arms `MISSING_NOTICE_MS` (6s) the moment the
    // hunt gives up, and advancing past that spends the nonce and takes the
    // notice back down again. The first draft advanced 16s and failed here for
    // that reason — the notice had come and gone.
    await advance(SETTLE_MS * 6);
    expect(screen.getByText(SCROLL_TARGET_MISSING_NOTE)).toBeTruthy();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
