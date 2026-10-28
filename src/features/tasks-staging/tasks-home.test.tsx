// @vitest-environment jsdom
// The mocked Tasks page, second shape: the week bar (today marked, chips in time order, "+N",
// week arrows), the dense list in Needs you / Repeating / One-off, the channel filter, the shared
// task view from a chip and from a row, and the zero-assignment editor.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TasksStagingPage } from "./tasks-staging-page";

afterEach(cleanup);

async function open() {
  render(<TasksStagingPage />);
  return screen.findByRole("region", { name: "This week's runs" });
}

describe("/playground/tasks", () => {
  it("marks today and caps its chips with +N that opens the rest", async () => {
    const week = await open();
    const today = within(week).getByRole("listitem", { name: /Wed Oct 28, today/ });
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(within(today).getByRole("button", { name: /8:30 Standup notes, Missed/ })).toBeTruthy();
    const more = within(today).getByRole("button", { name: /^\+\d more$/ });
    fireEvent.click(more);
    expect(within(today).getByRole("button", { name: /17:00 Migration review, Scheduled/ })).toBeTruthy();
  });

  it("steps a week and back", async () => {
    const week = await open();
    fireEvent.click(within(week).getByRole("button", { name: "Next week" }));
    expect(within(week).getByText("Nov 2 to Nov 8")).toBeTruthy();
    fireEvent.click(within(week).getByRole("button", { name: "Back to this week" }));
    expect(within(week).getByText("Oct 26 to Nov 1")).toBeTruthy();
  });

  it("groups tasks into dense rows and scopes by channel", async () => {
    await open();
    const needs = screen.getByRole("list", { name: "Needs you" });
    expect(within(needs).getByText("Review the pricing page copy")).toBeTruthy();
    expect(within(needs).getByText("Standup notes")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "One-off" })).getByText("Audit unused feature flags")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "#releases" }));
    expect(screen.queryByRole("list", { name: "One-off" })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Repeating" })).getByText("Cut a release")).toBeTruthy();
  });

  it("opens the same task view from a chip and from a row", async () => {
    const week = await open();
    fireEvent.click(within(week).getAllByRole("button", { name: /Monday digest/ })[0]);
    const view = await screen.findByRole("dialog", { name: "Monday digest" });
    expect(within(view).getByText("Agents decide")).toBeTruthy();
    expect(within(view).getByRole("button", { name: "Run now" })).toBeTruthy();
    fireEvent.click(within(view).getByRole("button", { name: "Close saved task" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Draft the Q4 roadmap" }));
    expect(await screen.findByRole("dialog", { name: "Draft the Q4 roadmap" })).toBeTruthy();
  });

  it("creates a task with nobody assigned", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Task" }));
    const editor = await screen.findByRole("dialog", { name: /New task/i });
    expect(within(editor).getByRole("button", { name: "Assign to" }).textContent).toContain("Nobody yet");
    fireEvent.change(within(editor).getByLabelText("Task title"), { target: { value: "Weekly sweep" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Create" }));
    expect(within(screen.getByRole("list", { name: "One-off" })).getByText("Weekly sweep")).toBeTruthy();
  });
});
