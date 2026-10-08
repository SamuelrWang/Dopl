// @vitest-environment jsdom
/**
 * THE HOOK OVER THE ENGINE INTERFACE (2026-10-08): which engine a surface gets, that an
 * unavailable one SAYS WHY before the first click, that a click re-probes, and that no stop ever
 * loses words. The browser engine's own path is `composer-toolbar.test.tsx`'s.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { DesktopDictationEvent, DoplDictationBridge } from "@/shared/lib/desktop";
import { useDictation } from "./use-dictation";

type Probe = Awaited<ReturnType<DoplDictationBridge["probe"]>>;

function installDesktop(probe: Probe | (() => Probe), withDictation = true) {
  let listener: ((e: DesktopDictationEvent) => void) | null = null;
  const bridge: DoplDictationBridge = {
    probe: vi.fn(async () => (typeof probe === "function" ? probe() : probe)),
    start: vi.fn(async () => ({ ok: true as const, id: "s1" })),
    stop: vi.fn(async () => ({ ok: true })),
    onEvent: vi.fn((cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
  };
  (window as unknown as { dopl?: unknown }).dopl = {
    isDesktop: true,
    ...(withDictation ? { dictation: bridge } : {}),
  };
  // ⚠ Present on purpose: Electron ships it, and it must be IGNORED on the desktop.
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = class {};
  const push = (e: Partial<DesktopDictationEvent>) =>
    act(() => listener?.({ id: "s1", type: "partial", text: "", code: "", ...e }));
  return { bridge, push };
}

afterEach(() => {
  delete (window as unknown as { dopl?: unknown }).dopl;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("useDictation on the desktop", () => {
  it("renders the button and says why BEFORE the first click when the engine cannot run", async () => {
    installDesktop({ state: "unavailable", code: "speech-denied" });
    const { result } = renderHook(() => useDictation(() => {}));
    expect(result.current.supported).toBe(true);
    await waitFor(() => expect(result.current.error).toBe("Speech recognition blocked"));
    expect(result.current.hint).toMatch(/System Settings/);
  });

  it("an older main without the engine says to update, never offers a dead mic", async () => {
    installDesktop({ state: "ready" }, false);
    const { result } = renderHook(() => useDictation(() => {}));
    await waitFor(() => expect(result.current.error).toBe("Update Dopl for dictation"));
  });

  it("a click RE-PROBES: a permission fixed meanwhile starts straight away", async () => {
    let answer: Probe = { state: "unavailable", code: "mic-denied" };
    const { bridge, push } = installDesktop(() => answer);
    const { result } = renderHook(() => useDictation(() => {}));
    await waitFor(() => expect(result.current.error).toBe("Microphone blocked"));
    answer = { state: "ready" };
    act(() => result.current.toggle());
    await flush();
    expect(bridge.start).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    await push({ type: "start" });
    expect(result.current.listening).toBe(true);
  });

  it("partials preview, finals append, and a stop keeps the last partial", async () => {
    const { bridge, push } = installDesktop({ state: "ready" });
    const phrases: string[] = [];
    const { result } = renderHook(() => useDictation((t) => phrases.push(t)));
    await flush();
    act(() => result.current.toggle());
    await flush();
    await push({ type: "start" });
    await push({ type: "partial", text: "hello wor" });
    expect(result.current.partial).toBe("hello wor");
    expect(phrases).toEqual([]);
    await push({ type: "final", text: "hello world" });
    await push({ type: "partial", text: "and more" });
    act(() => result.current.toggle());
    expect(bridge.stop).toHaveBeenCalledWith("s1");
    await push({ type: "end" });
    expect(phrases).toEqual(["hello world", "and more"]);
    expect(result.current.listening).toBe(false);
    expect(result.current.partial).toBe("");
  });

  it("a fault mid-session names itself and persists past the stop", async () => {
    const { push } = installDesktop({ state: "ready" });
    const { result } = renderHook(() => useDictation(() => {}));
    await flush();
    act(() => result.current.toggle());
    await flush();
    await push({ type: "start" });
    await push({ type: "error", code: "on-device-unavailable" });
    await push({ type: "end" });
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toBe("Speech model not installed");
  });
});

describe("useDictation in a browser", () => {
  it("no engine ⇒ no button", () => {
    const { result } = renderHook(() => useDictation(() => {}));
    expect(result.current.supported).toBe(false);
  });
});
