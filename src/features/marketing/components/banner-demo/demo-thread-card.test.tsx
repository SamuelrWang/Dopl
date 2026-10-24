// @vitest-environment jsdom
/**
 * The demo's redesigned agent thread card (`demo-thread-card.tsx`): it lands inside each
 * thread card's own row, carries the same facts as the product card, and its "Open thread"
 * is the control the scripted cursor presses.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { DemoScene } from "./demo-scene";
import { stepIndex } from "./demo-steps";
import { THREADS } from "./demo-data";

afterEach(cleanup);

const AFTER_THREADS = stepIndex("cursor-to-thread");

async function mountCards(onOpenThread = () => {}) {
  const view = render(
    <DemoScene step={AFTER_THREADS} onOpenThread={onOpenThread} />
  );
  await waitFor(() =>
    expect(view.container.querySelectorAll(".lp-demo-tc")).toHaveLength(3)
  );
  return view;
}

describe("the demo thread card", () => {
  it("renders one card per thread, inside that thread's own row", async () => {
    const { container } = await mountCards();
    for (const card of container.querySelectorAll(".lp-demo-tc")) {
      const row = card.closest("[data-message-id]");
      expect(row).not.toBeNull();
      // Beside the product shell it replaces, never in another row.
      expect(row?.querySelector(".ring-surface-cta")).not.toBeNull();
    }
  });

  it("carries each thread's title and the agent that opened it", async () => {
    const { container } = await mountCards();
    const text = [...container.querySelectorAll(".lp-demo-tc")].map(
      (c) => c.textContent ?? ""
    );
    for (const t of THREADS) {
      expect(text.some((s) => s.includes(t.title)), t.title).toBe(true);
    }
    expect(text.join(" ")).toContain("Debt Triage");
    expect(text.join(" ")).toContain("Cleanup Planner");
    expect(text.join(" ")).toContain("Backlog Scout");
    expect(text.join(" ")).toContain("Agent thread");
  });

  it("opens the thread from its own Open thread button", async () => {
    const onOpen = vi.fn();
    const { container } = await mountCards(onOpen);
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>(".lp-demo-tc button"),
    ].find((b) => b.textContent === "Open thread");
    expect(button).toBeDefined();
    fireEvent.click(button!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
