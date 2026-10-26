// @vitest-environment jsdom
/**
 * THE TASKS TAB'S BODY (`tasks-panel.tsx`): the list (in progress, then open; resolved collapsed),
 * the row's tick as Resolve / Reopen, the drill-in detail (header, presence on the assignee stack,
 * no meta line, subtasks, notes), and R8's guest face: notes only, no tick, no Resolve, no checks.
 */

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { subtaskFacts } from "../lib/task-model";
import { TasksPanel, type TasksPanelProps } from "./tasks-panel";
import { taskFaceResolver } from "./task-faces";
import { indexMembers } from "./view-model";
import { member } from "./test-fixtures";
import { AGENT_ID, PEER, VIEWER, makeDetail, makeTask } from "./_task-fixtures";
import type { ChannelTask, ChannelTaskDetail } from "../types";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: VIEWER, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Grace Lee" }),
  ],
  VIEWER,
  new Map([[AGENT_ID, { displayName: "Backlog Scout", description: null, color: "agent-03" }]])
);
const faceOf = taskFaceResolver(INDEX, { sessions: [], peers: [] }, () => null);

const LIST: ChannelTask[] = [
  makeTask({ id: "t-open", title: "Open one", updatedAt: "2026-10-26T12:00:00.000Z" }),
  makeTask({ id: "t-1", title: "Fix upload retries", status: "in_progress", progress: { done: 1, total: 3 } }),
  makeTask({ id: "t-done", title: "Done one", status: "resolved", resolvedBy: { kind: "person", userId: VIEWER } }),
];

function Harness({ guest = false, ...over }: Partial<TasksPanelProps> & { guest?: boolean }) {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChannelTaskDetail>(makeDetail({ status: "in_progress" }));
  const props: TasksPanelProps = {
    tasks: LIST,
    faceOf,
    openTaskId,
    onOpenTask: setOpenTaskId,
    detail,
    onOpenLink: vi.fn(),
    onSetStatus: guest ? undefined : vi.fn(),
    onToggleSubtask: guest
      ? undefined
      : (task, sub) => {
          const subtasks = task.subtasks.map((s) =>
            s.id === sub.id ? { ...s, state: s.state === "done" ? ("todo" as const) : ("done" as const) } : s
          );
          setDetail({ ...task, subtasks, ...subtaskFacts(subtasks) });
        },
    onAddNote: vi.fn(async () => undefined),
    ...over,
  };
  return <TasksPanel {...props} />;
}

describe("the task list", () => {
  it("leads with in-progress work, collapses resolved tasks, and names people and agents", () => {
    render(<Harness />);
    const active = screen.getByRole("list", { name: "Active tasks" });
    const titles = within(active)
      .getAllByRole("button", { name: /^Open / })
      .map((b) => b.textContent);
    expect(titles).toEqual(["Fix upload retries", "Open one"]);
    expect(screen.queryByRole("list", { name: "Resolved tasks" })).toBeNull();
    expect(within(active).getAllByLabelText("Assigned to Backlog Scout, Sam Wang")).toHaveLength(2);
    expect(within(active).getByLabelText("1 of 3 subtasks done")).toBeTruthy();
    expect(within(active).getAllByText(/Backlog Scout opened/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Resolved/ }));
    const resolved = screen.getByRole("list", { name: "Resolved tasks" });
    expect(within(resolved).getByText(/Sam Wang resolved/)).toBeTruthy();
  });

  it("the tick resolves an active task and reopens a resolved one", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve Open one" }));
    expect(onSetStatus).toHaveBeenLastCalledWith(expect.objectContaining({ id: "t-open" }), "resolved");
    fireEvent.click(screen.getByRole("button", { name: /Resolved/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen Done one" }));
    expect(onSetStatus).toHaveBeenLastCalledWith(expect.objectContaining({ id: "t-done" }), "open");
  });

  it("the From chip opens what the task came from", () => {
    const onOpenLink = vi.fn();
    render(<Harness onOpenLink={onOpenLink} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Upload retry path" })[0]);
    expect(onOpenLink).toHaveBeenCalledWith({ kind: "thread", threadId: "th-1", title: "Upload retry path" });
  });

  it("says when nothing is listed, and nothing while the first read is in flight", () => {
    const { rerender } = render(<Harness tasks={[]} />);
    expect(screen.getByText("No tasks yet")).toBeTruthy();
    rerender(<Harness tasks={[]} loading />);
    expect(screen.queryByText("No tasks yet")).toBeNull();
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  });
});

describe("the task detail", () => {
  it("opens from the title, carries no meta line, and a check moves the header's progress", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open Fix upload retries" }));
    const detail = screen.getByRole("article", { name: "Fix upload retries" });
    expect(within(detail).getByText("Retries time out instead of backing off.")).toBeTruthy();
    expect(within(detail).queryByText(/^Opened /)).toBeNull();
    expect(within(detail).queryByText(/Updated/)).toBeNull();
    expect(within(detail).getByLabelText("Assigned to Backlog Scout (active), Sam Wang")).toBeTruthy();
    expect(detail.querySelectorAll('[data-presence="online"]')).toHaveLength(1);
    expect(within(detail).getByRole("button", { name: "Resolve" })).toBeTruthy();

    const check = within(detail).getByRole("checkbox", { name: "Ship it" });
    expect(check.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(check);
    expect(within(detail).getByRole("checkbox", { name: "Ship it" }).getAttribute("aria-checked")).toBe("true");
    expect(within(detail).getAllByLabelText("2 of 3 subtasks done").length).toBeGreaterThan(0);

    fireEvent.click(within(detail).getByRole("button", { name: "Back to tasks" }));
    expect(screen.getByRole("list", { name: "Active tasks" })).toBeTruthy();
  });

  it("posts a note through the pill composer and keeps the words until it lands", async () => {
    let land!: () => void;
    const onAddNote = vi.fn(() => new Promise<void>((r) => (land = r)));
    render(<Harness onAddNote={onAddNote} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Fix upload retries" }));
    const notes = screen.getByRole("region", { name: "Notes" });
    expect(within(notes).getByText("Following the doc.")).toBeTruthy();
    const box = within(notes).getByRole("textbox", { name: "Add a note" });
    fireEvent.change(box, { target: { value: "Merging after CI." } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onAddNote).toHaveBeenCalledWith("t-1", "Merging after CI.");
    expect((box as HTMLTextAreaElement).value).toBe("Merging after CI.");
    land();
    await vi.waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""));
  });

  it("a guest reads and adds notes, and has no tick, no Resolve and no checks (R8)", () => {
    render(<Harness guest />);
    expect(screen.queryByRole("button", { name: /^Resolve / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Fix upload retries" }));
    const detail = screen.getByRole("article", { name: "Fix upload retries" });
    expect(within(detail).queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(within(detail).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(detail).getByRole("textbox", { name: "Add a note" })).toBeTruthy();
  });
});
