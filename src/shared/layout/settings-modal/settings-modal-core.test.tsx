// @vitest-environment jsdom
/**
 * The rail's tabs: one list filtered by `has`. Configuration and Notifications are drawn only when
 * a binding passes their pane (the desktop); the web passes neither and draws five.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SettingsModalCore, type SettingsSection } from "./settings-modal-core";

afterEach(cleanup);

function renderCore(
  withConfiguration: boolean,
  section: SettingsSection = "agents",
  withNotifications = false
) {
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
      notificationsPane={withNotifications ? <p>notifications pane</p> : undefined}
      accountPane={<p>account pane</p>}
      billingPane={<p>billing pane</p>}
    />
  );
}

async function railLabels() {
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  return within(dialog)
    .getAllByRole("tab")
    .map((tab) => tab.textContent);
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

  it("draws Notifications after Configuration when its pane is passed", async () => {
    renderCore(true, "notifications", true);
    expect(await railLabels()).toEqual([
      "Workspaces",
      "Agents",
      "Devices",
      "Configuration",
      "Notifications",
      "Account",
      "Plans & Billing",
    ]);
    expect(screen.getByText("notifications pane")).toBeTruthy();
  });

  it("renders no notifications pane under a section with no pane", async () => {
    renderCore(true, "notifications", false);
    await screen.findByRole("dialog", { name: "Settings" });
    expect(screen.queryByText("notifications pane")).toBeNull();
  });

  it("marks only the open section selected, by the underline and not a raised face", async () => {
    renderCore(true, "devices");
    const tabs = within(await screen.findByRole("tablist", { name: "Settings sections" })).getAllByRole("tab");
    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected.map((tab) => tab.textContent)).toEqual(["Devices"]);
    for (const tab of tabs) {
      expect(tab.className).not.toMatch(/nav-chip|raised-tab/);
      expect(tab.querySelector("svg")).toBeNull();
    }
    expect(selected[0].querySelector("[data-tab-underline]")).not.toBeNull();
  });

  it("renders each section's own pane", async () => {
    renderCore(true, "devices");
    expect(await screen.findByText("devices pane")).toBeTruthy();
    expect(screen.queryByText("agents pane")).toBeNull();
  });
});
