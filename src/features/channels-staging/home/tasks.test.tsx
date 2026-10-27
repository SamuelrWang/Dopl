// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StagingChannelsPage } from "../staging-channels-page";
import { techDebtFixture } from "../data/tech-debt-fixture";
import { seedTasks } from "../data/staging-tasks";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as never;
Element.prototype.scrollIntoView ??= () => {};

const fixture = techDebtFixture();
const tasksTab = () =>
  screen.getAllByRole("tab").find((b) => (b.textContent ?? "").startsWith("Tasks"));

describe("channel tasks on the staging page (product UI, in-memory store)", () => {
  it("seeds 5-7 contract-shaped tasks for #tech-debt with every link resolved, and none elsewhere", () => {
    const tasks = seedTasks(fixture);
    expect(tasks.length).toBeGreaterThanOrEqual(5);
    expect(tasks.length).toBeLessThanOrEqual(7);
    expect(new Set(tasks.map((t) => t.status))).toEqual(
      new Set(["open", "in_progress", "resolved"])
    );
    expect(tasks.every((t) => t.link !== null)).toBe(true);
    for (const t of tasks) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.subtasks.length).toBeGreaterThanOrEqual(3);
      expect(t.notes.length).toBeGreaterThanOrEqual(1);
      expect(t.progress?.total).toBe(t.subtasks.length);
      // An agent actor carries its operator's account.
      for (const a of t.assignees) expect(a.userId.length).toBeGreaterThan(0);
    }
    expect(seedTasks({ ...fixture, channel: { ...fixture.channel, id: "other" } })).toEqual([]);
  });

  it("draws the Tasks tab left of Settings and the pill at the recipient line's end", async () => {
    render(<StagingChannelsPage />);
    await waitFor(() => expect(document.body.textContent).toContain("straight in. it's test only"));
    const labels = screen.getAllByRole("tab").map((t) => t.textContent ?? "");
    const tasksAt = labels.findIndex((l) => l.startsWith("Tasks"));
    expect(labels[tasksAt + 1]).toBe("Settings");
    const pill = screen.getByRole("button", { name: "5 tasks" });
    const recipients = screen.getByRole("status", { name: "Recipients" });
    expect(recipients.contains(pill)).toBe(false);
    expect(recipients.parentElement?.contains(pill)).toBe(true);
    expect(pill.querySelectorAll("[data-identity-face]")).toHaveLength(3);
  }, 30_000);

  it("a quick-view row opens the closed column on that task's detail, and checking moves progress", async () => {
    const consoleError = vi.spyOn(console, "error");
    render(<StagingChannelsPage />);
    const pill = await screen.findByRole("button", { name: "5 tasks" });
    const slide = () => document.querySelector(".channel-info-slide");
    fireEvent.click(screen.getAllByRole("button", { name: "Channel info" })[0]);
    await waitFor(() => expect(slide()?.getAttribute("data-open")).toBe("false"));

    fireEvent.click(pill);
    const pop = await screen.findByRole("region", { name: "Tasks" });
    expect(pop.parentElement).toBe(pill.parentElement);
    fireEvent.click(within(pop).getByRole("button", { name: /Fix session teardown leaks/ }));
    await waitFor(() => expect(slide()?.getAttribute("data-open")).toBe("true"));
    await waitFor(() => expect(tasksTab()?.getAttribute("aria-selected")).toBe("true"));
    const detail = await screen.findByRole("article", { name: "Fix session teardown leaks" });
    expect(detail.querySelectorAll('[data-presence="online"]')).toHaveLength(2);

    fireEvent.click(within(detail).getByRole("checkbox", { name: "Regression tests for all three" }));
    expect(within(detail).getByLabelText("2 of 5 subtasks done")).toBeTruthy();
    const notes = within(detail).getByRole("region", { name: "Notes" });
    fireEvent.change(within(notes).getByRole("textbox", { name: "Add a note" }), {
      target: { value: "Merging after CI is green." },
    });
    fireEvent.click(within(notes).getByRole("button", { name: "Post note" }));
    expect(await within(notes).findByText("Merging after CI is green.")).toBeTruthy();

    const nesting = consoleError.mock.calls.filter((c) =>
      /cannot be a descendant|cannot contain a nested/.test(String(c[0]))
    );
    expect(nesting).toEqual([]);
    consoleError.mockRestore();
    fireEvent.click(within(detail).getByRole("button", { name: "Back to tasks" }));
    expect(await screen.findByRole("list", { name: "Active tasks" })).toBeTruthy();
    expect(screen.getByLabelText("2 of 5 subtasks done")).toBeTruthy();
  }, 30_000);
});
