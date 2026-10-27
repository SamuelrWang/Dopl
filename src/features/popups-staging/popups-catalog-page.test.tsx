// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ToastHost } from "@/shared/ui/toast";
import { PopupsCatalogPage } from "./popups-catalog-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/** Each round lets a bridge answer schedule the next timer (latency, then the query's render). */
const tick = async (ms = 400) => {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }
};

function dialog(name: string) {
  return screen.getByRole("dialog", { name });
}

describe("/popups staging", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens every settings pane, popup and window without touching the network", async () => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as never;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <>
        <PopupsCatalogPage />
        <ToastHost />
      </>
    );
    await tick();
    const catalog = () => within(document.querySelector(".pps-catalog") as HTMLElement);

    // ── Settings: every row, opened on the header Profile pill's modal (`openStagingSettings`) ──
    const panes: Array<[string, string]> = [
      ["Workspaces", "Northwind"],
      ["Agents", "Claude Code"],
      ["Devices", "Daniel’s MacBook Pro"],
      ["Configuration", "Permissions"],
      ["Notifications", "Alerts on every computer you sign in on."],
      ["Account", "Display name"],
      ["Plans & Billing", "Plans and Billing"],
    ];
    for (const [row, marker] of panes) {
      fireEvent.click(catalog().getByText(row));
      await tick();
      const settings = dialog("Settings");
      expect(within(settings).getAllByText(marker).length).toBeGreaterThan(0);
    }
    // Rail switching inside the open modal, and a nested confirm.
    const settings = dialog("Settings");
    fireEvent.click(within(settings).getByRole("tab", { name: /Agents/ }));
    await tick();
    expect(within(settings).getAllByText("Sign-ins").length).toBeGreaterThan(0);
    fireEvent.click(within(settings).getByText("Connect an agent"));
    fireEvent.click(within(settings).getAllByText("Disconnect")[0]);
    await tick();
    expect(dialog("Disconnect Claude Code?")).toBeTruthy();
    fireEvent.click(within(dialog("Disconnect Claude Code?")).getByText("Cancel"));
    await tick();
    fireEvent.click(within(settings).getByRole("tab", { name: /Devices/ }));
    await tick();
    fireEvent.click(within(settings).getByText("Pair glasses"));
    expect(within(settings).getByLabelText("Pairing code")).toBeTruthy();
    fireEvent.click(within(settings).getByRole("tab", { name: /Account/ }));
    await tick();
    expect(within(settings).getByText("Billing history")).toBeTruthy();
    expect(within(settings).getByText("Delete account")).toBeTruthy();
    fireEvent.click(within(settings).getByText("Close"));
    await tick();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();

    fireEvent.click(catalog().getByText("Plans & Billing (free plan)"));
    await tick();
    expect(within(dialog("Settings")).getAllByText(/Upgrade to Pro/).length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();

    // ── /home header ──
    fireEvent.click(catalog().getByText("New channel"));
    await tick();
    expect(screen.getByLabelText("New channel name")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New channel name"), { target: { value: "launch" } });
    fireEvent.click(screen.getByText("Create"));
    await tick(800);
    await tick();
    expect(screen.getByText("Staging: created #launch")).toBeTruthy();
    expect(screen.queryByLabelText("New channel name")).toBeNull();

    // The catalog's button focuses the top bar's search pill, which opens its popup.
    fireEvent.click(catalog().getByText("Search popup"));
    await tick();
    const search = screen.getByLabelText("Search");
    expect(document.activeElement).toBe(search);
    expect(screen.getByRole("listbox", { name: "Search results" })).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    await tick();
    expect(screen.queryByRole("listbox", { name: "Search results" })).toBeNull();

    // ── Account rail ──
    fireEvent.click(catalog().getByText("New workspace (request access)"));
    await tick(600);
    expect(screen.getByText("Request Access")).toBeTruthy();
    fireEvent.click(screen.getByText("Request Access"));
    await tick(600);
    expect(screen.getByText("Requested")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();

    // ── Channel Info → People ──
    fireEvent.click(screen.getByText("Add person"));
    await tick();
    fireEvent.click(screen.getByText("Create link"));
    await tick(800);
    expect(screen.getAllByText(/usedopl\.com\/link\//).length).toBeGreaterThan(1);
    fireEvent.click(screen.getAllByText("Cancel")[0]);
    await tick();
    fireEvent.click(screen.getAllByText("Remove")[0]);
    await tick();
    expect(screen.getByText(/They lose access/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();

    // ── App-level ──
    fireEvent.click(catalog().getByText("Runtime sign-in prompt"));
    await tick();
    expect(dialog("Sign in to Grok")).toBeTruthy();
    fireEvent.click(screen.getByText("Not now"));
    await tick();
    fireEvent.click(catalog().getByText("Toast: actionable (button)"));
    await tick(50);
    expect(screen.getByText("Review")).toBeTruthy();

    // ── Windows: /channels staging's transcript and agent view as the bodies ──
    const win = () => within(document.querySelector(".pps-window") as HTMLElement);
    fireEvent.click(catalog().getByText("Thread window"));
    await tick();
    expect(win().getAllByRole("textbox", { name: "Message" }).length).toBeGreaterThan(0);
    expect(document.querySelector(".pps-window")?.textContent).not.toMatch(/not staged/);
    fireEvent.click(screen.getByText("Error"));
    await tick();
    expect(screen.getByText("Try again")).toBeTruthy();
    fireEvent.click(screen.getByText("Close window"));
    fireEvent.click(catalog().getByText("Agent window"));
    await tick();
    expect(document.querySelector('.pps-window aside[aria-label="Agent view"]')).toBeTruthy();
    expect(win().getByRole("textbox", { name: "Message your agent" })).toBeTruthy();
    // The "+" draws the New agent dialog (product `LaunchAgentDialog` on the staging store).
    fireEvent.click(win().getByLabelText("New agent"));
    await tick();
    expect(screen.getByRole("button", { name: "Close new agent" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close new agent" }));
    await tick();
    fireEvent.click(screen.getByText("Close window"));

    // ── Frame triggers (every staging page gets these from `StagingFrame`) ──
    const frameRail = within(document.querySelector('nav[aria-label="Account"]') as HTMLElement);
    fireEvent.click(frameRail.getByLabelText("New workspace"));
    await tick(600);
    // The rail's own gate reads the request the catalog already sent.
    expect(screen.getByText("Requested")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();
    const top = within(document.querySelector("main.page-float > div") as HTMLElement);
    fireEvent.click(top.getByRole("button", { name: /New channel/ }));
    await tick();
    expect(screen.getByLabelText("New channel name")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close new channel form" }));
    await tick();
    fireEvent.focus(top.getByLabelText("Search"));
    expect(screen.getByRole("listbox", { name: "Search results" })).toBeTruthy();
    fireEvent.keyDown(top.getByLabelText("Search"), { key: "Escape" });
    await tick();
    // The product pill reopens the modal on the pane it last showed.
    fireEvent.click(top.getByTitle("Profile"));
    await tick();
    expect(dialog("Settings")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();
    // A toast's action opens its window (the actionable consent toast's Review → agent window).
    fireEvent.click(catalog().getByText("Toast: actionable (button)"));
    await tick(100);
    fireEvent.click(screen.getAllByText("Review")[0]);
    await tick();
    expect(document.querySelector('.pps-window aside[aria-label="Agent view"]')).toBeTruthy();
    fireEvent.click(screen.getByText("Close window"));

    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);
});
