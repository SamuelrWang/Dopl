// @vitest-environment jsdom
/**
 * The task tick's progress ring (Samuel, 2026-10-28): one segment per step, one filled per done
 * step, a check once every step is done; no steps or a resolved task keep the plain tick.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TaskTickFace, taskTickClass } from "./task-bits";

afterEach(cleanup);

const face = (status: "open" | "in_progress" | "resolved", progress: { done: number; total: number } | null) =>
  render(
    <span className={taskTickClass({ status, progress })}>
      <TaskTickFace task={{ status, progress }} />
    </span>
  ).container;

describe("the task tick", () => {
  it("draws one segment per step and fills the done ones", () => {
    const c = face("in_progress", { done: 2, total: 5 });
    const segs = c.querySelectorAll("circle");
    expect(segs).toHaveLength(5);
    expect([...segs].filter((s) => s.getAttribute("class")?.includes("stroke-text-primary"))).toHaveLength(2);
    expect(c.querySelector(".lucide-check")).toBeNull();
  });

  it("shows a full ring and the check once every step is done", () => {
    const c = face("open", { done: 3, total: 3 });
    const segs = [...c.querySelectorAll("circle")];
    expect(segs.every((s) => s.getAttribute("class")?.includes("stroke-text-primary"))).toBe(true);
    expect(c.querySelector(".lucide-check")).not.toBeNull();
  });

  it("keeps the plain tick with no steps", () => {
    const c = face("open", null);
    expect(c.querySelector("svg circle")).toBeNull();
    expect(c.firstElementChild?.className).toContain("rounded-full border");
  });

  it("keeps today's resolved tick on a resolved task with steps", () => {
    const c = face("resolved", { done: 2, total: 2 });
    expect(c.querySelector("circle")).toBeNull();
    expect(c.querySelector(".lucide-check")).not.toBeNull();
  });
});
