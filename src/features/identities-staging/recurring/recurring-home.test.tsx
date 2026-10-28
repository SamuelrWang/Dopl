// @vitest-environment jsdom
// The Recurring tasks mockup behind the Identities | Teams | Recurring tasks switch: both
// sections, the rail's running and next runs, the task view's two tabs, and the staged editor.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IdentitiesStagingPage } from "../identities-staging-page";

afterEach(cleanup);

async function openRecurring() {
  render(<IdentitiesStagingPage />);
  fireEvent.click(await screen.findByRole("tab", { name: "Recurring tasks" }));
}

describe("/playground/identities → Recurring tasks", () => {
  it("draws shared and personal cards with their schedules, and the rail", async () => {
    await openRecurring();
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    expect(within(shared).getByText("Monday digest")).toBeTruthy();
    expect(within(shared).getByText("Every Monday at 9:00")).toBeTruthy();
    const personal = screen.getByRole("region", { name: "Personal" });
    expect(within(personal).getByText("Runs when launched")).toBeTruthy();
    const rail = screen.getByRole("complementary", { name: "Schedule" });
    expect(within(within(rail).getByRole("region", { name: "Running now" })).getByText("Migration review")).toBeTruthy();
    expect(within(rail).getByText("Fri 14:00")).toBeTruthy();
  });

  it("opens the task view with subtasks and runs", async () => {
    await openRecurring();
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    fireEvent.click(within(shared).getByRole("button", { name: /Monday digest/ }));
    const view = await screen.findByRole("dialog", { name: "Monday digest" });
    expect(within(view).getByText("Write and post the digest")).toBeTruthy();
    fireEvent.click(within(view).getByRole("tab", { name: /Runs/ }));
    expect(within(view).getByText("Failed")).toBeTruthy();
  });

  it("opens the staged editor and shows the schedule fields once Repeat is on", async () => {
    await openRecurring();
    fireEvent.click(screen.getByRole("button", { name: "Recurring task" }));
    const editor = await screen.findByRole("dialog", { name: /New recurring task/i });
    expect(within(editor).queryByRole("tablist", { name: "How often" })).toBeNull();
    fireEvent.click(within(editor).getByRole("switch", { name: "Run on a schedule" }));
    expect(within(editor).getByRole("tablist", { name: "How often" })).toBeTruthy();
    expect(within(editor).getByRole("tablist", { name: "Day of the week" })).toBeTruthy();
  });
});
