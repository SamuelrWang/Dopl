// @vitest-environment jsdom
/**
 * The demo's info column draws the PRODUCT's agent cards and thread-info rows (no face swap), and
 * the card's Open is the control the scripted cursor presses. The received / posted boxes
 * (`demo-stream-boxes.tsx`) are still re-faced in place.
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
    expect(slide(container).querySelector("[data-lp-swapped]")).toBeNull();

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

describe("the demo received / posted boxes", () => {
  it("re-faces the inbound brief and the posted reply with a header row", async () => {
    const { container } = render(
      <DemoScene step={STEP} thread={OPEN_THREAD} agentOpen />
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".lp-demo-sb")).toHaveLength(2)
    );
    const [received, posted] = [
      container.querySelector('.lp-demo-sb[data-kind="inbound"]'),
      container.querySelector('.lp-demo-sb[data-kind="sent"]'),
    ];
    expect(received?.querySelector(".lp-demo-sb-label")?.textContent).toMatch(
      /^Received from @cleanup-planner$/
    );
    expect(posted?.querySelector(".lp-demo-sb-label")?.textContent).toMatch(/^Posted to /);
    // The body is the product's own rendering, cloned.
    expect(received?.textContent).toContain("session/teardown.ts");
    expect(posted?.textContent).toContain("On it.");
    for (const p of container.querySelectorAll("[data-stream-inbound]"))
      expect(p.hasAttribute("data-lp-swapped")).toBe(true);
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

  it("the agent view's header and stats are re-faced with the product's figures", async () => {
    const { container } = render(<DemoScene step={STEP} thread={OPEN_THREAD} agentOpen />);
    await waitFor(() => expect(container.querySelector(".lp-demo-avs")).not.toBeNull());
    expect(container.querySelector(".lp-demo-avh-name")?.textContent).toBe("Teardown Order Fix");
    const stats = container.querySelector(".lp-demo-avs")!.textContent ?? "";
    expect(stats).toContain("Context tokens");
    expect(stats).toContain("tokens spent");
  });
});
