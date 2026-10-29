// @vitest-environment jsdom
// The Agent teams mockup behind the Identities | Agent teams track switch: both sections, the
// running team in the rail, the team view (roster and lead, no saved tasks), Launch with a goal,
// and the staged editor.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IdentitiesStagingPage } from "../identities-staging-page";
import { HELD_BACK_MOCKS_VISIBLE } from "@/features/ui-staging/held-back";

afterEach(cleanup);

async function openTeams() {
  render(<IdentitiesStagingPage />);
  fireEvent.click(await screen.findByRole("tab", { name: "Agent teams" }));
}

// Reached through the Agent teams switch, which is held back from release (ui-staging/held-back.ts).
describe.skipIf(!HELD_BACK_MOCKS_VISIBLE)("/playground/identities → Teams", () => {
  it("draws shared and personal team cards and the running team in the rail", async () => {
    await openTeams();
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    expect(within(shared).getByText("Release")).toBeTruthy();
    const personal = screen.getByRole("region", { name: "Personal" });
    expect(within(personal).getByText("Coder ×1 · Comment writer ×1 · Code tester ×1")).toBeTruthy();
    const rail = screen.getByRole("complementary", { name: "Activity" });
    expect(within(rail).getByText("1/3")).toBeTruthy();
    expect(within(rail).getByText("Comment Writer")).toBeTruthy();
  });

  it("opens the team view with its members, its lead and no saved tasks", async () => {
    await openTeams();
    const personal = screen.getByRole("region", { name: "Personal" });
    fireEvent.click(within(personal).getByRole("button", { name: /Research/ }));
    const view = await screen.findByRole("dialog", { name: "Research" });
    expect(within(view).getByText("Editor")).toBeTruthy();
    expect(within(view).queryByRole("tab", { name: /Task templates/ })).toBeNull();
    expect(within(view).getAllByText("Writer").length).toBeGreaterThan(0);
  });

  it("launches a team with a goal", async () => {
    await openTeams();
    const personal = screen.getByRole("region", { name: "Personal" });
    fireEvent.click(within(personal).getAllByRole("button", { name: "Launch with a goal" })[0]);
    const dialog = await screen.findByRole("dialog", { name: /Launch Code cleanup/ });
    const launch = within(dialog).getByRole("button", { name: "Launch" }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Goal for the team"), { target: { value: "Tidy billing" } });
    expect(launch.disabled).toBe(false);
  });

  it("opens the staged editor from + Agent team", async () => {
    await openTeams();
    fireEvent.click(screen.getByRole("button", { name: "Agent team" }));
    expect(await screen.findByRole("dialog", { name: /New agent team/i })).toBeTruthy();
  });
});
