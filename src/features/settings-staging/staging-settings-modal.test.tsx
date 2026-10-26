// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ToastHost } from "@/shared/ui/toast";
import { StagingSettingsModal } from "./staging-settings-modal";

const tick = async (ms = 400) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe("StagingSettingsModal", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("draws all seven rows and every pane on fake data, with no fetch", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <>
        <StagingSettingsModal open onClose={() => {}} section="workspaces" />
        <ToastHost />
      </>
    );
    await tick();
    const modal = within(screen.getByRole("dialog", { name: "Settings" }));
    const panes: Array<[RegExp, string]> = [
      [/Workspaces/, "Atlas Labs"],
      [/Agents/, "Cursor"],
      [/Devices/, "Studio Mac"],
      [/Configuration/, "Messaging"],
      [/Notifications/, "Notifications"],
      [/Account/, "Plan"],
      [/Plans & Billing/, "Manage billing"],
    ];
    for (const [row, marker] of panes) {
      fireEvent.click(modal.getByRole("tab", { name: row }));
      await tick();
      expect(modal.getAllByText(marker).length).toBeGreaterThan(0);
    }
    // Configuration's Ask / Auto / Full menu opens.
    fireEvent.click(modal.getByRole("tab", { name: /Configuration/ }));
    await tick();
    fireEvent.click(modal.getByLabelText("Permissions for agents you launch"));
    expect(screen.getAllByText("Full").length).toBeGreaterThan(0);
    // Account → Cancel plan confirm.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(modal.getByRole("tab", { name: /Account/ }));
    await tick();
    fireEvent.click(modal.getByText("Cancel plan"));
    await tick();
    expect(screen.getByRole("dialog", { name: "Cancel Pro?" })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
