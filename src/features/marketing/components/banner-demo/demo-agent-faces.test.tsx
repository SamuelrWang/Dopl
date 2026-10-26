// @vitest-environment jsdom
/**
 * The demo draws the PRODUCT's faces: the info column's agent cards and thread-info rows, the agent
 * view and its received / posted cards. The card's Open is the control the scripted cursor presses.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { DemoScene } from "./demo-scene";
import { stepIndex } from "./demo-steps";
import { OPEN_THREAD } from "./demo-data";

afterEach(cleanup);

const STEP = stepIndex("dm-agent-1");

function openAgentsTab(container: HTMLElement) {
  const tab = [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").trim().startsWith("Agents")
  );
  expect(tab).toBeDefined();
  fireEvent.click(tab!);
}

const slide = (container: HTMLElement) => container.querySelector(".channel-info-slide")!;
const faces = (container: HTMLElement) => slide(container).querySelectorAll("[data-identity-face]");

describe("the demo Agents-tab card", () => {
  it("is the product's own card, with its name, context and spend", async () => {
    const onOpen = vi.fn();
    const { container } = render(
      <DemoScene step={STEP} thread={OPEN_THREAD} onOpenAgent={onOpen} />
    );
    openAgentsTab(container);
    await waitFor(() => expect(slide(container).textContent).toContain("Context tokens"));

    const text = slide(container).textContent ?? "";
    expect(text).toContain("Teardown Order Fix");
    expect(text).toContain("tokens spent");

    const open = [...slide(container).querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Open"
    );
    fireEvent.click(open!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("the demo received / posted cards", () => {
  it("are the product's cards, with a header row", () => {
    const { container } = render(
      <DemoScene step={STEP} thread={OPEN_THREAD} agentOpen />
    );
    const view = container.querySelector('aside[aria-label="Agent view"]')!;
    const labels = [...view.querySelectorAll("[data-stream-card-label]")].map((l) => l.textContent);
    expect(labels).toContain("Received from @cleanup-planner");
    expect(labels.some((l) => l?.startsWith("Posted to "))).toBe(true);
    const received = view.querySelector("[data-stream-inbound]");
    expect(received?.textContent).toContain("session/teardown.ts");
    expect(view.textContent).toContain("On it.");
  });
});

describe("mixed ownership and identity faces", () => {
  it("the thread's coders belong to three people, and the Agents tab says so", async () => {
    const { container } = render(<DemoScene step={STEP} thread={OPEN_THREAD} />);
    openAgentsTab(container);
    await waitFor(() => expect(slide(container).textContent).toContain("Context tokens"));
    expect(faces(container)).toHaveLength(3);
    const text = slide(container).textContent ?? "";
    expect(text).toContain("End Notice Check");
    expect(text).toContain("Grace Okafor's agent");
    expect(text).toContain("Anthony Reyes's agent");
    // Each runtime badge is the agent's own, not one logo for everybody.
    const logos = new Set(
      [...slide(container).querySelectorAll("[data-identity-face] img")]
        .map((i) => i.getAttribute("src"))
        .filter((s) => s && !s.startsWith("/img/avatars/"))
    );
    expect(logos.size).toBeGreaterThan(1);
  });

  it("the thread Info tab's agent rows wear identity avatars, not the bot glyph", async () => {
    const { container } = render(<DemoScene step={STEP} thread={OPEN_THREAD} />);
    await waitFor(() => expect(faces(container)).toHaveLength(3));
    expect(slide(container).querySelector("svg.lucide-bot")).toBeNull();
    const text = slide(container).textContent ?? "";
    expect(text).toContain("Yours");
    expect(text).toContain("Grace's agent");
    expect(text).toContain("Anthony's agent");
  });

  it("the agent view's header wears the owner's face and runtime badge over the product stats", () => {
    const { container } = render(<DemoScene step={STEP} thread={OPEN_THREAD} agentOpen />);
    const view = container.querySelector('aside[aria-label="Agent view"]')!;
    const header = view.querySelector("header")!;
    expect(header.textContent).toContain("Teardown Order Fix");
    expect(header.querySelector("[data-identity-face] img[src*='logo']")).not.toBeNull();
    const well = view.querySelector(".card-well")!.textContent ?? "";
    expect(well).toContain("Context tokens");
    expect(well).toContain("tokens spent");
  });
});
