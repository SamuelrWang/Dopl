// @vitest-environment jsdom
/**
 * `isDesktopApp` must answer TRUE inside the bundled desktop SPA, whose `window.dopl` is
 * `renderer/app-preload.js`'s: it carries `apiRequest` and has NO `isDesktop` member (that
 * marker belonged to the remote wrapper's preload, deleted 2026-08-07). Answering false there
 * made `use-dictation.ts` pick Electron's keyless `webkitSpeechRecognition` instead of the
 * on-device helper.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopDictation, isDesktopApp } from "./desktop";

type W = { dopl?: unknown };

/** The shape the real preload exposes: the SPA transport plus the dictation namespace. */
function installSpaBridge() {
  (window as unknown as W).dopl = {
    appOrigin: "https://www.usedopl.com",
    apiRequest: vi.fn(),
    getAuthState: vi.fn(),
    openExternal: vi.fn(),
    dictation: { probe: vi.fn(), start: vi.fn(), stop: vi.fn(), onEvent: vi.fn() },
  };
}

afterEach(() => {
  delete (window as unknown as W).dopl;
});

describe("isDesktopApp", () => {
  it("is true in the bundled SPA, whose preload has no isDesktop marker", () => {
    installSpaBridge();
    expect((window as unknown as { dopl: Record<string, unknown> }).dopl.isDesktop).toBeUndefined();
    expect(isDesktopApp()).toBe(true);
    // The dictation path this gates: the native bridge is there to be chosen.
    expect(getDesktopDictation()).not.toBeNull();
  });

  it("is false in a plain browser (no bridge)", () => {
    expect((window as unknown as W).dopl).toBeUndefined();
    expect(isDesktopApp()).toBe(false);
  });

  it("is false for a partial window.dopl with neither the marker nor apiRequest", () => {
    (window as unknown as W).dopl = { channels: {} };
    expect(isDesktopApp()).toBe(false);
  });

  it("still honours the explicit marker", () => {
    (window as unknown as W).dopl = { isDesktop: true };
    expect(isDesktopApp()).toBe(true);
  });
});
