// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsPanel } from "./notifications-panel";
import {
  defaultNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsStore,
} from "../prefs";

afterEach(cleanup);

function fakeStore(save: NotificationPrefsStore["save"]): NotificationPrefsStore {
  return { load: async () => defaultNotificationPrefs(), save };
}

const sw = (name: string) => screen.getByRole("switch", { name });

describe("NotificationsPanel", () => {
  it("draws one switch per registry event, Approvals locked on", async () => {
    render(<NotificationsPanel store={fakeStore(async (p) => p)} />);
    await screen.findByRole("switch", { name: "Mentions and replies" });
    for (const name of ["Mentions and replies", "Decisions for you", "Direct messages"]) {
      expect(sw(name).getAttribute("aria-checked")).toBe("true");
      expect((sw(name) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(sw("Approvals").getAttribute("aria-checked")).toBe("true");
    expect((sw("Approvals") as HTMLButtonElement).disabled).toBe(true);
  });

  it("writes the whole record through the store and keeps what it answered", async () => {
    const save = vi.fn(async (p: NotificationPrefs) => p);
    render(<NotificationsPanel store={fakeStore(save)} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Direct messages" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].events.direct_message).toBe(false);
    expect(save.mock.calls[0][0].events.mention).toBe(true);
    await waitFor(() => expect(sw("Direct messages").getAttribute("aria-checked")).toBe("false"));
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
