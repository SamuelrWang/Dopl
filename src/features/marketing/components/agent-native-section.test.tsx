// @vitest-environment jsdom
/**
 * The Agent native section: heading and three tabs render, the tour advances
 * off the active meter, a click jumps to a tab, and reduced motion is static.
 * Mirrors ./ontology-section.test.tsx.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentNativeSection } from "./agent-native-section";
import { AGENTS_SCENE, AGENT_NATIVE_COPY, IDENTITY_SCENE, KNOWLEDGE_SCENE, STAGE_COPY } from "./agent-native-content";

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
const MANIFEST = readFileSync(join(__dirname, "../../../../packages/mcp-server/src/tool-manifest.ts"), "utf8");
const IDS = ["identities", "knowledge", "agents"] as const;

describe("Agent native tour", () => {
  it("renders the heading and three tabs, opening on the first and playing on screen", () => {
    render(<AgentNativeSection />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(AGENT_NATIVE_COPY.heading);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(
      IDS.map((id, i) => (i === 0 ? STAGE_COPY[id].title + STAGE_COPY[id].blurb : STAGE_COPY[id].title)),
    );
    expect(play()).toBe("in");
    expect(meter()?.dataset.running).toBe("true");
  });

  it("advances (wrapping) when the active meter ends", () => {
    render(<AgentNativeSection />);
    for (const next of ["knowledge", "agents", "identities"] as const) {
      act(() => {
        fireEvent.animationEnd(meter()!);
      });
      expect(selected().textContent).toContain(STAGE_COPY[next].title);
    }
  });

  it("a click jumps to that tab and swaps in its window", () => {
    render(<AgentNativeSection />);
    for (const id of IDS) {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(STAGE_COPY[id].title) }));
      expect(selected().textContent).toContain(STAGE_COPY[id].title);
      expect(document.querySelector(".lp-ont-window-swap")?.children.length).toBe(1);
      expect(meter()?.dataset.running).toBe("true");
    }
  });

  it("reduced motion: static end frames, a full meter that never advances", () => {
    reducedMotion = true;
    render(<AgentNativeSection />);
    expect(play()).toBeUndefined();
    expect(meter()?.dataset.static).toBe("true");
    act(() => {
      fireEvent.animationEnd(meter()!);
    });
    expect(selected().textContent).toContain(STAGE_COPY.identities.title);
  });

  it("every scripted call lands inside its scene and in order", () => {
    for (const scene of [IDENTITY_SCENE, KNOWLEDGE_SCENE, AGENTS_SCENE]) {
      scene.calls.forEach((call, i) => {
        expect(call.doneAt).toBeGreaterThan(call.at);
        expect(call.doneAt).toBeLessThanOrEqual(scene.endMs);
        if (i) expect(call.at).toBeGreaterThanOrEqual(scene.calls[i - 1].doneAt);
        // a real tool on the MCP surface, not an invented one
        expect(MANIFEST).toContain(`name: "${call.tool}"`);
      });
    }
  });
});
