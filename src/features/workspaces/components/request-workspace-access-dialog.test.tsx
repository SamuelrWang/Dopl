// @vitest-environment jsdom
/**
 * The gated "+ new workspace" popup (Samuel, 2026-10-15). Shared by the rail's create
 * tile and the workspace switcher's "Create workspace" item.
 *   1. Copy + centered "Request Access" button.
 *   2. A press POSTs and the button turns "Requested".
 *   3. A user who already asked sees "Requested" on open.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-client", () => ({ apiRequest }));

import { RequestWorkspaceAccessDialog } from "./request-workspace-access-dialog";

beforeEach(() => {
  apiRequest.mockReset();
});
afterEach(() => cleanup());

describe("RequestWorkspaceAccessDialog", () => {
  it("shows the invite-only copy and records a request on press", async () => {
    apiRequest.mockImplementation(async (_url: string, opts?: { method?: string }) =>
      opts?.method === "POST" ? { requested: true } : { requested: false }
    );
    render(<RequestWorkspaceAccessDialog open onOpenChange={() => {}} />);

    // ModalShell mounts on the next frame, so find, not get.
    expect(
      await screen.findByText(/Team workspaces are invite-only for now\. Request access and we'll let you know when you're in!/)
    ).toBeTruthy();
    const button = await screen.findByRole("button", { name: "Request Access" });
    fireEvent.click(button);

    await screen.findByRole("button", { name: "Requested" });
    expect(apiRequest).toHaveBeenCalledWith("/api/user/workspace-access-request", {
      method: "POST",
    });
  });

  it("opens in the requested state for a user who already asked", async () => {
    apiRequest.mockResolvedValue({ requested: true });
    render(<RequestWorkspaceAccessDialog open onOpenChange={() => {}} />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Requested" }) as HTMLButtonElement).disabled
      ).toBe(true)
    );
  });

  it("uses no em dash in its copy", async () => {
    apiRequest.mockResolvedValue({ requested: false });
    const { baseElement } = render(
      <RequestWorkspaceAccessDialog open onOpenChange={() => {}} />
    );
    await screen.findByRole("button", { name: "Request Access" });
    expect(baseElement.textContent ?? "").not.toContain("—");
  });
});
