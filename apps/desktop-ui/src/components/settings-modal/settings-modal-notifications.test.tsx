import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { installBridge } from "#/test-utils/bridge";
import {
  apiRequest,
  calls,
  defaultBridge,
  gear,
  ok,
  openExternal,
  renderShell,
} from "./_settings-harness";

/**
 * 🔒 THE SETTINGS MODAL'S NOTIFICATIONS PANE (2026-10-09) — split out of `settings-modal.test.tsx`
 * when that file hit its `max-lines` cap.
 *
 * THE RECORD IS THE OPERATOR'S ACCOUNT, NOT THIS MAC (Samuel's ruling). What that buys, and what
 * these cases pin:
 * - the row is ALWAYS drawn, right after Configuration — it no longer waits on a desktop
 *   capability, because there is no local store left to detect;
 * - a switch writes `/api/user/notification-preferences`, so it is honored on every computer;
 * - NO VALUE CROSSES THE DESKTOP BRIDGE. `notifications.refresh` carries nothing: it only tells
 *   main to re-read its banner-gate cache, and it is best-effort — a main without the op (or on
 *   the web, where there is no main) must still SAVE.
 * - `approval` cannot be switched off: every approval banner carries the one button that answers
 *   it, so silencing it would leave the ask unanswerable from that machine.
 */

const PREFS_PATH = "/api/user/notification-preferences";

/** Answers the prefs route: GET the defaults (an empty body reads as all-on), PUT echoes. */
function withPrefsRoute() {
  apiRequest.mockImplementation((p: string, o?: BridgeRequestOpts) =>
    p === PREFS_PATH
      ? Promise.resolve(ok(o?.method === "PUT" ? { prefs: (o.body as { prefs?: unknown })?.prefs } : {}))
      : defaultBridge(p)
  );
}

/** The PUT the panel sent, if any. */
const putCall = () => calls().find((c) => c.path === PREFS_PATH && c.opts.method === "PUT");

describe("settings modal › notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockImplementation((path: string) => defaultBridge(path));
  });

  it("shows Notifications after Configuration, and writes a switch to the account", async () => {
    const refresh = vi.fn(() => Promise.resolve({ ok: true }));
    installBridge({
      apiRequest,
      openExternal,
      appOrigin: "https://www.usedopl.com",
      notifications: { refresh },
    });
    withPrefsRoute();
    renderShell();
    await screen.findByText("page body");
    fireEvent.click(gear());

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    const labels = within(dialog).getAllByRole("tab").map((tab) => tab.textContent);
    expect(labels.indexOf("Notifications")).toBe(labels.indexOf("Configuration") + 1);

    fireEvent.click(within(dialog).getByRole("tab", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Mentions and replies" }));

    await waitFor(() =>
      expect(putCall()?.opts.body).toMatchObject({ prefs: { events: { mention: false } } })
    );
    // The save landed on the account; main is then told to re-read its gate cache.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("draws Notifications, saves, and locks approvals with no notifications bridge", async () => {
    installBridge({ apiRequest, openExternal, appOrigin: "https://www.usedopl.com" });
    withPrefsRoute();
    renderShell();
    await screen.findByText("page body");
    fireEvent.click(gear());

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    // Account-backed: the row does NOT depend on a desktop capability any more.
    fireEvent.click(within(dialog).getByRole("tab", { name: "Notifications" }));
    // Approvals carry the only button that answers them, so the row cannot be switched off.
    const approvals = await screen.findByRole("switch", { name: "Approvals" });
    expect(approvals).toBeDisabled();
    expect(approvals).toBeChecked();

    fireEvent.click(await screen.findByRole("switch", { name: "Direct messages" }));
    await waitFor(() => expect(putCall()).toBeTruthy());
  });
});
