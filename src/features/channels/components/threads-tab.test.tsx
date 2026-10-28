// @vitest-environment jsdom
/**
 * The Threads tab: the server's order verbatim (the read is clipped against it), a clipped page
 * says so (INVARIANTS §9), and the recency wells bucket on the LAST MESSAGE — `lastActivityAt`,
 * never `updatedAt`, whose only writer is `set_mode`. An undated thread stays in the open Recent.
 *
 * The clock is faked for every case: a thread dated in the past lands in a collapsed well, and an
 * assertion about its row would fail on a date nobody edited.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WELL_FACES } from "./collapse-wells";
import {
  THREADS_CLIPPED_NOTE,
  THREAD_WELLS_STORAGE_KEY,
  ThreadsTab,
  threadActivityAt,
} from "./threads-tab";
import { indexMembers } from "./view-model";
import { member, sessionSummary, thread, ME, PEER } from "./test-fixtures";

const HOUR = 3_600_000;
const DAY = 86_400_000;
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

const NO_FEEDS = { sessions: null, peers: [] };

/** Server order: newest activity first, deliberately neither alphabetical nor createdAt order. */
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
    feeds: NO_FEEDS,
    openThreadId: null,
    onOpenThread: vi.fn(),
    ...over,
  };
  return { props, ...render(<ThreadsTab {...props} />) };
}

describe("channels threads tab", () => {
  it("renders the server's order verbatim", () => {
    renderTab();
    const titles = screen.getAllByText(/sweep|audit/).map((el) => el.textContent);
    expect(titles).toEqual(["Zebra sweep", "Alpha audit"]);
  });

  it("has NO status filter, and every row opens", () => {
    renderTab();
    expect(screen.queryByRole("tab", { name: /Active/ })).toBeNull();
    for (const button of screen.getAllByRole("button", { name: "Open" })) {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("says so when the page was CLIPPED, claiming neither absence nor another page", () => {
    renderTab({ truncated: true });
    const note = screen.getByText(THREADS_CLIPPED_NOTE);
    expect(note.textContent).toMatch(/most recently active/i);
    expect(note.textContent).not.toMatch(/no threads|more than one page|there are more/i);
    expect(note.closest("section")).toBeNull();
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

  it("stacks the parties' faces, labelled with who they are", () => {
    renderTab({ threads: [THREADS[0]] });
    expect(screen.getByRole("img", { name: "With you, Diana T." })).toBeTruthy();
  });

  it("adds the thread's agents to the stack and counts the running ones", () => {
    renderTab({
      threads: [THREADS[0]],
      feeds: { sessions: [sessionSummary({ threadId: "t-b", name: "flint" })], peers: [] },
    });
    expect(screen.getByRole("img", { name: /With you, Diana T\., / })).toBeTruthy();
    expect(screen.getByText("1 running")).toBeTruthy();
  });

  it("draws no running pill when no feed can say", () => {
    renderTab();
    expect(screen.queryByText(/running/)).toBeNull();
  });

  it("marks the open thread's row as Viewing and opens the other", () => {
    const { props } = renderTab({ openThreadId: "t-b" });
    expect(screen.getByRole("button", { name: "Viewing" }).getAttribute("aria-current")).toBe(
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(props.onOpenThread).toHaveBeenCalledWith("t-a");
  });

  it("distinguishes an empty channel from a loading one", () => {
    renderTab({ threads: [], loading: true });
    expect(screen.queryByText("No threads yet")).toBeNull();
    cleanup();
    renderTab({ threads: [], loading: false });
    expect(screen.getByText("No threads yet").closest("section")).toBeNull();
  });
});

describe("channels threads tab — the recency wells", () => {
  const SPREAD = [
    thread({ id: "t-now", title: "Today thread", lastActivityAt: new Date(NOW - HOUR).toISOString() }),
    thread({ id: "t-week", title: "Week thread", lastActivityAt: new Date(NOW - 3 * DAY).toISOString() }),
    thread({ id: "t-month", title: "Month thread", lastActivityAt: new Date(NOW - 12 * DAY).toISOString() }),
    thread({ id: "t-old", title: "Old thread", lastActivityAt: new Date(NOW - 90 * DAY).toISOString() }),
    // An absent key, not `null`: what a single-thread read actually sends.
    thread({ id: "t-undated", title: "Undated thread", lastActivityAt: undefined }),
  ];
  const ALL_WELLS = ["Recent", "Last 7 days", "Last 30 days", "Earlier"];

  const wellOf = (title: string) => screen.getByRole("heading", { name: title }).closest("section")!;
  const headings = () => screen.queryAllByRole("heading").map((h) => h.textContent);

  it("dates a thread by its LAST MESSAGE, and reads an absent or unparseable stamp as unknown", () => {
    expect(threadActivityAt(thread({ lastActivityAt: "2026-08-18T11:00:00.000Z" }))).toBe(
      Date.UTC(2026, 7, 18, 11, 0, 0)
    );
    expect(threadActivityAt(thread({ lastActivityAt: undefined }))).toBeNull();
    expect(threadActivityAt(thread({ lastActivityAt: "not a date" }))).toBeNull();
  });

  it("files each thread in the well its last message falls in, and the undated one in Recent", () => {
    renderTab({ threads: SPREAD });
    expect(headings()).toEqual(ALL_WELLS);
    for (const label of ["Last 7 days", "Last 30 days", "Earlier"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    expect(within(wellOf("Recent")).getByText("Today thread")).toBeTruthy();
    expect(within(wellOf("Recent")).getByText("Undated thread")).toBeTruthy();
    expect(within(wellOf("Last 7 days")).getByText("Week thread")).toBeTruthy();
    expect(within(wellOf("Last 30 days")).getByText("Month thread")).toBeTruthy();
    expect(within(wellOf("Earlier")).getByText("Old thread")).toBeTruthy();
  });

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
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect(within(wellOf("Earlier")).getByText("Mode flipped")).toBeTruthy();
    expect(within(wellOf("Recent")).queryByText("Mode flipped")).toBeNull();
  });

  it("renders EVERY well, an empty one as its heading alone, and all four on an empty list", () => {
    renderTab({ threads: [SPREAD[1]] });
    expect(headings()).toEqual(ALL_WELLS);
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect(wellOf("Earlier").textContent).toBe("Earlier");

    cleanup();
    renderTab({ threads: [] });
    expect(headings()).toEqual(ALL_WELLS);
  });

  it("draws NO well while the first read is still in flight — unknown is not empty", () => {
    renderTab({ threads: [], loading: true });
    expect(headings()).toEqual([]);
  });

  it("wears the plain heading with each thread its OWN white card, and New thread outside it", () => {
    renderTab({ onNewThread: vi.fn() });
    const recent = wellOf("Recent");
    expect(recent.className).toBe(WELL_FACES.heading.box);
    const zebra = within(recent).getByText("Zebra sweep").closest(".white-card")!;
    const alpha = within(recent).getByText("Alpha audit").closest(".white-card")!;
    expect(zebra).not.toBe(alpha);
    // The meta line and the actions sit in the card, beside the title rather than under it.
    expect(within(zebra as HTMLElement).getByText("you · Diana T.")).toBeTruthy();
    expect(within(zebra as HTMLElement).getByRole("button", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New thread" }).closest("section")).toBeNull();
  });

  it("collapses Recent on a click, unmounting its rows, and remembers the choice per device", async () => {
    const first = renderTab();
    const row = screen.getByRole("button", { name: "Recent" });
    expect(row.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(JSON.parse(window.localStorage.getItem(THREAD_WELLS_STORAGE_KEY)!)).toMatchObject({
      recent: false,
    });
    await waitFor(() => expect(screen.queryByText("Zebra sweep")).toBeNull());
    expect(window.localStorage.getItem("dopl.agents.wells")).toBeNull();

    first.unmount();
    renderTab();
    expect(screen.getByRole("button", { name: "Recent" }).getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(screen.queryByText("Zebra sweep")).toBeNull();
  });
});
