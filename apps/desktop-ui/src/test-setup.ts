import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// ⚠ Per-device UI memory (`shared/lib/persisted-ui-state.ts`: /home's face, the
// ontology board's last place, drafts) lives in localStorage, which jsdom keeps
// for the whole file. Without this one case's tab or pick decides what the next
// case opens. A case testing the memory seeds its own keys.
afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // node-environment files have no window
  }
});

// jsdom has no ResizeObserver; `LiquidGlass` (the knowledge home hero panel)
// observes its own box on mount. A no-op stand-in is enough — no test asserts
// on resize behavior, the component only needs the constructor to exist.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
