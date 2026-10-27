import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_ID, installBridge } from "#/test-utils/bridge";
import { ToastHost } from "@/shared/ui/toast";
import { renderHome } from "./home-test-harness";
import { CHANNEL_ID } from "./home-test-ids";
import { T_HOME, identityRoutes, openIdentities } from "./identity-test-fixtures";

/**
 * /home → Identities → LAUNCH FROM THE CARD, mounted through `HomePage` like
 * `identity-authoring.test.tsx` (the channel and workspace come off the page).
 *
 * 🔒 THE LOAD-BEARING ASSERTION IS ON THE LAUNCH PAYLOAD. A launch that carried
 * an override, a runtime or a colour would render identically (a spinner and a
 * toast) and would not be an as-is launch — and `workspaceId` decides whether
 * main can resolve the identity at all (`main/identity-resolve.js` reads
 * `(workspace_id, id)`).
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation(identityRoutes);
  installBridge({ apiRequest });
});

describe("launch from the card", () => {
  const launch = vi.fn();
  const rename = vi.fn();
  const describeOp = vi.fn();

  /** The desktop, with the three ops this lane uses. ⚠ `installBridge` REPLACES
   *  the surface, so `apiRequest` is re-supplied here. */
  function installDesktop(
    outcome: { ok: boolean; agentId?: string; reason?: string; detail?: string } = {
      ok: true,
      agentId: "ag-1",
    }
  ) {
    launch.mockReset().mockResolvedValue(outcome);
    rename.mockReset().mockResolvedValue({ ok: true });
    describeOp.mockReset().mockResolvedValue({ ok: true });
    installBridge({
      apiRequest,
      sessions: { launch, rename, describe: describeOp },
    });
  }

  /** Press Launch on the PERSONAL card. */
  async function pressLaunch(): Promise<void> {
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
  }

  it("🔒 launches the identity AS-IS, into the selected channel", async () => {
    installDesktop();
    await pressLaunch();

    await waitFor(() => expect(launch).toHaveBeenCalled());
    // 🔒 EXACT EQUALITY. An extra key here is a per-spawn DECISION the operator
    // never made, and `threadId: null` is a CHANNEL-level agent rather than a
    // missing value.
    expect(launch.mock.calls[0][0]).toEqual({
      channelId: CHANNEL_ID,
      threadId: null,
      // 🔒 THE IDENTITY'S OWN WORKSPACE, never the channel's container: main
      // resolves the row by `(workspace_id, id)`, so the container id would 404
      // every personal identity.
      workspaceId: WORKSPACE_ID,
      channelName: expect.any(String),
      threadTitle: null,
      // ⚠ THE CHANNEL'S OWN FLAG, FORWARDED UNTOUCHED — the harness's row is a
      // direct one, and main reads this to decide how the session addresses the
      // room.
      direct: true,
      identityId: T_HOME.id,
    });
  });

  it("names the new agent after the identity, and says so", async () => {
    installDesktop();
    // ⚠ THE HOST IS MOUNTED BY HAND — `renderHome` renders the PAGE, and the
    // toast host lives at the app root (`app.tsx`), above every route.
    render(<ToastHost />);
    await pressLaunch();

    // ⚠ KEYED BY MAIN'S OWN ADDRESS — neither write can happen until the spawn
    // has answered with one.
    await waitFor(() => expect(rename).toHaveBeenCalledWith("ag-1", T_HOME.name));
    expect(describeOp).toHaveBeenCalledWith("ag-1", "Reads the data room");
    // The popup Samuel asked for, in his own words.
    await screen.findByText(/"Fundraise analyst" launched into/);
  });

  it("🔒 says a refusal ON THE ROW — a control that silently does nothing is the bug", async () => {
    installDesktop({ ok: false, reason: "cap" });
    await pressLaunch();

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Session limit");
    expect(rename).not.toHaveBeenCalled();
  });

  it("says main's own `no-model` sentence, not the generic line", async () => {
    installDesktop({
      ok: false,
      reason: "no-model",
      detail: "gpt-x is not offered here. Offered: claude-sonnet-5",
    });
    await pressLaunch();

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe(
      "gpt-x is not offered here. Offered: claude-sonnet-5"
    );
  });

  it("offers no launch control on a SHARED row — that list is the container's", async () => {
    installDesktop();
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");
    // ⚠ Scoped to the SHARED region: the control lives on every Personal card,
    // so a document-wide query would find those and prove nothing about this one.
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    expect(within(shared).queryByRole("button", { name: "Launch" })).toBeNull();
  });
});
