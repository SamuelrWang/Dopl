// @vitest-environment jsdom
// The mocked Tasks page: the agenda spine (days, the now rule, a missed run with Run now), the
// channel filter, the saved-task library in the rail, the task view and the zero-assignment editor.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TasksStagingPage } from "./tasks-staging-page";

afterEach(cleanup);

describe("/playground/tasks", () => {
  it("draws the agenda with the now rule and a flagged missed run", async () => {
    render(<TasksStagingPage />);
    const today = await screen.findByRole("list", { name: "Today" });
    expect(within(today).getByRole("listitem", { name: "Now, 12:15" })).toBeTruthy();
    const missed = within(today).getByText("Standup notes").closest("li")!;
    expect(missed.getAttribute("data-state")).toBe("missed");
    expect(within(missed).getByRole("button", { name: "Run now" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Anytime" })).toBeTruthy();
  });

  it("scopes the agenda and the library by channel", async () => {
    render(<TasksStagingPage />);
    await screen.findByRole("list", { name: "Today" });
    fireEvent.click(screen.getByRole("tab", { name: "#releases" }));
    const library = screen.getByRole("list", { name: "Saved task library" });
    expect(within(library).getByText("Cut a release")).toBeTruthy();
    expect(within(library).queryByText("Monday digest")).toBeNull();
  });

  it("opens a saved task with pinned and unpinned steps", async () => {
    render(<TasksStagingPage />);
    const library = await screen.findByRole("list", { name: "Saved task library" });
    fireEvent.click(within(library).getByText("Monday digest"));
    const view = await screen.findByRole("dialog", { name: "Monday digest" });
    expect(within(view).getByText("Agents decide")).toBeTruthy();
    fireEvent.click(within(view).getByRole("tab", { name: /Runs/ }));
    expect(within(view).getByText("Missed")).toBeTruthy();
  });

  it("creates a saved task with nobody assigned", async () => {
    render(<TasksStagingPage />);
    await screen.findByRole("list", { name: "Today" });
    fireEvent.click(screen.getByRole("button", { name: "Saved task" }));
    const editor = await screen.findByRole("dialog", { name: /New saved task/i });
    expect(within(editor).getByRole("button", { name: "Assign to" }).textContent).toContain("Nobody yet");
    fireEvent.change(within(editor).getByLabelText("Saved task title"), { target: { value: "Weekly sweep" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Create" }));
    const library = screen.getByRole("list", { name: "Saved task library" });
    expect(within(library).getByText("Weekly sweep")).toBeTruthy();
  });
});
