// @vitest-environment jsdom
// The playground mounts the PRODUCT face over the staging data layer: cards from the store, the
// rail from the staged session feed, the account preview from its seed, and a card opening the
// product view popup.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IdentitiesStagingPage } from "./identities-staging-page";

afterEach(cleanup);

describe("/playground/identities", () => {
  it("renders the product face on staged data", async () => {
    render(<IdentitiesStagingPage />);
    const shared = await screen.findByRole("region", { name: "Shared" });
    expect(within(shared).getByText("Release Captain")).toBeTruthy();
    const personal = screen.getByRole("region", { name: "Personal" });
    expect(within(personal).getByText("Coder")).toBeTruthy();
    const rail = screen.getByRole("complementary", { name: "Activity" });
    expect(within(rail).getByText("Identity Cards")).toBeTruthy();
  });

  it("draws the preview: reach, scope, re-auth, never used", async () => {
    render(<IdentitiesStagingPage />);
    const shared = await screen.findByRole("region", { name: "Shared" });
    expect(within(shared).getByText("Shared in #tech-debt and #releases")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Which channels to show" }).textContent).toContain(
      "All channels"
    );
    expect(screen.getByText("Codex needs re-auth")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix" })).toBeTruthy();
    expect(screen.getAllByText("Not used yet").length).toBeGreaterThan(0);
  });

  it("opens the read-only view with its Tools and rules tab", async () => {
    render(<IdentitiesStagingPage />);
    const shared = await screen.findByRole("region", { name: "Shared" });
    fireEvent.click(within(shared).getByRole("button", { name: /Release Captain/ }));
    const view = await screen.findByRole("dialog", { name: "Release Captain" });
    expect(within(view).getByRole("button", { name: "Edit" })).toBeTruthy();
    fireEvent.click(within(view).getByRole("tab", { name: "Tools and rules" }));
    expect(within(view).getByText("Never cut a release on a Friday")).toBeTruthy();
    fireEvent.click(within(view).getByRole("tab", { name: "Activity" }));
    expect(within(view).getByText("Waited for you")).toBeTruthy();
  });
});
