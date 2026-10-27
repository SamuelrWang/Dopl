// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StagingFrame } from "./staging-frame";
import { useStagingPopups } from "./staging-popups-provider";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const tick = async (ms = 400) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

function OpensAgentWindow() {
  const popups = useStagingPopups();
  return (
    <button type="button" onClick={() => popups.open("agent-window")}>
      child opener
    </button>
  );
}

describe("StagingFrame popup triggers", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens every frame-level popup on any face, without fetching", async () => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as never;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <StagingFrame tab="knowledge">
        <OpensAgentWindow />
      </StagingFrame>
    );
    await tick();
    const top = within(document.querySelector(".lp-demo-top") as HTMLElement);

    fireEvent.click(top.getByRole("button", { name: /New channel/ }));
    await tick();
    expect(screen.getByLabelText("New channel name")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close new channel form" }));
    await tick();

    // The product search pill: focus opens the popup on the seeded recents, typing answers
    // from the story's fixtures, Escape clears and closes.
    const field = top.getByLabelText("Search");
    fireEvent.focus(field);
    expect(screen.getByRole("listbox", { name: "Search results" })).toBeTruthy();
    expect(screen.getByText("rollback")).toBeTruthy();
    fireEvent.change(field, { target: { value: "upload" } });
    await tick(600);
    expect(document.querySelector('[data-search-row="stg-art-uploads"]')).toBeTruthy();
    expect(document.querySelector('[data-search-row="stg-msg-9012"] mark')?.textContent).toBe("upload");
    fireEvent.keyDown(field, { key: "Escape" });
    await tick();
    expect(screen.queryByRole("listbox", { name: "Search results" })).toBeNull();
    expect((field as HTMLInputElement).value).toBe("");

    fireEvent.click(top.getByTitle("Profile"));
    await tick();
    const settings = screen.getByRole("dialog", { name: "Settings" });
    expect(within(settings).getAllByText("Display name").length).toBeGreaterThan(0);
    fireEvent.click(within(settings).getByRole("tab", { name: /Devices/ }));
    await tick();
    expect(within(settings).getAllByText("Daniel’s MacBook Pro").length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();

    fireEvent.click(screen.getByLabelText("New workspace"));
    await tick(600);
    expect(screen.getByText("Request Access")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await tick();

    fireEvent.click(screen.getByText("child opener"));
    await tick();
    expect(document.querySelector('.pps-window aside[aria-label="Agent view"]')).toBeTruthy();
    fireEvent.click(screen.getByText("Close window"));

    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);
});

/**
 * Samuel, 2026-10-22: the left-hand channel picker and the New channel button stay on
 * every face, as desktop /home keeps `<RelationshipList>` for all five tabs.
 */
describe("StagingFrame channel picker", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each(["overview", "channels", "knowledge", "identities", "ontology"] as const)(
    "draws the picker and the New channel button on %s",
    async (tab) => {
      vi.useFakeTimers();
      globalThis.ResizeObserver ??= class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as never;
      render(<StagingFrame tab={tab}>{null}</StagingFrame>);
      await tick();

      const column = document.querySelector(".lp-demo-sw") as HTMLElement;
      expect(column).toBeTruthy();
      // Real rows, not just the width placeholder.
      expect(within(column).getAllByRole("link").length).toBeGreaterThan(0);
      // Heads the column, at the column's own width (`.lp-demo-top-cell`).
      const top = within(document.querySelector(".lp-demo-top") as HTMLElement);
      expect(top.getByRole("button", { name: /New channel/ })).toBeTruthy();
    },
    20_000
  );

  it("takes a page's own column instead, and can be turned off", async () => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as never;
    const { rerender } = render(
      <StagingFrame tab="channels" channelColumn={<div data-testid="own-column" />}>
        {null}
      </StagingFrame>
    );
    await tick();
    expect(screen.getByTestId("own-column")).toBeTruthy();
    expect(document.querySelector(".lp-demo-sw")).toBeNull();

    rerender(
      <StagingFrame tab="channels" showChannels={false}>
        {null}
      </StagingFrame>
    );
    await tick();
    expect(document.querySelector(".lp-demo-sw")).toBeNull();
  }, 20_000);
});
