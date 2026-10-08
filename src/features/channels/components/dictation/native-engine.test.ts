// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DesktopDictationEvent, DoplDictationBridge } from "@/shared/lib/desktop";
import { nativeEngine } from "./native-engine";

function fakeBridge(over: Partial<DoplDictationBridge> = {}) {
  let listener: ((e: DesktopDictationEvent) => void) | null = null;
  const bridge: DoplDictationBridge = {
    probe: vi.fn(async () => ({ state: "ready" as const })),
    start: vi.fn(async () => ({ ok: true as const, id: "s1" })),
    stop: vi.fn(async () => ({ ok: true })),
    onEvent: vi.fn((cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
    ...over,
  };
  const push = (e: Partial<DesktopDictationEvent>) =>
    listener?.({ id: "s1", type: "partial", text: "", code: "", ...e });
  return { bridge, push, subscribed: () => listener !== null };
}

const handlers = () => ({
  onStart: vi.fn(),
  onPartial: vi.fn(),
  onFinal: vi.fn(),
  onFault: vi.fn(),
  onEnd: vi.fn(),
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the desktop engine", () => {
  it("probe: ready is ready; every code becomes the operator's words", async () => {
    expect(await nativeEngine(fakeBridge().bridge, true).probe()).toEqual({ ok: true });
    const denied = fakeBridge({ probe: vi.fn(async () => ({ state: "unavailable" as const, code: "speech-denied" })) });
    const answer = await nativeEngine(denied.bridge, true).probe();
    expect(answer.ok).toBe(false);
    expect(answer.ok === false && answer.fault.reason).toBe("Speech recognition blocked");
  });

  it("🔒 a probe that throws or answers nothing is unavailable, never ready", async () => {
    const broken = fakeBridge({ probe: vi.fn(async () => { throw new Error("ipc"); }) });
    expect((await nativeEngine(broken.bridge, true).probe()).ok).toBe(false);
    const empty = fakeBridge({ probe: vi.fn(async () => null) });
    expect((await nativeEngine(empty.bridge, true).probe()).ok).toBe(false);
  });

  it("streams partials and finals for ITS session only, then ends once", async () => {
    const { bridge, push, subscribed } = fakeBridge();
    const h = handlers();
    nativeEngine(bridge, true).start("en-US", h);
    await flush();
    push({ type: "start" });
    push({ type: "partial", text: "hello wor" });
    push({ id: "other", type: "final", text: "not mine" });
    push({ type: "final", text: "hello world" });
    push({ type: "end" });
    push({ type: "final", text: "after end" });
    expect(h.onStart).toHaveBeenCalledOnce();
    expect(h.onPartial).toHaveBeenCalledWith("hello wor");
    expect(h.onFinal.mock.calls).toEqual([["hello world"]]);
    expect(h.onEnd).toHaveBeenCalledOnce();
    expect(subscribed()).toBe(false);
  });

  it("a refused start is a fault and an end", async () => {
    const { bridge } = fakeBridge({ start: vi.fn(async () => ({ ok: false as const, code: "mic-denied" })) });
    const h = handlers();
    nativeEngine(bridge, true).start("en-US", h);
    await flush();
    expect(h.onFault.mock.calls[0][0].reason).toBe("Microphone blocked");
    expect(h.onEnd).toHaveBeenCalledOnce();
  });

  it("a stop before main answered is honoured once the id arrives", async () => {
    const { bridge } = fakeBridge();
    const session = nativeEngine(bridge, true).start("en-US", handlers());
    session.stop();
    await flush();
    expect(bridge.stop).toHaveBeenCalledWith("s1");
  });

  it("a silent ending (no-speech) is not a fault", async () => {
    const { bridge, push } = fakeBridge();
    const h = handlers();
    nativeEngine(bridge, true).start("en-US", h);
    await flush();
    push({ type: "error", code: "no-speech" });
    push({ type: "end" });
    expect(h.onFault).not.toHaveBeenCalled();
    expect(h.onEnd).toHaveBeenCalledOnce();
  });
});
