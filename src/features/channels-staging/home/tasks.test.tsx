// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StagingChannelsPage } from "../staging-channels-page";
import { useState } from "react";
import { TaskList } from "./task-list";
import { TaskPanel } from "./task-panel";
import { useStagingTasks } from "../store/use-staging-tasks";
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

function Harness({ onOpenLink = () => {} }: { onOpenLink?: () => void }) {
  const api = useStagingTasks([fixture]);
  const id = fixture.channel.id;
  return (
    <div className="uis-window">
      <TaskList
        tasks={api.tasksFor(id)}
        members={fixture.members}
        onResolve={(t) => api.resolve(id, t)}
        onReopen={(t) => api.reopen(id, t)}
        onOpenLink={onOpenLink}
      />
    </div>
  );
}

const activeList = () => screen.getByRole("list", { name: "Active tasks" });

describe("channel tasks (staging)", () => {
  it("seeds 5-7 tasks for #tech-debt with every link resolved, and none elsewhere", () => {
    const tasks = seedTasks(fixture);
    expect(tasks.length).toBeGreaterThanOrEqual(5);
    expect(tasks.length).toBeLessThanOrEqual(7);
    expect(new Set(tasks.map((t) => t.status))).toEqual(
      new Set(["open", "in_progress", "resolved"])
    );
    expect(tasks.every((t) => t.link !== null)).toBe(true);
    expect(seedTasks({ ...fixture, channel: { ...fixture.channel, id: "other" } })).toEqual([]);
  });

  it("lists active tasks, keeps resolved ones collapsed, and resolve moves a task to done", () => {
    const onOpenLink = vi.fn();
    render(<Harness onOpenLink={onOpenLink} />);
    expect(within(activeList()).getByText("Fix session teardown leaks")).toBeTruthy();
    expect(within(activeList()).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByLabelText(/Assigned to Teardown Order Fix, End Notice Check/)).toBeTruthy();
    // Resolved section is collapsed by default.
    expect(screen.queryByRole("list", { name: "Resolved tasks" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resolve Fix session teardown leaks" }));
    expect(within(activeList()).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Resolved/ }));
    const done = screen.getByRole("list", { name: "Resolved tasks" });
    expect(within(done).getByText("Fix session teardown leaks")).toBeTruthy();
    // The viewer is the closer (the seeded split task was his too).
    expect(within(done).getAllByText(/Daniel Ortiz resolved/)).toHaveLength(2);

    // Reopen sends it back to the active card.
    fireEvent.click(within(done).getByRole("button", { name: "Reopen Fix session teardown leaks" }));
    expect(within(activeList()).getByText("Fix session teardown leaks")).toBeTruthy();

    // The linked thread is a button.
    fireEvent.click(within(activeList()).getByRole("button", { name: "Upload retry path" }));
    expect(onOpenLink).toHaveBeenCalledWith(expect.objectContaining({ kind: "thread" }));
  });

  it("draws the Tasks tab (active + resolved) and the composer pill together", async () => {
    render(<StagingChannelsPage />);
    await waitFor(() => expect(document.body.textContent).toContain("straight in. it's test only"));
    const tab = screen.getAllByRole("tab").find((b) => (b.textContent ?? "").startsWith("Tasks"));
    expect(tab).toBeTruthy();
    // The pill sits on the composer's recipients line, with the working pills.
    const pill = screen.getByRole("button", { name: "4 tasks" });
    expect(pill.closest('[aria-label="Recipients"]')).toBeTruthy();
    // Round 1's face (round 3): faces of who is on in-progress work, at most three.
    expect(pill.querySelectorAll("[data-identity-face]")).toHaveLength(3);
    fireEvent.click(tab!);
    await waitFor(() => expect(screen.getByRole("list", { name: "Active tasks" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Resolved/ }));
    expect(screen.getByRole("list", { name: "Resolved tasks" })).toBeTruthy();
  }, 30_000);

  it("the pill opens a concise active-only pop-up that hides, reopens, and opens the Tasks tab", async () => {
    const consoleError = vi.spyOn(console, "error");
    render(<StagingChannelsPage />);
    const pill = await screen.findByRole("button", { name: "4 tasks" });
    const slide = () => document.querySelector(".channel-info-slide");
    // Close the Info column first: a quick-view row must open it again.
    fireEvent.click(screen.getAllByRole("button", { name: "Channel info" })[0]);
    await waitFor(() => expect(slide()?.getAttribute("data-open")).toBe("false"));

    fireEvent.click(pill);
    const pop = await screen.findByRole("region", { name: "Tasks" });
    // Host: the composer wrapper's last child, so it opens above the line, card-right aligned.
    expect(pop.parentElement?.className).toBe("uis-tk-pop-anchor");
    const quick = within(pop).getByRole("list", { name: "Active tasks, quick view" });
    expect(within(quick).getAllByRole("listitem")).toHaveLength(4);
    // Concise: no resolved tasks, no opener line, no status words, no link chips.
    expect(within(pop).queryByText("Rank the complaints in #eng-help")).toBeNull();
    expect(within(pop).queryByText(/opened/)).toBeNull();
    expect(within(pop).queryByText("In progress")).toBeNull();
    expect(within(pop).queryByRole("button", { name: "Upload retry path" })).toBeNull();

    // Hide folds it; the pill reopens it.
    fireEvent.click(within(pop).getByRole("button", { name: "Hide tasks" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Tasks" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "4 tasks" }));
    const again = await screen.findByRole("region", { name: "Tasks" });

    // A row opens the Info column on the Tasks tab, on that task's detail (round 4).
    fireEvent.click(within(again).getByRole("button", { name: /Fix upload retries timing out/ }));
    await waitFor(() => expect(slide()?.getAttribute("data-open")).toBe("true"));
    expect(screen.queryByRole("region", { name: "Tasks" })).toBeNull();
    const tasksTab = screen.getAllByRole("tab").find((b) => (b.textContent ?? "").startsWith("Tasks"));
    await waitFor(() => expect(tasksTab?.getAttribute("aria-selected")).toBe("true"));
    const detail = await screen.findByRole("article", { name: "Fix upload retries timing out" });
    expect(within(detail).getByRole("region", { name: "Subtasks" })).toBeTruthy();
    // Round 6: valid nesting everywhere tasks render (the pill's faces sit in the recipients
    // <p>), so React logs no nesting error.
    // (The demo face-swap parks its own imperative host divs beside the working pills; React
    // never renders those, so only our markup is checked here, plus React's own warnings.)
    expect(document.querySelectorAll(".uis-tk-pill div")).toHaveLength(0);
    const nesting = consoleError.mock.calls.filter((c) =>
      /cannot be a descendant|cannot contain a nested/.test(String(c[0]))
    );
    expect(nesting).toEqual([]);
    consoleError.mockRestore();
    // Back returns to the list.
    fireEvent.click(within(detail).getByRole("button", { name: "Back to tasks" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Active tasks" })).toBeTruthy());
  }, 30_000);

  it("task detail: opens from the list, toggles subtasks into both progress marks, adds a note", () => {
    function PanelHarness() {
      const api = useStagingTasks([fixture]);
      const [openId, setOpenId] = useState<string | null>(null);
      const id = fixture.channel.id;
      return (
        <div className="uis-window">
          <TaskPanel
            tasks={api.tasksFor(id)}
            members={fixture.members}
            onResolve={(t) => api.resolve(id, t)}
            onReopen={(t) => api.reopen(id, t)}
            onOpenLink={() => {}}
            openId={openId}
            onOpenChange={setOpenId}
            onToggleSubtask={(t, s) => api.toggleSubtask(id, t, s)}
            onAddNote={(t, text) => api.addNote(id, t, text)}
          />
        </div>
      );
    }
    render(<PanelHarness />);
    // Every seeded task carries a description, 3-5 subtasks and 1-4 notes.
    for (const t of seedTasks(fixture)) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.subtasks.length).toBeGreaterThanOrEqual(3);
      expect(t.subtasks.length).toBeLessThanOrEqual(5);
      expect(t.notes.length).toBeGreaterThanOrEqual(1);
      expect(t.notes.length).toBeLessThanOrEqual(4);
    }
    // The list row shows progress; the title opens the detail.
    expect(screen.getAllByLabelText("1 of 5 subtasks done").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Open Fix session teardown leaks" }));
    const detail = screen.getByRole("article", { name: "Fix session teardown leaks" });
    expect(within(detail).getByText(/The socket closes before teardown finishes/)).toBeTruthy();
    // Round 5: no "Active now" row; activity is a presence dot on the assignee stack.
    expect(within(detail).queryByText("Active now")).toBeNull();
    expect(
      within(detail).getByLabelText(
        "Assigned to Teardown Order Fix (active), End Notice Check (active), Wake Replay Trace"
      )
    ).toBeTruthy();
    expect(detail.querySelectorAll('[data-presence="online"]')).toHaveLength(2);
    // Round 8: the opener / dates meta line is gone.
    expect(within(detail).queryByLabelText("Task details")).toBeNull();
    expect(within(detail).queryByText(/^Opened /)).toBeNull();
    expect(within(detail).getByLabelText("1 of 5 subtasks done")).toBeTruthy();

    // Checking a subtask moves the header's progress.
    const check = within(detail).getByRole("checkbox", { name: "Regression tests for all three" });
    expect(check.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(check);
    expect(check.getAttribute("aria-checked")).toBe("true");
    expect(within(detail).getByLabelText("2 of 5 subtasks done")).toBeTruthy();

    // A note appends as the viewer.
    const notes = within(detail).getByRole("region", { name: "Notes" });
    expect(within(notes).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.change(within(notes).getByRole("textbox", { name: "Add a note" }), {
      target: { value: "Merging after CI is green." },
    });
    fireEvent.click(within(notes).getByRole("button", { name: "Post note" }));
    expect(within(notes).getAllByRole("listitem")).toHaveLength(4);
    expect(within(notes).getByText("Merging after CI is green.")).toBeTruthy();

    // Back to the list: the row's progress moved too.
    fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));
    expect(screen.getByRole("list", { name: "Active tasks" })).toBeTruthy();
    expect(screen.getByLabelText("2 of 5 subtasks done")).toBeTruthy();
  });
});
