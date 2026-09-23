// @vitest-environment jsdom
/**
 * THE ONE LAUNCH ACT (`use-launch-controls.ts`) — shared by the channel page and the agent pop-out.
 *
 *  - 🔒 ONE AGENT PER CLICK SEQUENCE (P6-02): the guard is synchronous, so two calls inside one
 *    render start one agent.
 *  - 🔒 THE REFUSAL NAMES THE RUNTIME THAT WAS LAUNCHED (P6-03), not the channel's pick.
 *  - 🔒 ONE PAYLOAD BUILDER (P6-10): absent keys are omitted, and a counterparty / `direct` go on
 *    the wire only when the host knows them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { buildLaunchPayload, useLaunchControls, type LaunchSite } from "./use-launch-controls";
import { signedOutLaunchCopy } from "../lib/runtime-copy";
import { realDescriptor, REAL_DESCRIPTORS } from "../lib/runtime-descriptors-harness";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const CH = "44444444-4444-4444-8444-444444444444";
const PEER = "22222222-2222-4222-8222-222222222222";

const SITE: LaunchSite = {
  channelId: CH,
  workspaceId: "ws-1",
  channelName: "Website",
  direct: false,
  thread: (id) => (id === "t-1" ? { title: "UI-kit design", counterpartyId: PEER } : null),
};

function install(launch: ReturnType<typeof vi.fn>, channelRuntime = "claude") {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    sessions: { launch },
    channels: {
      getLaunchPosture: vi.fn().mockResolvedValue({
        runtimes: REAL_DESCRIPTORS,
        defaultRuntime: "claude",
        connected: ["claude"],
        selection: { v: 2, runtime: channelRuntime, messages: "ask", byRuntime: {} },
      }),
      setLaunchPosture: vi.fn(),
    },
  };
}

async function mount(site: LaunchSite | null = SITE) {
  const holder: { value: ReturnType<typeof useLaunchControls> | null } = { value: null };
  function Probe() {
    const controls = useLaunchControls(site);
    useEffect(() => {
      holder.value = controls;
    });
    return null;
  }
  await act(async () => {
    render(<Probe />);
  });
  return holder as { value: ReturnType<typeof useLaunchControls> };
}

describe("useLaunchControls", () => {
  it("🔒 starts ONE agent for a double click inside one render (P6-02)", async () => {
    const launch = vi.fn().mockResolvedValue({ ok: true, agentId: "k3v7d2mq" });
    install(launch);
    const holder = await mount();
    const act1 = holder.value.launchAgent;
    let second: unknown = null;
    await act(async () => {
      const first = act1("t-1");
      second = await act1("t-1");
      await first;
    });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ ok: false, reason: "busy" });
  });

  it("🔒 words `auth-hold` with the LAUNCHED runtime, not the channel's (P6-03)", async () => {
    install(vi.fn().mockResolvedValue({ ok: false, reason: "auth-hold" }), "claude");
    const holder = await mount();
    await act(async () => {
      await holder.value.launchAgent("t-1", null, undefined, undefined, "codex");
    });
    expect(holder.value.launchError).toBe(signedOutLaunchCopy(realDescriptor("codex")));
  });

  it("with no per-spawn pick, the refusal names the channel's runtime", async () => {
    install(vi.fn().mockResolvedValue({ ok: false, reason: "auth-hold" }), "codex");
    const holder = await mount();
    await act(async () => {
      await holder.value.launchAgent("t-1");
    });
    expect(holder.value.launchError).toBe(signedOutLaunchCopy(realDescriptor("codex")));
  });

  it("carries main's `no-model` sentence verbatim", async () => {
    install(vi.fn().mockResolvedValue({ ok: false, reason: "no-model", detail: "Offered: a, b" }));
    const holder = await mount();
    await act(async () => {
      await holder.value.launchAgent(null);
    });
    expect(holder.value.launchError).toBe("Offered: a, b");
  });
});

describe("buildLaunchPayload (P6-10)", () => {
  it("a one-click launch carries no optional keys, and `null` is the channel-level lane", () => {
    const payload = buildLaunchPayload(SITE, null);
    expect(payload).toEqual({
      channelId: CH,
      taskId: null,
      workspaceId: "ws-1",
      channelName: "Website",
      threadTitle: null,
      direct: false,
    });
  });

  it("names the thread and its other party when the host knows them", () => {
    const payload = buildLaunchPayload(SITE, "t-1", "tpl-9", { model: "m" }, "k3v7d2mq", "codex", "agent-03");
    expect(payload).toMatchObject({
      taskId: "t-1",
      threadTitle: "UI-kit design",
      counterpartyId: PEER,
      identityId: "tpl-9",
      overrides: { model: "m" },
      agentId: "k3v7d2mq",
      runtime: "codex",
      color: "agent-03",
    });
  });

  it("omits `direct` and the counterparty where the host reads no channel record (the pop-out)", () => {
    const popout: LaunchSite = {
      channelId: CH,
      workspaceId: "ws-1",
      channelName: "Website",
      thread: () => ({ title: "UI-kit design", counterpartyId: null }),
    };
    const payload = buildLaunchPayload(popout, "t-1", null, undefined, undefined, "");
    expect("direct" in payload).toBe(false);
    expect("counterpartyId" in payload).toBe(false);
    expect("identityId" in payload).toBe(false);
    // ⚠ `runtime: ''` further down the wire clears a durable pick, so an empty one is omitted.
    expect("runtime" in payload).toBe(false);
  });
});
