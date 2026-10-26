// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StagingChannelsPage } from "./staging-channels-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const text = () => document.body.textContent ?? "";
const row = (name: string) => screen.getByRole("button", { name });
/** Buttons the reader sees: the product elements the demo re-faces are hidden (`demo-swap.ts`). */
const visible = (name: string) =>
  screen.getAllByRole("button", { name }).filter((b) => !b.closest("[data-lp-swapped]"));
const agentView = () => document.querySelector('aside[aria-label="Agent view"]');

describe("/channels staging", () => {
  it("clicks through channels, a thread and an agent without fetching", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never;
    Element.prototype.scrollIntoView ??= () => {};
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<StagingChannelsPage />);

    // The demo's channel, fully revealed: last scripted line and every thread card.
    await waitFor(() => expect(text()).toContain("straight in. it's test only"));
    expect(text()).toContain("Session teardown leaks");
    expect(visible("Open thread").length).toBe(3);

    // Every channel in the column switches the face.
    fireEvent.click(row("flaky-tests"));
    await waitFor(() => expect(text()).toContain("Quarantine list"));
    fireEvent.click(row("deploys"));
    await waitFor(() => expect(text()).toContain("Release 1.42.0"));
    fireEvent.click(row("api-v2-migration"));
    await waitFor(() => expect(text()).toContain("Pagination cursor change"));
    // Earlier is collapsed by default; its heading opens it.
    fireEvent.click(screen.getByRole("button", { name: /Earlier/i }));
    fireEvent.click(row("design-review"));
    await waitFor(() => expect(text()).toContain("Settings modal spacing"));
    fireEvent.click(row("Mira Castellanos"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy());

    // Back to the demo channel: open a thread, then leave through the crumb.
    fireEvent.click(row("tech-debt"));
    await waitFor(() => expect(visible("Open thread").length).toBe(3));
    fireEvent.click(visible("Open thread")[1]);
    await waitFor(() => expect(text()).toContain("Teardown Order Fix"));
    expect(text()).not.toContain("straight in. it's test only");
    // The breadcrumb's channel crumb (a real <button>; the column row is a role=button div).
    const crumb = screen
      .getAllByRole("button", { name: "tech-debt" })
      .find((b) => b.tagName === "BUTTON");
    fireEvent.click(crumb!);
    await waitFor(() => expect(text()).toContain("straight in. it's test only"));

    // The Agents tab, then an agent card's Open: the agent view slides in.
    const agentsTab = screen
      .getAllByRole("tab")
      .find((b) => (b.textContent ?? "").trim().startsWith("Agents"));
    expect(agentsTab).toBeTruthy();
    fireEvent.click(agentsTab!);
    await waitFor(() => expect(visible("Open").length).toBeGreaterThan(0));
    expect(agentView()?.hasAttribute("inert")).toBe(true);
    fireEvent.click(visible("Open")[0]);
    await waitFor(() => expect(agentView()?.hasAttribute("inert")).toBe(false));
    fireEvent.click(visible("Close agent view")[0]);
    await waitFor(() => expect(agentView()?.hasAttribute("inert")).toBe(true));

    // The composer posts in memory (the product's send is a network write).
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "staging line from the test" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(text()).toContain("staging line from the test"));

    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);

  it("opens the composer's popups, Add person and New channel without fetching", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<StagingChannelsPage />);
    await waitFor(() => expect(text()).toContain("straight in. it's test only"));
    const dialogs = () => document.querySelectorAll('[role="dialog"]').length;

    fireEvent.click(visible("Mention")[0]);
    await waitFor(() => expect(document.querySelector('[aria-label="Mention a member"]')).toBeTruthy());

    fireEvent.click(visible("New thread")[0]);
    await waitFor(() => expect(dialogs()).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Close new thread form" }));
    await waitFor(() => expect(dialogs()).toBe(0));

    fireEvent.click(visible("New Agent")[0]);
    await waitFor(() => expect(dialogs()).toBeGreaterThan(0));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    fireEvent.click(visible("Add person")[0]);
    await waitFor(() => expect(screen.getAllByText("Access level").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() => expect(text()).toMatch(/usedopl\.com\/link\/stg/));

    // The frame's "New channel" pill opens the shared popups-staging dialog; its create lands here.
    fireEvent.click(screen.getByRole("button", { name: /New channel/ }));
    const name = await screen.findByLabelText("New channel name");
    fireEvent.change(name, { target: { value: "launch-week" } });
    fireEvent.click(visible("Create").at(-1)!);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "launch-week" }).length).toBeGreaterThan(0));

    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);
});
