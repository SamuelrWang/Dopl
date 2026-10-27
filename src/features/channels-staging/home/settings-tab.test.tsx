// @vitest-environment jsdom
/**
 * The staged Settings tab: the PRODUCT's channel and thread faces over local state, with /home's
 * capabilities (no Add members, no Delete channel) and destructive rows that confirm without
 * doing anything.
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useStagingAppBridge } from "@/features/ui-staging/staging-app-bridge";
import { techDebtFixture } from "../data/tech-debt-fixture";
import { CURRENT_USER_ID } from "../data/demo-imports";
import { StagingSettingsTab } from "./settings-tab";

afterEach(cleanup);

const fixture = techDebtFixture();

function rowNames(): string[] {
  return [...document.querySelectorAll("[data-settings-row]")].map(
    (row) => (row.querySelector(":scope > span:first-child") ?? row).textContent?.trim() ?? ""
  );
}

/** The playground bridge the frame installs: the launch record is main's, played in memory. */
function WithBridge({ children }: { children: ReactNode }) {
  return useStagingAppBridge() ? children : null;
}

async function channelTab() {
  render(
    <WithBridge>
      <StagingSettingsTab
        channel={fixture.channel}
        members={fixture.members}
        thread={null}
        currentUserId={CURRENT_USER_ID}
      />
    </WithBridge>
  );
  await screen.findByText("Runtime");
}

describe("the staged Settings tab", () => {
  it("draws the product's channel face: agent settings with Responder, then the channel", async () => {
    await channelTab();
    expect(screen.getByRole("heading", { name: "Agent Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Channel" })).toBeTruthy();
    const agent = within(screen.getByRole("region", { name: "Agent Settings" }));
    for (const name of [
      "Runtime",
      "Permissions",
      "Messaging",
      "Tool access",
      "Working folder",
      "Launch agents",
      "Direct agents",
      "Responder",
    ]) {
      expect(agent.getByText(name)).toBeTruthy();
    }
    const names = rowNames();
    // A shared channel (more than one member) also offers Use my tools.
    if ((fixture.channel.memberCount ?? 0) > 1) expect(names).toContain("Use my tools");
    // /home's capabilities: membership is fixed, and the viewer owns the channel (no Leave).
    for (const gone of ["Add members", "Delete channel", "Leave channel"]) {
      expect(names).not.toContain(gone);
    }
    expect(names).toContain("Make public");
  });

  it("changes a setting on local state and opens the Details readings", async () => {
    await channelTab();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const well = screen.getByRole("list", { name: "Permissions by runtime" });
    expect(within(well).getByText(/Claude · Accept edits/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Use default" })).toBeNull());
    expect(screen.getByText("~/Dopl")).toBeTruthy();
  });

  it("confirms Make public, then flips the staged visibility", async () => {
    await channelTab();
    fireEvent.click(screen.getByRole("button", { name: "Make public" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /public/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Make private" })).toBeTruthy());
  });

  it("draws the product's thread face: Mode and Delete thread", async () => {
    const thread = { ...fixture.threads[0], createdBy: CURRENT_USER_ID };
    render(
      <StagingSettingsTab
        channel={fixture.channel}
        members={fixture.members}
        thread={thread}
        currentUserId={CURRENT_USER_ID}
      />
    );
    expect(screen.getByRole("heading", { name: "Thread" })).toBeTruthy();
    expect(rowNames()).toEqual(["Mode", "Delete thread"]);
    expect(screen.queryByRole("heading", { name: "Agent Settings" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete thread" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Delete thread" })).toBeTruthy();
  });
});
