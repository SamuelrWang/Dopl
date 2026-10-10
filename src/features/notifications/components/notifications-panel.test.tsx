// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsPanel } from "./notifications-panel";
import {
  defaultNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsStore,
} from "../prefs";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_IDS,
  VISIBLE_NOTIFICATION_EVENTS,
} from "../registry";

afterEach(cleanup);

function fakeStore(save: NotificationPrefsStore["save"]): NotificationPrefsStore {
  return { load: async () => defaultNotificationPrefs(), save };
}

const sw = (name: string) => screen.getByRole("switch", { name });

describe("NotificationsPanel", () => {
  it("draws one switch per WIRED event only, Approvals locked on", async () => {
    render(<NotificationsPanel store={fakeStore(async (p) => p)} />);
    await screen.findByRole("switch", { name: "Mentions and replies" });

    // One row per wired event, and NOT one per registered id.
    expect(screen.getAllByRole("switch")).toHaveLength(VISIBLE_NOTIFICATION_EVENTS.length);
    for (const e of VISIBLE_NOTIFICATION_EVENTS) {
      expect(sw(e.label).getAttribute("aria-checked")).toBe(String(e.defaultOn !== false));
      expect((sw(e.label) as HTMLButtonElement).disabled).toBe(Boolean(e.locked));
    }

    // ⚠ An event the registry NAMES but nothing raises must draw no control at all: a switch
    // that does nothing is a lie. These are registered and unwired today.
    for (const e of NOTIFICATION_EVENTS.filter((x) => !x.wired)) {
      expect(screen.queryByRole("switch", { name: e.label })).toBeNull();
    }
    expect(sw("Approvals").getAttribute("aria-checked")).toBe("true");
    expect((sw("Approvals") as HTMLButtonElement).disabled).toBe(true);
  });

  it("writes the whole record through the store and keeps what it answered", async () => {
    const save = vi.fn(async (p: NotificationPrefs) => p);
    render(<NotificationsPanel store={fakeStore(save)} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Mentions and replies" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const written = save.mock.calls[0][0];
    expect(written.events.mention).toBe(false);
    // The WHOLE record goes over, every registered id, not just the rows on screen.
    expect(Object.keys(written.events).sort()).toEqual([...NOTIFICATION_EVENT_IDS].sort());
    await waitFor(() =>
      expect(sw("Mentions and replies").getAttribute("aria-checked")).toBe("false")
    );
  });

  it("shows a ruled-off event as off, and can turn it back on", async () => {
    const save = vi.fn(async (p: NotificationPrefs) => p);
    render(<NotificationsPanel store={fakeStore(save)} />);
    // DMs are ruled off (Samuel, 2026-10-09) but keep a switch, so he can change his mind.
    const dm = await screen.findByRole("switch", { name: "Direct messages" });
    expect(dm.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(dm);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].events.direct_message).toBe(true);
  });

  it("reverts a switch the store refused", async () => {
    render(<NotificationsPanel store={fakeStore(async () => null)} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Decisions for you" }));
    await waitFor(() =>
      expect((sw("Decisions for you") as HTMLButtonElement).disabled).toBe(false)
    );
    expect(sw("Decisions for you").getAttribute("aria-checked")).toBe("true");
  });

  it("says so when the record cannot be read", async () => {
    const store: NotificationPrefsStore = {
      load: async () => {
        throw new Error("down");
      },
      save: async (p) => p,
    };
    render(<NotificationsPanel store={store} />);
    expect(await screen.findByText("Could not load your settings.")).toBeTruthy();
  });
});
