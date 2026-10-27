// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StagingChannelsPage } from "../staging-channels-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
  unobserve() {}
} as never;
Element.prototype.scrollIntoView ??= () => {};

describe("Agents tab: the agent-teams mockup", () => {
  it("shows Launch team and the launched Code cleanup group", async () => {
    render(<StagingChannelsPage />);
    const agentsTab = await waitFor(() => {
      const tab = screen.getAllByRole("tab").find((t) => (t.textContent ?? "").startsWith("Agents"));
      if (!tab) throw new Error("no Agents tab");
      return tab;
    });
    fireEvent.click(agentsTab);
    await screen.findByRole("button", { name: /Launch team/ });
    expect(await screen.findByText("Code cleanup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Launch team/ }));
    expect(await screen.findByRole("menu", { name: "Agent teams" })).toBeTruthy();
  }, 30_000);
});
