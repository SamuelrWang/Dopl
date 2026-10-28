// @vitest-environment jsdom
/**
 * THE TASKS QUICK VIEW: a pill carrying the faces of whoever is on in-progress work (at most
 * three, else the list mark) and the active count, at the recipient line's right end — outside
 * the status `<p>`, so its pop-up is valid markup — opening a concise, active-only pop-up whose
 * rows and "See all" open the Tasks tab, and which Hide or the pill folds.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ComposerRecipients } from "./composer-recipients";
import { TasksQuickView } from "./tasks-quick-view";
import { taskFaceResolver } from "./task-faces";
import { indexMembers } from "./view-model";
import { member } from "./test-fixtures";
import { AGENT_ID, PEER, VIEWER, makeTask } from "./_task-fixtures";

afterEach(cleanup);

const INDEX = indexMembers(
  [member({ userId: VIEWER, displayName: "Sam Wang" }), member({ userId: PEER, displayName: "Grace Lee" })],
  VIEWER,
  new Map([[AGENT_ID, { displayName: "Backlog Scout", description: null, color: "agent-03" }]])
);
const faceOf = taskFaceResolver(INDEX, { sessions: [], peers: [] }, () => null);

const TASKS = [
  makeTask({ id: "t-1", title: "Fix upload retries", status: "in_progress" }),
  makeTask({ id: "t-2", title: "Write it up" }),
  makeTask({ id: "t-3", title: "Already done", status: "resolved" }),
];

function mount(tasks = TASKS, onOpenTask = vi.fn()) {
  render(
    <ComposerRecipients
      body=""
      members={[]}
      sessions={[]}
      currentUserId={VIEWER}
      trailing={<TasksQuickView tasks={tasks} faceOf={faceOf} onOpenTask={onOpenTask} />}
    />
  );
  return onOpenTask;
}

describe("the tasks quick view", () => {
  it("sits after the recipient line, not inside it, with the in-progress faces and the active count", () => {
    mount();
    const pill = screen.getByRole("button", { name: "2 tasks" });
    const line = screen.getByRole("status", { name: "Recipients" });
    expect(line.contains(pill)).toBe(false);
    expect(line.parentElement?.lastElementChild?.contains(pill)).toBe(true);
    expect(pill.querySelectorAll("[data-identity-face]")).toHaveLength(2);
  });

  it("shows the list mark when nothing is in progress, and nothing at all without tasks", () => {
    mount([makeTask()]);
    const pill = screen.getByRole("button", { name: "1 task" });
    expect(pill.querySelectorAll("[data-identity-face]")).toHaveLength(0);
    expect(pill.querySelector("svg")).not.toBeNull();
    cleanup();
    mount([]);
    expect(screen.queryByRole("button", { name: /task/ })).toBeNull();
  });

  it("opens active-only rows, folds on Hide and on the pill, and a row opens that task", () => {
    const onOpenTask = mount();
    const pill = screen.getByRole("button", { name: "2 tasks" });
    fireEvent.click(pill);
    const pop = screen.getByRole("region", { name: "Tasks" });
    expect(pop.parentElement).toBe(pill.parentElement);
    const rows = within(pop).getByRole("list", { name: "Active tasks, quick view" });
    expect(within(rows).getAllByRole("listitem")).toHaveLength(2);
    expect(within(pop).queryByText("Already done")).toBeNull();
    expect(within(pop).queryByText("In progress")).toBeNull();

    fireEvent.click(within(pop).getByRole("button", { name: "Hide tasks" }));
    expect(screen.queryByRole("region", { name: "Tasks" })).toBeNull();
    fireEvent.click(pill);
    fireEvent.click(pill);
    expect(screen.queryByRole("region", { name: "Tasks" })).toBeNull();

    fireEvent.click(pill);
    fireEvent.click(within(screen.getByRole("region", { name: "Tasks" })).getByRole("button", { name: /Write it up/ }));
    expect(onOpenTask).toHaveBeenLastCalledWith("t-2");
    expect(screen.queryByRole("region", { name: "Tasks" })).toBeNull();

    fireEvent.click(pill);
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(onOpenTask).toHaveBeenLastCalledWith(null);
  });
});
