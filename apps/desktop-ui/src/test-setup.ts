import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { __resetDraftStoreForTests } from "@/shared/lib/draft-store";

afterEach(cleanup);

// ⚠ Per-device UI memory (`shared/lib/persisted-ui-state.ts`: /home's face, the
// ontology board's last place, drafts) lives in localStorage, which jsdom keeps
// for the whole file. Without this one case's tab or pick decides what the next
// case opens. A case testing the memory seeds its own keys.
afterEach(() => {
  // Drafts also keep a module-memory copy above localStorage; reset it with the storage.
  __resetDraftStoreForTests();
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

// jsdom has no `matchMedia` either, and `AuthSplitLayout › usePrefersReducedMotion` — added
// 2026-10-10 with the glass morph — calls it on mount. The desktop SPA renders that layout on
// the signed-out screen, so WITHOUT this the 401 route throws inside React Router and the page
// shows an error card instead of the login screen: `home/index.test.tsx › routes a 401 to the
// signed-out screen` failed exactly that way, which is a real render crash in the test
// environment rather than a bad assertion.
//
// ⚠ `matches: false` ON PURPOSE — that is the MOTION path, the branch every real browser takes
// by default and the one the morph and the card cross-fade actually live on. Answering `true`
// here would quietly route every suite through the reduced-motion shortcut and leave the
// animated paths untested while looking green.
if (typeof globalThis.matchMedia === "undefined") {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof matchMedia;
}
