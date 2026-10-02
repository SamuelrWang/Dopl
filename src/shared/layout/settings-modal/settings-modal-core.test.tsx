// @vitest-environment jsdom
/**
 * 🔒 THE RAIL'S ROWS (Samuel, 2026-10-02): Workspaces · Agents · Devices · Configuration · Account
 * · Plans & Billing, one list filtered by `has`. Configuration is drawn only when a binding passes
 * `configurationPane` (the desktop); the web passes none and draws five rows. No Connect row.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SettingsModalCore, type SettingsSection } from "./settings-modal-core";

afterEach(cleanup);

function renderCore(withConfiguration: boolean, section: SettingsSection = "agents") {
  render(
    <SettingsModalCore
      open
      onOpenChange={() => {}}
      section={section}
      onSectionChange={() => {}}
      workspacesPane={<p>workspaces pane</p>}
      agentsPane={<p>agents pane</p>}
      devicesPane={<p>devices pane</p>}
      configurationPane={withConfiguration ? <p>configuration pane</p> : undefined}
      accountPane={<p>account pane</p>}
      billingPane={<p>billing pane</p>}
    />
  );
}

async function railLabels() {
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  return within(dialog)
    .getAllByRole("button")
    .map((b) => b.textContent)
    .filter((t) => t !== "Close");
}

describe("settings modal core rail", () => {
  it("draws six rows when a configuration pane is passed (desktop)", async () => {
    renderCore(true);
    expect(await railLabels()).toEqual([
      "Workspaces",
      "Agents",
      "Devices",
      "Configuration",
      "Account",
      "Plans & Billing",
    ]);
  });

  it("drops Configuration when no pane is passed (web), and has no Connect row", async () => {
    renderCore(false);
    expect(await railLabels()).toEqual([
      "Workspaces",
      "Agents",
      "Devices",
      "Account",
      "Plans & Billing",
    ]);
  });

  it("renders each section's own pane", async () => {
    renderCore(true, "devices");
    expect(await screen.findByText("devices pane")).toBeTruthy();
    expect(screen.queryByText("agents pane")).toBeNull();
  });
});
