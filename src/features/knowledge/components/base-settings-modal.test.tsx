// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KnowledgeBase } from "../types";
import { BaseSettingsModal } from "./base-settings-modal";

vi.mock("./base-settings-general", () => ({ BaseGeneralPane: () => <p>general pane</p> }));
vi.mock("./base-settings-folders", () => ({ FolderDescriptions: () => <p>folders pane</p> }));
vi.mock("./kb-sharing-section", () => ({ KbSharingSection: () => <p>sharing pane</p> }));
vi.mock("./kb-channel-grants-section", () => ({ KbChannelGrantsSection: () => null }));
vi.mock("./agent-write-toggle", () => ({ AgentWriteToggle: () => <p>agents pane</p> }));

afterEach(cleanup);

const BASE = { id: "kb-1", name: "Runbooks", slug: "runbooks", agentWriteEnabled: false } as KnowledgeBase;

function modal(open: boolean) {
  return (
    <BaseSettingsModal
      open={open}
      onOpenChange={() => {}}
      workspaceId="ws-1"
      workspaceSlug="acme"
      base={BASE}
      currentUserId="u-1"
      role="owner"
      folders={[]}
      routing={{ refreshServerData: () => {}, goToBase: () => {} }}
    />
  );
}

/** ModalShell mounts its card in an effect, so the rail is awaited. */
const selected = async () =>
  (await screen.findAllByRole("tab")).find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent;

describe("BaseSettingsModal", () => {
  it("opens on General every time, whichever pane it was closed on", async () => {
    const { rerender } = render(modal(true));
    expect(await selected()).toBe("General");

    fireEvent.click(screen.getByRole("tab", { name: "Agents" }));
    expect(await selected()).toBe("Agents");

    rerender(modal(false));
    rerender(modal(true));
    expect(await selected()).toBe("General");
  });

  it("offers Folders only when the base has folders", async () => {
    render(modal(true));
    await screen.findAllByRole("tab");
    expect(screen.queryByRole("tab", { name: "Folders" })).toBeNull();
  });
});
