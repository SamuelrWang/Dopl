// @vitest-environment jsdom
/**
 * The Orchestration section's tour: opens on the first tab, plays only on screen,
 * advances off the active tab's meter, never pauses on hover or focus, and a
 * click jumps to a tab and keeps touring. Reduced motion: static, full meter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OntologySection } from "./ontology-section";
import { CHANNEL, STAGE_COPY } from "./ontology-content";
import { RAIL_CARDS } from "./ontology-agent-rail";
import { CHANNEL_END_MS } from "./ontology-thread";

let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      // Narrow ⇒ the glass stays `static`, so only the observer gates play.
      matches: query.includes("reduced-motion") ? reducedMotion : query.includes("max-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe() {
        this.cb([{ intersectionRatio: 1, isIntersecting: true } as IntersectionObserverEntry], this as never);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const selected = () => screen.getByRole("tab", { selected: true });
const meter = () => document.querySelector<HTMLElement>(".lp-ont-tab-meter i");
const play = () => document.querySelector<HTMLElement>(".lp-ont-window-swap")?.dataset.play;

describe("Orchestration tour", () => {
  it("opens on the first tab and plays once on screen", () => {
    render(<OntologySection />);
    expect(selected().textContent).toContain(STAGE_COPY.context.title);
    expect(play()).toBe("in");
    expect(meter()?.dataset.running).toBe("true");
  });

  it("advances (wrapping) when the active meter ends, and keeps running on hover and focus", () => {
    render(<OntologySection />);
    act(() => {
      fireEvent.animationEnd(meter()!);
    });
    expect(selected().textContent).toContain(STAGE_COPY.channels.title);

    fireEvent.pointerEnter(document.querySelector(".lp-ont-banner")!.parentElement!);
    fireEvent.focus(screen.getAllByRole("tab")[1]);
    expect(meter()?.dataset.running).toBe("true");
  });

  it("a click jumps the tour: the chosen tab gets a running meter and the tour carries on", () => {
    render(<OntologySection />);
    for (const id of ["context", "channels", "tasks", "command"] as const) {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(STAGE_COPY[id].title) }));
      expect(selected().textContent).toContain(STAGE_COPY[id].title);
      expect(document.querySelector(".lp-ont-window-swap")?.children.length).toBe(1);
      expect(meter()).not.toBeNull();
      expect(meter()?.dataset.running).toBe("true");
    }
    // Still touring after clicks: the meter's end advances (command wraps to context).
    act(() => {
      fireEvent.animationEnd(meter()!);
    });
    expect(selected().textContent).toContain(STAGE_COPY.context.title);
  });

  it("reduced motion: static end frames, the meter shows full and never advances", () => {
    reducedMotion = true;
    render(<OntologySection />);
    expect(play()).toBeUndefined();
    expect(meter()).not.toBeNull();
    expect(meter()?.dataset.static).toBe("true");
    act(() => {
      fireEvent.animationEnd(meter()!);
    });
    expect(selected().textContent).toContain(STAGE_COPY.context.title);
  });

  it("the Channels agent rail: one card per agent, every beat inside the meter's fill", () => {
    expect(RAIL_CARDS.map((c) => c.agent)).toEqual(CHANNEL.rail.agents.map((a) => a.agent));
    for (const card of RAIL_CARDS) {
      expect(card.lastAt).toBeLessThanOrEqual(CHANNEL_END_MS);
      // steps run forward in time, or a Sequence window would go negative
      card.steps.forEach(([, t], i) => i && expect(t).toBeGreaterThanOrEqual(card.steps[i - 1][1]));
    }
    render(<OntologySection />);
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(STAGE_COPY.channels.title) }));
    expect(document.querySelectorAll(".lp-ont-rail .lp-ont-acard")).toHaveLength(RAIL_CARDS.length);
  });
});
