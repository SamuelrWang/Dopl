import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

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
