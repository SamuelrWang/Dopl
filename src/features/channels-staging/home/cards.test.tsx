// @vitest-environment jsdom
/**
 * The staged channel page draws the PRODUCT's thread card, decision card and agent badge (their
 * own suites live beside them in `channels/components`); this pins that no staged copy or face
 * swap stands in for them any more.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { StagingChannelsPage } from "../staging-channels-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

async function mountPage() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  render(<StagingChannelsPage />);
  await waitFor(() => expect(document.querySelector("[data-display-id]")).toBeTruthy(), {
    timeout: 8000,
  });
}

describe("/channels staging mounts the product faces", () => {
  it("draws the decision as the product card, answerable in memory", async () => {
    await mountPage();
    const card = document.querySelector("[data-display-id]") as HTMLElement;
    expect(card.textContent).toContain("Needs your decision");
    expect(card.textContent).toMatch(/Ship the teardown fix behind a flag/);
    expect(card.querySelectorAll("button[data-option-index]").length).toBe(3);
    expect(card.textContent).not.toMatch(/Option [A-C]/);
  }, 20_000);

  it("draws thread cards with their agents, and agent badges without the word agent", async () => {
    await mountPage();
    expect(document.querySelector(".uis-tc, .uis-dc, .uis-ap")).toBeNull();
    expect(document.body.textContent).toMatch(/agents? in this thread/);
    const badge = document.querySelector("[data-attribution-pill][data-agent-id]") as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.querySelector("[data-identity-face]")).toBeTruthy();
    expect(badge.textContent).not.toMatch(/\bagent\b/);
  }, 20_000);
});
