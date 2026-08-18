// @vitest-environment jsdom
/**
 * The Threads tab. Three properties, all of which a redesign loses quietly:
 *
 *  - **NO STATUS FILTER.** The mock's Active/Inactive `SegmentedControl` did not
 *    survive the port — threads never close, so activity ordering replaced it
 *    (MAPPING.md third round).
 *  - **THE SERVER'S ORDER IS RENDERED VERBATIM.** The read is clipped against
 *    that order, so a re-sort here is the wrong rows in a plausible order
 *    (INVARIANTS §5).
 *  - **A CLIPPED PAGE SAYS SO** (INVARIANTS §9): a cap that renders identically
 *    to an exhausted list is the bug, and the note may not read as an absence.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { THREADS_CLIPPED_NOTE, ThreadsTab } from "./threads-tab";
import { indexMembers } from "./view-model";
import { member, thread, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

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

  it("stays silent when the page was not clipped", () => {
    renderTab();
    expect(screen.queryByText(THREADS_CLIPPED_NOTE)).toBeNull();
  });

  it("names the two parties, with the viewer as 'you'", () => {
    renderTab();
    expect(screen.getAllByText("you · Diana T.").length).toBeGreaterThan(0);
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
