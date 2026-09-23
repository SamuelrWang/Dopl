// @vitest-environment jsdom
/**
 * `useChannelLaunchPosture` — a READ-ONLY selector over `useLaunchSelection` (P6-07 / F4).
 *
 * 🔒 THE PROPERTY: one channel record, one store. The hook used to keep its own bridge read and its
 * own reader set while every write went through `useLaunchSelection`, so a runtime changed in
 * Settings never reached the agent panel, the composer or the launch refusal copy until they
 * remounted.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
  useChannelLaunchPosture,
  type ChannelLaunchPostureState,
} from "./use-channel-launch-posture";
import { useLaunchSelection, type LaunchSelectionState } from "./use-launch-selection";
import { REAL_DESCRIPTORS } from "../lib/runtime-descriptors-harness";
import { catalog } from "./launch-selection-harness";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const CH = "44444444-4444-4444-8444-444444444444";

const reply = (runtime: string) => ({
  runtimes: REAL_DESCRIPTORS,
  defaultRuntime: "claude",
  connected: ["claude", "codex"],
  catalogVersion: 1,
  catalogs: {
    claude: catalog("claude", [{ id: "claude-sonnet-5", isDefault: true }]),
    codex: catalog("codex", [{ id: "gpt-6-sol", isDefault: true }]),
  },
  selection: { v: 2, runtime, messages: "ask", byRuntime: {} },
});

function installBridge(initial: string) {
  let stored = initial;
  const getLaunchPosture = vi.fn().mockImplementation(async () => reply(stored));
  const setLaunchPosture = vi
    .fn()
    .mockImplementation(async (_id: string, patch: { runtime?: string }) => {
      if (patch.runtime !== undefined) stored = patch.runtime;
      return { ok: true };
    });
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    channels: { getLaunchPosture, setLaunchPosture },
  };
  return { getLaunchPosture, setLaunchPosture };
}

/** Publishes from an effect — a render-phase write trips `react-hooks/immutability`. */
async function mountBoth() {
  const posture: { value: ChannelLaunchPostureState | null } = { value: null };
  const settings: { value: LaunchSelectionState | null } = { value: null };
  function AgentSurface() {
    const state = useChannelLaunchPosture(CH);
    useEffect(() => {
      posture.value = state;
    });
    return null;
  }
  function SettingsTab() {
    const state = useLaunchSelection({ kind: "channel", channelId: CH });
    useEffect(() => {
      settings.value = state;
    });
    return null;
  }
  await act(async () => {
    render(
      <>
        <AgentSurface />
        <SettingsTab />
      </>
    );
  });
  return { posture: posture as { value: ChannelLaunchPostureState }, settings };
}

describe("useChannelLaunchPosture", () => {
  it("🔒 a Settings runtime write reaches a mounted reader without a remount", async () => {
    installBridge("");
    const { posture, settings } = await mountBoth();
    expect(posture.value.descriptor?.id).toBe("claude");
    expect(posture.value.catalog?.runtime).toBe("claude");
    await act(async () => {
      await settings.value!.update({ runtime: "codex" });
    });
    expect(posture.value.runtime).toBe("codex");
    expect(posture.value.descriptor?.id).toBe("codex");
    expect(posture.value.catalog?.runtime).toBe("codex");
  });

  it("reads the record once per mount — no second bridge read of its own", async () => {
    const bridge = installBridge("");
    const holder: { value: ChannelLaunchPostureState | null } = { value: null };
    function Probe() {
      const state = useChannelLaunchPosture(CH);
      useEffect(() => {
        holder.value = state;
      });
      return null;
    }
    await act(async () => {
      render(<Probe />);
    });
    expect(bridge.getLaunchPosture).toHaveBeenCalledTimes(1);
    expect(holder.value!.runtimes.map((d) => d.id)).toEqual(REAL_DESCRIPTORS.map((d) => d.id));
  });

  it("answers a RUNNING agent's own runtime, whatever the channel's pick is", async () => {
    installBridge("claude");
    const { posture } = await mountBoth();
    expect(posture.value.descriptor?.id).toBe("claude");
    expect(posture.value.descriptorOf("codex")?.id).toBe("codex");
    expect(posture.value.catalogOf("codex")?.runtime).toBe("codex");
    // `''` is a session with no stamp: the DEFAULT adapter, not the channel's pick.
    expect(posture.value.descriptorOf("")?.id).toBe("claude");
  });

  it("answers nothing in a plain browser", async () => {
    const holder: { value: ChannelLaunchPostureState | null } = { value: null };
    function Probe() {
      const state = useChannelLaunchPosture(CH);
      useEffect(() => {
        holder.value = state;
      });
      return null;
    }
    await act(async () => {
      render(<Probe />);
    });
    expect(holder.value!.descriptor).toBeNull();
    expect(holder.value!.descriptorOf("codex")).toBeNull();
    expect(holder.value!.catalogOf("codex")).toBeNull();
    expect(holder.value!.runtimes).toEqual([]);
  });
});
