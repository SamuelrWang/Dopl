// @vitest-environment jsdom
/**
 * THE CHANGELOG LIST — day groups, the expanded diff, and the restore
 * confirmation.
 *
 * ⚠ **THE CONFIRMATION IS THE POINT OF THE THIRD BLOCK.** Restore over a list of
 * near-identical rows is the one place a mis-click is invisible until the next
 * read, so the dialog NAMES THE DATE and nothing is written until it is
 * confirmed.
 *
 * ⚠ MUTATION-VERIFIED — three reverts, three failures: calling `onRestore`
 * straight from the row button (no confirmation); diffing against the row ABOVE
 * rather than against the same resource's previous revision; and rendering
 * Restore for a body-less revision.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Revision } from "../types";
import { groupByDay } from "../lib/group";
import { ChangelogList } from "./changelog-list";

afterEach(cleanup);

function rev(over: Partial<Revision> & { id: string }): Revision {
  return {
    resourceType: "knowledge_entry",
    resourceId: "e-1",
    workspaceId: "ws-1",
    actor: { userId: "u-me", kind: "user", agentSessionId: null },
    op: "edit",
    summary: null,
    payload: { body: "body", title: "Notes", path: "notes.md" },
    contentHash: "h",
    createdAt: "2026-09-09T12:00:00.000Z",
    updatedAt: "2026-09-09T12:00:00.000Z",
    ...over,
  };
}

function mount(revisions: Revision[], props: Partial<Parameters<typeof ChangelogList>[0]> = {}) {
  return render(
    <ChangelogList
      days={groupByDay(revisions)}
      status="success"
      hasMore={false}
      isLoadingMore={false}
      onLoadMore={() => {}}
      canRestore
      onRestore={async () => {}}
      {...props}
    />
  );
}

describe("day groups", () => {
  it("heads each UTC day once, newest first", () => {
    mount([
      rev({ id: "a", createdAt: "2026-09-09T18:00:00.000Z" }),
      rev({ id: "b", createdAt: "2026-09-09T09:00:00.000Z" }),
      rev({ id: "c", createdAt: "2026-09-08T09:00:00.000Z" }),
    ]);
    const headings = screen.getAllByRole("heading", { level: 4 });
    expect(headings).toHaveLength(2);
    expect(headings[0].textContent).toContain("9");
    expect(headings[1].textContent).toContain("8");
  });

  it("says so when there is no history, rather than rendering an empty frame", () => {
    mount([]);
    expect(screen.getByText("No changes yet.")).toBeTruthy();
  });

  it("an AGENT row carries the agent mark and its session name", () => {
    mount([
      rev({
        id: "a",
        actor: { userId: "u-me", kind: "agent", agentSessionId: "chan-1:abc" },
      }),
    ]);
    expect(screen.getByLabelText("agent")).toBeTruthy();
    expect(screen.getByText("chan-1:abc")).toBeTruthy();
  });

  it("a human row carries the person mark and NO session name", () => {
    mount([rev({ id: "a" })]);
    expect(screen.getByLabelText("person")).toBeTruthy();
    expect(screen.queryByLabelText("agent")).toBeNull();
  });

  it("names the op and the path — `who · what · when`", () => {
    mount([rev({ id: "a", op: "section_edit", payload: { body: "b", path: "api.md" } })]);
    expect(screen.getByText(/Edited a section · api\.md/)).toBeTruthy();
  });
});

describe("the expanded diff", () => {
  it("is closed until the row is clicked", () => {
    mount([rev({ id: "a", payload: { body: "one two" } })]);
    expect(screen.queryByText(/added ·/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText(/added ·/)).toBeTruthy();
  });

  it("🔒 diffs against the previous revision OF THE SAME RESOURCE, not the row above", () => {
    // ⚠ THE MUTATION: `flat[at + 1]` unconditionally. On a base roll-up the row
    // below usually belongs to a DIFFERENT entry, and diffing against it draws a
    // change that never happened.
    mount([
      rev({ id: "newest", payload: { body: "alpha beta" } }),
      rev({ id: "other-entry", resourceId: "e-2", payload: { body: "zzz qqq" } }),
      rev({
        id: "previous",
        payload: { body: "alpha gamma" },
        createdAt: "2026-09-09T11:00:00.000Z",
      }),
    ]);
    fireEvent.click(screen.getAllByRole("button")[0]);
    // One word changed against `alpha gamma`; against `zzz qqq` it would be two.
    expect(screen.getByText("1 added · 1 removed")).toBeTruthy();
  });

  it("the first revision of a resource diffs against an empty before", () => {
    mount([rev({ id: "only", op: "create", payload: { body: "brand new" } })]);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText("2 added · 0 removed")).toBeTruthy();
  });
});

describe("restore", () => {
  function openFirstRow() {
    fireEvent.click(screen.getAllByRole("button")[0]);
  }

  it("🔒 writes NOTHING until the confirmation is accepted", async () => {
    const onRestore = vi.fn(async () => {});
    mount([rev({ id: "a" })], { onRestore });
    openFirstRow();
    fireEvent.click(screen.getByText("Restore"));
    await screen.findByRole("dialog");
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("the confirmation NAMES THE DATE of the version it would write back", async () => {
    mount([rev({ id: "a", createdAt: "2026-09-08T23:00:00.000Z" })]);
    openFirstRow();
    fireEvent.click(screen.getByText("Restore"));
    // ⚠ `ModalShell` mounts a frame later (rAF), so the dialog is awaited.
    // ⚠ SCOPED TO THE DIALOG: the day heading carries the same date, and an
    // unscoped query would pass on the heading alone.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/September 8, 2026/)).toBeTruthy();
  });

  it("confirming calls the writer with that revision", async () => {
    const onRestore = vi.fn<(revision: Revision) => Promise<void>>(async () => {});
    mount([rev({ id: "a" })], { onRestore });
    openFirstRow();
    fireEvent.click(screen.getByText("Restore"));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Restore" });
    fireEvent.click(confirm);
    await vi.waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("🔒 offers NO Restore for a body-less revision — a control that can only fail", () => {
    mount([rev({ id: "a", op: "move", payload: { path: "a/b" } })]);
    openFirstRow();
    expect(screen.queryByText("Restore")).toBeNull();
  });

  it("a viewer gets the diff and no Restore", () => {
    mount([rev({ id: "a" })], { canRestore: false });
    openFirstRow();
    expect(screen.queryByText("Restore")).toBeNull();
  });
});

describe("paging", () => {
  it("offers Load more only while the read is clipped", () => {
    const onLoadMore = vi.fn();
    const { rerender } = mount([rev({ id: "a" })], { hasMore: true, onLoadMore });
    fireEvent.click(screen.getByText("Load more"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(
      <ChangelogList
        days={groupByDay([rev({ id: "a" })])}
        status="success"
        hasMore={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
        canRestore
      />
    );
    expect(screen.queryByText("Load more")).toBeNull();
  });
});
