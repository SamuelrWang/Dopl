// @vitest-environment jsdom
/**
 * The Agent native section: one demo, no tabs; the heading renders; every
 * tool row in the script is a real Dopl MCP tool; reduced motion shows the
 * finished frame; on screen the transcript starts empty and plays.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AgentNativeSection } from "./agent-native-section";
import { AGENT_NATIVE_COPY, AGENT_SCRIPT } from "./agent-native-content";

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const MANIFEST = readFileSync(join(__dirname, "../../../../packages/mcp-server/src/tool-manifest.ts"), "utf8");
const lastText = (seg: number) => {
  const msgs = AGENT_SCRIPT[seg].msgs;
  const last = msgs[msgs.length - 1];
  return last.kind === "tool" ? last.label : last.text;
};

describe("Agent native section", () => {
  it("renders the heading and one demo with no tabs", () => {
    render(<AgentNativeSection />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(AGENT_NATIVE_COPY.heading);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.querySelector(".lp-ont-tab-meter")).toBeNull();
    expect(document.querySelectorAll(".lp-agn-app")).toHaveLength(1);
  });

  it("every tool row is a real Dopl MCP tool, humanised", () => {
    const tools = AGENT_SCRIPT.flatMap((s) => s.msgs.flatMap((m) => (m.kind === "tool" ? [m.label] : [])));
    expect(tools.length).toBeGreaterThan(0);
    for (const label of tools) {
      expect(label).toMatch(/^Dopl [a-z]+( [a-z]+)*$/);
      const name = label.toLowerCase().replace(/ /g, "_");
      expect(MANIFEST).toContain(`name: "${name}"`);
    }
  });

  it("plays Claude then Gemini, and no line uses a dash", () => {
    expect(AGENT_SCRIPT.map((s) => s.logo)).toEqual(["claude", "gemini"]);
    for (const s of AGENT_SCRIPT)
      for (const m of s.msgs) expect(m.kind === "tool" ? m.arg : m.text).not.toMatch(/[—–]| - /);
    expect(AGENT_NATIVE_COPY.lede).not.toMatch(/[—–]/);
  });

  it("reduced motion: Claude's finished frame, nothing moving", () => {
    reducedMotion = true;
    render(<AgentNativeSection />);
    const chat = document.querySelector(".lp-agn-app-chat")!;
    expect(chat.textContent).toContain(lastText(0));
    expect(document.querySelector(".lp-agn-app-title")?.textContent).toContain("Claude");
  });

  it("on screen: the transcript starts empty and types in", () => {
    vi.useFakeTimers();
    render(<AgentNativeSection />);
    const chat = document.querySelector(".lp-agn-app-chat")!;
    expect(chat.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(chat.textContent).toContain(AGENT_SCRIPT[0].msgs[0].kind === "user" ? "Set up" : "");
  });
});
