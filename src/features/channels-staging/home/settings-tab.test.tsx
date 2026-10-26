// @vitest-environment jsdom
/**
 * The staged Settings tab (Samuel, 2026-10-24: "the settings tab is blank. We need to mirror
 * it in there"): every row the product's channel and thread faces draw, on local state, and
 * the destructive rows confirm without doing anything.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { techDebtFixture } from "../data/tech-debt-fixture";
import { CURRENT_USER_ID } from "../data/demo-imports";
import { StagingSettingsTab } from "./settings-tab";

afterEach(cleanup);

const fixture = techDebtFixture();

function rowNames(): string[] {
  return [...document.querySelectorAll("[data-settings-row]")].map(
    (row) => (row.querySelector(".uis-st-name") ?? row).textContent?.trim() ?? ""
  );
}

describe("the staged Settings tab", () => {
  it("mirrors the channel face: agent settings, responder and the channel actions", () => {
    render(
      <StagingSettingsTab
        channel={fixture.channel}
        members={fixture.members}
        thread={null}
        currentUserId={CURRENT_USER_ID}
      />
    );
    expect(screen.getByRole("heading", { name: "Agent Settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Channel" })).toBeTruthy();
    const names = rowNames();
    for (const name of [
      "Runtime",
      "Permissions",
      "Messaging",
      "Tool access",
      "Working folder",
      "Launch agents",
      "Direct agents",
      "Responder",
      "Add members",
      "Delete channel",
    ]) {
      expect(names).toContain(name);
    }
    // A shared channel (more than one member) also offers Use my tools.
    if ((fixture.channel.memberCount ?? 0) > 1) expect(names).toContain("Use my tools");
    // The staged viewer owns the channel, so, as in the product, there is no Leave row.
    expect(names).not.toContain("Leave channel");
  });

  it("changes a setting on local state and opens the Details readings", () => {
    render(
      <StagingSettingsTab
        channel={fixture.channel}
        members={fixture.members}
        thread={null}
        currentUserId={CURRENT_USER_ID}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const well = screen.getByRole("list", { name: "Permissions by runtime" });
    expect(within(well).getByText(/Claude Code · Auto/)).toBeTruthy();
  });

  it("confirms Delete channel without deleting anything", async () => {
    render(
      <StagingSettingsTab
        channel={fixture.channel}
        members={fixture.members}
        thread={null}
        currentUserId={CURRENT_USER_ID}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete channel/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete channel?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: /Delete channel/ })).toBeTruthy();
  });

  it("mirrors the thread face: Mode and Delete thread", () => {
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
  });
});
