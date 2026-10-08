// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DoplDictationBridge } from "@/shared/lib/desktop";
import { dictationFault } from "./faults";
import { selectEngine } from "./select-engine";
import type { RecognitionCtor } from "./web-engine";

const Ctor = class {} as unknown as RecognitionCtor;
const bridge = (): DoplDictationBridge => ({
  probe: vi.fn(async () => ({ state: "ready" as const })),
  start: vi.fn(async () => ({ ok: true as const, id: "s1" })),
  stop: vi.fn(async () => ({ ok: true })),
  onEvent: vi.fn(() => () => {}),
});

describe("engine selection", () => {
  it("🔒 NEVER picks the browser engine inside the desktop app, even when it exists", () => {
    // The bug this replaced: Electron ships `webkitSpeechRecognition` with no Google key.
    expect(selectEngine({ isDesktop: true, bridge: bridge(), webCtor: Ctor, mac: true })?.kind).toBe(
      "macos-native"
    );
    expect(selectEngine({ isDesktop: true, bridge: null, webCtor: Ctor, mac: true })?.kind).toBe(
      "unavailable"
    );
  });

  it("an older desktop main says to update, with the Fn hint on a Mac", async () => {
    const engine = selectEngine({ isDesktop: true, bridge: null, webCtor: null, mac: true })!;
    const answer = await engine.probe();
    expect(answer).toEqual({ ok: false, fault: dictationFault("desktop-outdated", true) });
    expect(answer.ok === false && answer.fault.fix).toMatch(/Fn twice/);
  });

  it("a browser uses its own engine, and a browser without one gets no button", () => {
    expect(selectEngine({ isDesktop: false, bridge: null, webCtor: Ctor, mac: false })?.kind).toBe(
      "web-speech"
    );
    expect(selectEngine({ isDesktop: false, bridge: null, webCtor: null, mac: false })).toBeNull();
  });
});

describe("faults", () => {
  it("two ordinary endings are not faults", () => {
    expect(dictationFault("no-speech", true)).toBeNull();
    expect(dictationFault("aborted", true)).toBeNull();
    expect(dictationFault(null, true)).toBeNull();
  });

  it("every blocker names the setting to change", () => {
    expect(dictationFault("speech-denied", true)?.fix).toMatch(/Privacy & Security › Speech Recognition/);
    expect(dictationFault("mic-denied", true)?.fix).toMatch(/Privacy & Security › Microphone/);
    expect(dictationFault("on-device-unavailable", true)?.fix).toMatch(/Keyboard/);
  });

  it("🔒 an unknown code is still a fault, never silence", () => {
    expect(dictationFault("helper-failed", true)).toMatchObject({ reason: "Dictation failed" });
    expect(dictationFault("helper-failed", true)?.fix).toMatch(/Fn twice/);
    expect(dictationFault("helper-failed", false)?.fix).not.toMatch(/Fn/);
  });

  it("copy has no em dashes (copy voice)", () => {
    for (const code of ["speech-denied", "mic-denied", "network", "unsupported-os", "x"]) {
      const f = dictationFault(code, true)!;
      expect(`${f.reason} ${f.fix ?? ""}`).not.toContain("—");
    }
  });
});
