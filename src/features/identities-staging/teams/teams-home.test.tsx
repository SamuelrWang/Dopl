// @vitest-environment jsdom
// The Teams mockup behind the Identities | Teams switch: both sections, the running team in the
// rail, the team view's two tabs, and the staged editor.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IdentitiesStagingPage } from "../identities-staging-page";

afterEach(cleanup);

async function openTeams() {
  render(<IdentitiesStagingPage />);
  fireEvent.click(await screen.findByRole("tab", { name: "Teams" }));
}

describe("/playground/identities → Teams", () => {
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

  it("opens the team view with members and ordered steps", async () => {
    await openTeams();
    const personal = screen.getByRole("region", { name: "Personal" });
    fireEvent.click(within(personal).getByRole("button", { name: /Code cleanup/ }));
    const view = await screen.findByRole("dialog", { name: "Code cleanup" });
    expect(within(view).getByText("Comment writer")).toBeTruthy();
    fireEvent.click(within(view).getByRole("tab", { name: /Task templates/ }));
    expect(within(view).getByText("Prove nothing broke")).toBeTruthy();
  });

  it("opens the staged editor from + Agent team", async () => {
    await openTeams();
    fireEvent.click(screen.getByRole("button", { name: "Agent team" }));
    expect(await screen.findByRole("dialog", { name: /New agent team/i })).toBeTruthy();
  });
});
