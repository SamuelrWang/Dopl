// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { isActiveTask } from "@/features/channels/lib/task-model";
import { DemoScene } from "./demo-scene";
import { STEPS, stepIndex, type StepId } from "./demo-steps";
import { FLAKES_TASK_ID, FLAKES_TASK_TITLE, tasksAt } from "./demo-tasks";

afterEach(cleanup);

const at = (id: StepId) => stepIndex(id);
const LAST_STEP = STEPS.length - 1;

/** The beat's task at a step. Throws when it is not listed. */
function flakes(step: number) {
  const found = tasksAt(step).find((t) => t.id === FLAKES_TASK_ID);
  if (!found) throw new Error(`no flakes task at step ${STEPS[step].id}`);
  return found;
}

function scene(id: StepId) {
  const { container } = render(<DemoScene step={at(id)} />);
  return within(container);
}

describe("the tasks beat's data", () => {
  it("seeds an open and a resolved task from the first frame", () => {
    const seeded = tasksAt(0);
    expect(seeded.map((t) => t.status).sort()).toEqual(["open", "resolved"]);
    expect(seeded.some((t) => t.id === FLAKES_TASK_ID)).toBe(false);
  });

  it("creates the task with the thread Debt Triage opens it from", () => {
    expect(tasksAt(at("thread-1") - 1).some((t) => t.id === FLAKES_TASK_ID)).toBe(false);
    const created = flakes(at("thread-1"));
    expect(created.status).toBe("open");
    expect(created.link).toMatchObject({ kind: "thread" });
    expect(created.subtasks).toEqual([]);
    expect(tasksAt(at("thread-1")).filter(isActiveTask)).toHaveLength(2);
  });

  it("adds the subtasks, then only ever moves progress forward to all done", () => {
    let done = 0;
    for (let step = at("brief-1"); step < at("task-resolved"); step += 1) {
      const t = flakes(step);
      expect(t.status).toBe("in_progress");
      expect(t.progress?.total).toBe(4);
      expect(t.progress?.done ?? 0).toBeGreaterThanOrEqual(done);
      done = t.progress?.done ?? 0;
    }
    expect(flakes(at("task-open")).progress?.done).toBe(2);
    expect(flakes(at("task-tick-1")).progress?.done).toBe(3);
    expect(flakes(at("task-tick-2")).progress?.done).toBe(4);
  });

  it("posts its closing note before it resolves", () => {
    expect(flakes(at("task-note")).notes.length).toBe(flakes(at("task-tick-2")).notes.length + 1);
    expect(flakes(at("task-note")).status).toBe("in_progress");
  });

  it("is resolved by its agent at the end frame", () => {
    for (const step of [at("task-resolved"), at("hold"), LAST_STEP]) {
      const t = flakes(step);
      expect(t.status).toBe("resolved");
      expect(t.resolvedBy).toEqual(t.assignees[0]);
      expect(tasksAt(step).filter(isActiveTask)).toHaveLength(1);
    }
  });

  it("writes its copy without dashes", () => {
    const copy = tasksAt(LAST_STEP).flatMap((t) => [
      t.title,
      t.description,
      ...t.subtasks.map((s) => s.title),
      ...t.notes.map((n) => n.body),
    ]);
    for (const line of copy) expect(line).not.toMatch(/[–—]| - /);
  });
});

describe("the tasks beat on stage", () => {
  it("raises the pill's count when the task is created", () => {
    expect(scene("split-3").getByRole("button", { name: "1 task" })).toBeTruthy();
    expect(scene("thread-1").getByRole("button", { name: "2 tasks" })).toBeTruthy();
  });

  it("shows progress moving in the detail the pop-up row opens", () => {
    const tab = scene("task-tick-1");
    expect(tab.getByRole("tab", { name: /^Tasks/ }).getAttribute("aria-selected")).toBe("true");
    const detail = tab.getByRole("article", { name: FLAKES_TASK_TITLE });
    expect(within(detail).getAllByLabelText("3 of 4 subtasks done").length).toBeGreaterThan(0);
  });

  it("ends on the list, the task under Resolved and the pill one lower", () => {
    const end = scene("hold");
    expect(end.getByRole("tab", { name: /^Tasks/ }).getAttribute("aria-selected")).toBe("true");
    const active = end.getByRole("list", { name: "Active tasks" });
    expect(active.textContent).not.toContain(FLAKES_TASK_TITLE);
    const resolved = end.getByRole("list", { name: "Resolved tasks" });
    expect(within(resolved).getAllByRole("listitem")).toHaveLength(2);
    expect(resolved.textContent).toContain(FLAKES_TASK_TITLE);
    expect(end.getByRole("button", { name: "1 task" })).toBeTruthy();
  });
});
