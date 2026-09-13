// @vitest-environment jsdom
/**
 * The Threads tab. Three properties, all of which a redesign loses quietly:
 *
 *  - **NO STATUS FILTER.** The mock's Active/Inactive `SegmentedControl` did not
 *    survive the port — threads never close, so activity ordering replaced it
 *    (a third-round ruling in the port's intent doc, deleted at the cutover —
 *    INVARIANTS §5).
 *  - **THE SERVER'S ORDER IS RENDERED VERBATIM.** The read is clipped against
 *    that order, so a re-sort here is the wrong rows in a plausible order
 *    (INVARIANTS §5).
 *  - **A CLIPPED PAGE SAYS SO** (INVARIANTS §9): a cap that renders identically
 *    to an exhausted list is the bug, and the note may not read as an absence.
 *  - **THE FOUR GRAY WELLS ARE BUCKETED BY LAST MESSAGE** (Samuel, 2026-09-13:
 *    *"This should be measured on activity (basically, last message sent into the
 *    thread)"*) — i.e. `lastActivityAt`, **never `updatedAt`**, whose only writer
 *    is `set_mode`. The two fields look interchangeable and are not, so one case
 *    gives a thread a stale activity stamp and a fresh `updatedAt` and asserts
 *    which well it lands in.
 *  - **AN UNDATED THREAD STAYS VISIBLE** — it lands in **Recent**, the one well
 *    open by default, because a read that did not derive the field must not hide
 *    a live thread inside a collapsed **Earlier**.
 *
 * ⚠ **THE CLOCK IS FAKED FOR EVERY CASE IN THIS FILE.** The moment the cards live
 * in time-bucketed wells, a fixture dated in the past renders inside a COLLAPSED
 * well and every assertion about a card's text fails — on a date nobody edited.
 * `NOW` sits just after the fixtures' own activity stamps, so the pre-wells cases
 * read exactly the list they always read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PANEL_WELL } from "@/shared/ui/panel-well";
import {
  THREADS_CLIPPED_NOTE,
  THREAD_WELLS_STORAGE_KEY,
  ThreadsTab,
  threadActivityAt,
} from "./threads-tab";
import { indexMembers } from "./view-model";
import { member, thread, ME, PEER } from "./test-fixtures";

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Just after the fixtures' own activity stamps, so THREADS is one Recent well. */
const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
});

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

/** Server order: newest activity first. Deliberately NOT alphabetical and NOT
 *  createdAt order, so a re-sort of either kind shows up. */
const THREADS = [
  thread({
    id: "t-b",
    title: "Zebra sweep",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastActivityAt: "2026-08-18T11:00:00.000Z",
  }),
  thread({
    id: "t-a",
    title: "Alpha audit",
    createdAt: "2026-08-17T00:00:00.000Z",
    lastActivityAt: "2026-08-18T09:00:00.000Z",
  }),
];

function renderTab(over: Partial<React.ComponentProps<typeof ThreadsTab>> = {}) {
  const props: React.ComponentProps<typeof ThreadsTab> = {
    threads: THREADS,
    truncated: false,
    loading: false,
    index: INDEX,
    openThreadId: null,
    onOpenThread: vi.fn(),
    ...over,
  };
  render(<ThreadsTab {...props} />);
  return props;
}

describe("channels-v2 threads tab", () => {
  it("renders the server's order verbatim", () => {
    renderTab();
    const titles = screen
      .getAllByText(/sweep|audit/)
      .map((el) => el.textContent);
    expect(titles).toEqual(["Zebra sweep", "Alpha audit"]);
  });

  it("has NO status filter", () => {
    renderTab();
    expect(screen.queryByRole("tab", { name: /Active/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Inactive/ })).toBeNull();
    // …and every card opens: nothing is disabled for being "closed".
    for (const button of screen.getAllByRole("button", { name: "Open" })) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("says so when the page was CLIPPED, and does not read as an absence", () => {
    renderTab({ truncated: true });
    const note = screen.getByText(THREADS_CLIPPED_NOTE);
    expect(note).not.toBeNull();
    expect(note.textContent).toMatch(/most recently active/i);
    expect(note.textContent).not.toMatch(/no threads/i);
  });

  /**
   * ⚠ AND IT MAY NOT OVER-ASSERT IN THE OTHER DIRECTION. The note used to say
   * the channel "holds more than one page", which this read NEVER established:
   * a page AT the ceiling counts as clipped precisely because a full page and
   * an exhausted one are indistinguishable from here (INVARIANTS §9). A channel
   * with exactly the limit was being told there was more.
   */
  it("claims nothing about what is NOT shown", () => {
    renderTab({ truncated: true });
    const note = screen.getByText(THREADS_CLIPPED_NOTE);
    expect(note.textContent).not.toMatch(/more than one page/i);
    expect(note.textContent).not.toMatch(/there are more/i);
  });

  it("stays silent when the page was not clipped", () => {
    renderTab();
    expect(screen.queryByText(THREADS_CLIPPED_NOTE)).toBeNull();
  });

  it("names the two parties, with the viewer as 'you'", () => {
    renderTab();
    expect(screen.getAllByText("you · Diana T.").length).toBeGreaterThan(0);
  });

  it("names a party with NO display name and NO email rather than rendering a gap", () => {
    // ⚠ `view-model.ts › shortName` used to answer "" here, because `""` is
    // not nullish and walked straight past its own "Member" fallback. The card
    // then showed the avatar of somebody the byline did not name.
    const nameless = indexMembers(
      [
        member({ userId: ME, displayName: "Sam Wang" }),
        member({ userId: PEER, displayName: null, email: null, role: "member" }),
      ],
      ME
    );
    renderTab({ index: nameless });
    expect(screen.getAllByText("you · Member").length).toBeGreaterThan(0);
  });

  it("marks the open thread's card as Viewing and opens the other", () => {
    const props = renderTab({ openThreadId: "t-b" });
    expect(screen.getByRole("button", { name: "Viewing" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(props.onOpenThread).toHaveBeenCalledWith("t-a");
  });

  it("distinguishes an empty channel from a loading one", () => {
    renderTab({ threads: [], loading: true });
    expect(screen.queryByText("No threads in this channel yet.")).toBeNull();
    cleanup();
    renderTab({ threads: [], loading: false });
    expect(screen.getByText("No threads in this channel yet.")).not.toBeNull();
  });
});

/**
 * 🔒 **THE FOUR GRAY WELLS (Samuel, 2026-09-13):** *"for the threads page/tab, I
 * want you to add the same gray backgrounds that we added to the Agents tab.
 * Basically, Recent, last 7 days, etc. This should be measured on activity
 * (basically, last message sent into the thread)."*
 */
describe("channels-v2 threads tab — the four recency wells", () => {
  /** One thread per bucket, plus one this read could not date. */
  const SPREAD = [
    thread({ id: "t-now", title: "Today thread", lastActivityAt: new Date(NOW - HOUR).toISOString() }),
    thread({ id: "t-week", title: "Week thread", lastActivityAt: new Date(NOW - 3 * DAY).toISOString() }),
    thread({ id: "t-month", title: "Month thread", lastActivityAt: new Date(NOW - 12 * DAY).toISOString() }),
    thread({ id: "t-old", title: "Old thread", lastActivityAt: new Date(NOW - 90 * DAY).toISOString() }),
    // ⚠ NOT `lastActivityAt: null` — the field is OPTIONAL on the DTO, and an
    // absent key is what a single-thread read actually sends.
    thread({ id: "t-undated", title: "Undated thread", lastActivityAt: undefined }),
  ];

  function wellOf(title: string): HTMLElement {
    return screen.getByRole("heading", { name: title }).closest("section")!;
  }

  it("dates a thread by its LAST MESSAGE, and reads an absent or unparseable stamp as unknown", () => {
    expect(threadActivityAt(thread({ lastActivityAt: "2026-08-18T11:00:00.000Z" }))).toBe(
      Date.UTC(2026, 7, 18, 11, 0, 0)
    );
    expect(threadActivityAt(thread({ lastActivityAt: undefined }))).toBeNull();
    expect(threadActivityAt(thread({ lastActivityAt: "not a date" }))).toBeNull();
  });

  it("files each thread in the well its last message falls in, and the undated one in Recent", () => {
    renderTab({ threads: SPREAD });
    expect(screen.queryAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Recent",
      "Last 7 days",
      "Last 30 days",
      "Earlier",
    ]);
    // ⚠ EVERY WELL IS OPENED, because three of the four are collapsed by default
    // and a collapsed well holds no cards at all.
    for (const label of ["Last 7 days", "Last 30 days", "Earlier"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    expect(within(wellOf("Recent")).getByText("Today thread")).toBeTruthy();
    expect(within(wellOf("Recent")).getByText("Undated thread")).toBeTruthy();
    expect(within(wellOf("Last 7 days")).getByText("Week thread")).toBeTruthy();
    expect(within(wellOf("Last 30 days")).getByText("Month thread")).toBeTruthy();
    expect(within(wellOf("Earlier")).getByText("Old thread")).toBeTruthy();
  });

  /**
   * ⚠ THE ONE MEASUREMENT THAT LOOKS INTERCHANGEABLE AND IS NOT. `updatedAt`'s
   * only writer is `set_mode` (INVARIANTS §5), so a thread whose mode was flipped
   * a minute ago but whose last message is six weeks old belongs in **Earlier** —
   * bucketing on `updatedAt` would put it in **Recent** and call a silent thread
   * busy.
   */
  it("buckets on lastActivityAt and NOT on updatedAt", () => {
    renderTab({
      threads: [
        thread({
          id: "t-moded",
          title: "Mode flipped",
          lastActivityAt: new Date(NOW - 42 * DAY).toISOString(),
          updatedAt: new Date(NOW - HOUR).toISOString(),
        }),
      ],
    });
    expect(screen.queryAllByRole("heading").map((h) => h.textContent)).toEqual(["Earlier"]);
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect(within(wellOf("Earlier")).getByText("Mode flipped")).toBeTruthy();
  });

  it("does NOT render a well with no threads in it", () => {
    renderTab({ threads: [SPREAD[1]] });
    expect(screen.queryAllByRole("heading").map((h) => h.textContent)).toEqual(["Last 7 days"]);
    // …and an empty list renders no well at all — the one sentence still stands.
    cleanup();
    renderTab({ threads: [] });
    expect(screen.queryAllByRole("heading")).toEqual([]);
    expect(screen.getByText("No threads in this channel yet.")).toBeTruthy();
  });

  it("is the /home Overview's well, and the New thread button stays OUTSIDE it", () => {
    renderTab({ onNewThread: vi.fn() });
    // ⚠ THE CONSTANT, not a copy of its current value.
    expect(wellOf("Recent").className).toBe(PANEL_WELL);
    const newThread = screen.getByRole("button", { name: "New thread" });
    expect(newThread.closest("section")).toBeNull();
  });

  it("keeps the clipped note ABOVE the wells, where it is not a claim about 24 hours", () => {
    renderTab({ truncated: true });
    expect(screen.getByText(THREADS_CLIPPED_NOTE).closest("section")).toBeNull();
  });

  it("collapses Recent on a click, unmounting its cards, and remembers the choice per device", async () => {
    const first = render(
      <ThreadsTab
        threads={THREADS}
        truncated={false}
        loading={false}
        index={INDEX}
        openThreadId={null}
        onOpenThread={vi.fn()}
      />
    );
    const row = screen.getByRole("button", { name: "Recent" });
    expect(row.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(
      JSON.parse(window.localStorage.getItem(THREAD_WELLS_STORAGE_KEY)!)
    ).toMatchObject({ recent: false });
    // ⚠ THE CARDS OUTLIVE `open` BY EXACTLY ONE TRANSITION, then go — collapsed
    // means UNMOUNTED, not hidden.
    expect(screen.getByText("Zebra sweep")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Zebra sweep")).toBeNull());

    // ⚠ AND IT IS THIS TAB'S OWN KEY: the Agents tab's is untouched.
    expect(window.localStorage.getItem("dopl.agents.wells")).toBeNull();

    first.unmount();
    renderTab();
    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(screen.queryByText("Zebra sweep")).toBeNull();
  });
});
