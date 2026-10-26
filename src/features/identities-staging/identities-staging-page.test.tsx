// @vitest-environment jsdom
// The playground mounts the PRODUCT face over the staging data layer: cards from the store, the
// rail from the staged session feed, and a card opening the product view popup.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IdentitiesStagingPage } from "./identities-staging-page";

afterEach(cleanup);

describe("/playground/identities", () => {
  it("renders the product face on staged data", async () => {
    render(<IdentitiesStagingPage />);
    const shared = await screen.findByRole("region", { name: "Shared in this channel" });
    expect(within(shared).getByText("Release Captain")).toBeTruthy();
    const personal = screen.getByRole("region", { name: "Personal" });
    expect(within(personal).getByText("Coder")).toBeTruthy();
    const rail = screen.getByRole("complementary", { name: "Activity" });
    expect(within(rail).getByText("Identity Cards")).toBeTruthy();
  });

  it("opens the read-only view from a card", async () => {
    render(<IdentitiesStagingPage />);
    const shared = await screen.findByRole("region", { name: "Shared in this channel" });
    fireEvent.click(within(shared).getByRole("button", { name: /Release Captain/ }));
    const view = await screen.findByRole("dialog", { name: "Release Captain" });
    expect(within(view).getByRole("button", { name: "Edit" })).toBeTruthy();
  });
});
