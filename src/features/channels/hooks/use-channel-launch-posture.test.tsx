// @vitest-environment jsdom
/**
 * The DURABLE LAUNCH POSTURE hook, and the failure it was introduced to end.
 *
 * ⚠ THE BUG THIS RECORD REPLACED. The Settings tab wrote the SINGLE-USE ARM. The
 * operator picked Bypass; the first consent-approved launch consumed it (or thirty
 * minutes passed); every session after that started manual/ask — and nothing told
 * the control, which went on displaying "Bypass" because it re-reads only on mount.
 * A durable record has nothing to be stale ABOUT, which is why the fix is a second
 * record rather than a refresh.
 *
 * ⚠ WHAT MUST STAY TRUE OF THE OTHER RECORD. The arm is untouched: single-use,
 * 30-minute, consumed by `trigger.js › inboundApproved` alone. H2 is intact because
 * the split is by CONSUMER — `main/channel-prefs.js` is the statement of record and
 * `dopl-desktop-app/test/session-preset-start.test.mjs` pins the consumer counts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
  getDesktopLaunchPosture,
  useChannelLaunchPosture,
  type ChannelLaunchPostureState,
} from "./use-channel-launch-posture";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const CH = "44444444-4444-4444-8444-444444444444";
const BYPASS = { tools: "bypass", messages: "auto_both" } as const;
const MANUAL = { tools: "manual", messages: "ask" } as const;

function installBridge(over: Record<string, unknown> = {}) {
  const getLaunchPosture = vi.fn().mockResolvedValue(MANUAL);
  const setLaunchPosture = vi.fn().mockResolvedValue({ ok: true });
  const channels = { getLaunchPosture, setLaunchPosture, ...over };
  (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn(), channels };
  return channels as unknown as {
    getLaunchPosture: ReturnType<typeof vi.fn>;
    setLaunchPosture: ReturnType<typeof vi.fn>;
  };
}

/** Publishes from an effect — a render-phase write trips `react-hooks/immutability`. */
async function mount(channelId = CH) {
  const holder: { value: ChannelLaunchPostureState | null } = { value: null };
  function Probe() {
    const state = useChannelLaunchPosture(channelId);
    useEffect(() => {
      holder.value = state;
    });
    return null;
  }
  await act(async () => {
    render(<Probe />);
  });
  return holder;
}

describe("getDesktopLaunchPosture", () => {
  it("is null in a plain browser, so the control renders nowhere", () => {
    expect(getDesktopLaunchPosture()).toBeNull();
  });

  it("is null on a desktop that predates the split — feature-keyed, not marker-keyed", () => {
    // An older main has the ARM ops and not these. Detecting on `window.dopl`
    // being truthy would hand that build a control whose writes go nowhere.
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      channels: { getPermissionPreset: vi.fn(), setPermissionPreset: vi.fn() },
    };
    expect(getDesktopLaunchPosture()).toBeNull();
  });

  it("is the bridge once BOTH halves are present", () => {
    installBridge();
    expect(getDesktopLaunchPosture()).not.toBeNull();
  });
});

describe("useChannelLaunchPosture", () => {
  it("reads the stored pair on mount", async () => {
    const bridge = installBridge();
    bridge.getLaunchPosture.mockResolvedValue(BYPASS);
    const holder = await mount();
    expect(holder.value!.posture).toEqual(BYPASS);
    expect(bridge.getLaunchPosture).toHaveBeenCalledWith(CH);
  });

  it("falls back to the restrictive pair when the bridge answers nothing", async () => {
    const bridge = installBridge();
    bridge.getLaunchPosture.mockResolvedValue(null);
    const holder = await mount();
    expect(holder.value!.posture).toEqual(MANUAL);
  });

  it("rejects a half-valid pair WHOLE, like the main-process validator", async () => {
    const bridge = installBridge();
    bridge.getLaunchPosture.mockResolvedValue({ tools: "bypass", messages: "nonsense" });
    const holder = await mount();
    expect(holder.value!.posture).toEqual(MANUAL);
  });

  it("writes one axis and carries the other through unchanged", async () => {
    const bridge = installBridge();
    const holder = await mount();
    await act(async () => {
      await holder.value!.update({ tools: "bypass" });
    });
    expect(bridge.setLaunchPosture).toHaveBeenCalledWith(CH, {
      tools: "bypass",
      messages: "ask",
    });
    expect(holder.value!.posture).toEqual({ tools: "bypass", messages: "ask" });
  });

  it("merges onto what is STORED, never onto the mount snapshot", async () => {
    // Another surface moved the OTHER axis since this component mounted. Writing
    // `{...snapshot, ...patch}` would silently revert it.
    const bridge = installBridge();
    const holder = await mount();
    bridge.getLaunchPosture.mockResolvedValue({ tools: "manual", messages: "auto_both" });
    await act(async () => {
      await holder.value!.update({ tools: "bypass" });
    });
    expect(bridge.setLaunchPosture).toHaveBeenCalledWith(CH, {
      tools: "bypass",
      messages: "auto_both",
    });
  });

  it("REVERTS when the desktop refused — the row never claims an unstored posture", async () => {
    // ⚠ This is the exact failure the durable record exists to end, in its other
    // form: a control displaying a posture nothing will launch with.
    const bridge = installBridge();
    bridge.setLaunchPosture.mockResolvedValue({ ok: false });
    const holder = await mount();
    await act(async () => {
      await holder.value!.update({ tools: "bypass" });
    });
    expect(holder.value!.posture).toEqual(MANUAL);
  });

  it("REVERTS when the bridge throws", async () => {
    const bridge = installBridge();
    bridge.setLaunchPosture.mockRejectedValue(new Error("ipc gone"));
    const holder = await mount();
    await act(async () => {
      await holder.value!.update({ tools: "bypass" });
    });
    expect(holder.value!.posture).toEqual(MANUAL);
  });

  it("does not write when neither axis actually moved", async () => {
    const bridge = installBridge();
    const holder = await mount();
    await act(async () => {
      await holder.value!.update({ tools: "manual" });
    });
    expect(bridge.setLaunchPosture).not.toHaveBeenCalled();
  });

  it("does nothing at all without a bridge", async () => {
    const holder = await mount();
    expect(holder.value!.bridge).toBeNull();
    await act(async () => {
      await holder.value!.update({ tools: "bypass" });
    });
    expect(holder.value!.posture).toEqual(MANUAL);
  });

  it("adopts a write made on ANOTHER mounted surface", async () => {
    // Two readers of one channel (the tab, and a pop-out). A private snapshot in
    // each is how the second writer reverts the first's axis.
    installBridge();
    const a = await mount();
    const b = await mount();
    await act(async () => {
      await a.value!.update({ tools: "bypass" });
    });
    expect(b.value!.posture.tools).toBe("bypass");
  });
});
