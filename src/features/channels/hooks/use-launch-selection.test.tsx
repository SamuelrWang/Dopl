// @vitest-environment jsdom
/** `useLaunchSelection` at both scopes; a refused write re-adopts what is stored and echoes nothing. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { installSpaBridge } from "@/shared/testing/spa-bridge";
import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
  REAL_PERMISSION_LEVELS,
} from "../lib/runtime-descriptors-harness";
import { useLaunchSelection } from "./use-launch-selection";

const CHANNEL = "11111111-2222-3333-4444-555555555555";

const getLaunchPosture = vi.fn();
const setLaunchPosture = vi.fn();
const getAgentDefaults = vi.fn();
const setAgentDefaults = vi.fn();

/** What a current main answers (`channel-dir-ipc.js › channels:getLaunchPosture`): a Full channel
 *  whose Codex record migrated with its own, narrower level. */
const postureReply = (over: Record<string, unknown> = {}) => ({
  tools: "bypass",
  messages: "ask",
  runtime: "",
  runtimes: REAL_DESCRIPTORS,
  defaultRuntime: REAL_DEFAULT_RUNTIME,
  connected: ["claude"],
  permissionLevels: REAL_PERMISSION_LEVELS,
  needsReview: [],
  selection: { v: 3, runtime: "", messages: "ask", level: "full", byRuntime: { codex: "ask" } },
  ...over,
});

/** What `channels:getAgentDefaults` answers — the record ITSELF, plus the roster. */
const defaultsReply = (over: Record<string, unknown> = {}) => ({
  v: 3,
  runtime: "",
  messages: "ask",
  level: "auto",
  byRuntime: { codex: "ask" },
  agentChain: false,
  runtimes: REAL_DESCRIPTORS,
  defaultRuntime: REAL_DEFAULT_RUNTIME,
  connected: ["claude"],
  permissionLevels: REAL_PERMISSION_LEVELS,
  ...over,
});

beforeEach(() => {
  getLaunchPosture.mockReset().mockResolvedValue(postureReply());
  setLaunchPosture.mockReset().mockResolvedValue({ ok: true });
  getAgentDefaults.mockReset().mockResolvedValue(defaultsReply());
  setAgentDefaults.mockReset().mockResolvedValue({ ok: true });
  installSpaBridge({
    channels: { getLaunchPosture, setLaunchPosture, getAgentDefaults, setAgentDefaults },
  });
});
afterEach(cleanup);

async function channelHook() {
  const hook = renderHook(() => useLaunchSelection({ kind: "channel", channelId: CHANNEL }));
  await waitFor(() => expect(hook.result.current.connectedKnown).toBe(true));
  return hook;
}

async function defaultsHook() {
  const hook = renderHook(() => useLaunchSelection({ kind: "defaults" }));
  await waitFor(() => expect(hook.result.current.connectedKnown).toBe(true));
  return hook;
}

// A channel write is an own-key patch: main leaves every key the caller did not send alone.
describe("the CHANNEL scope", () => {
  it("reads the level, each runtime's own level, and main's reading of it", async () => {
    const { result } = await channelHook();
    expect(result.current.level).toBe("full");
    expect(result.current.levelFor("")).toBe("full");
    expect(result.current.levelFor("codex")).toBe("ask");
    expect(result.current.settingFor("claude")).toEqual({ label: "Bypass", setting: "bypass" });
    expect(result.current.settingFor("codex")).toEqual({ label: "Ask for approval", setting: "on-request/workspace-write" });
  });

  it("an older desktop's reply (no permissionLevels) reads no setting rather than guessing one", async () => {
    getLaunchPosture.mockResolvedValue(postureReply({ permissionLevels: undefined }));
    const { result } = await channelHook();
    expect(result.current.settingFor("codex")).toBeNull();
  });

  it("an unreadable level is Ask — never wider than main holds", async () => {
    getLaunchPosture.mockResolvedValue(postureReply({ selection: { v: 3, runtime: "", messages: "ask", level: "max" } }));
    const { result } = await channelHook();
    expect(result.current.level).toBe("ask");
  });

  it("sends EXACTLY the keys the caller patched — a runtime switch restates nothing", async () => {
    const { result } = await channelHook();
    await act(async () => {
      await result.current.update({ runtime: "codex" });
    });
    expect(setLaunchPosture).toHaveBeenCalledWith(CHANNEL, { runtime: "codex" });
  });

  it("a level write sends the level alone, then RE-READS rather than echoing", async () => {
    const { result } = await channelHook();
    getLaunchPosture.mockClear();
    await act(async () => {
      await result.current.update({ level: "auto" });
    });
    expect(setLaunchPosture).toHaveBeenCalledWith(CHANNEL, { level: "auto" });
    expect(getLaunchPosture).toHaveBeenCalled();
  });

  it("on a refusal changes nothing and surfaces main's own sentence", async () => {
    setLaunchPosture.mockResolvedValue({ ok: false, rejected: ['"max" is not a permission level (ask, auto, full)'] });
    const { result } = await channelHook();
    getLaunchPosture.mockClear();
    await act(async () => {
      await result.current.update({ level: "auto" });
    });
    expect(getLaunchPosture).not.toHaveBeenCalled();
    expect(result.current.rejected).toEqual(['"max" is not a permission level (ask, auto, full)']);
    expect(result.current.level).toBe("full");
  });

  it("keeps the last good reply when the re-read after a write fails", async () => {
    const { result } = await channelHook();
    getLaunchPosture.mockRejectedValueOnce(new Error("ipc down"));
    await act(async () => {
      await result.current.update({ level: "auto" });
    });
    expect(result.current.runtimeSupported).toBe(true);
    expect(result.current.level).toBe("full");
    expect(result.current.busy).toBe(false);
  });

  it("a THROWING write settles as not applied rather than rejecting the caller", async () => {
    setLaunchPosture.mockRejectedValueOnce(new Error("ipc down"));
    const { result } = await channelHook();
    await act(async () => {
      await expect(result.current.update({ level: "auto" })).resolves.toBeUndefined();
    });
    expect(result.current.busy).toBe(false);
  });
});

// A defaults write is the whole record and carries `v`: without it `agent-defaults.js › normalizeDefaults`
// reads it as legacy.
describe("the DEFAULTS scope", () => {
  it("writes the WHOLE record, carrying `v` so main does not read it as legacy", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ runtime: "codex" });
    });
    expect(setAgentDefaults.mock.calls[0][0]).toEqual({
      v: 3, runtime: "codex", messages: "ask", level: "auto", agentChain: false, byRuntime: { codex: "ask" },
    });
  });

  it("a level write clears the per-runtime overrides, as main's own patch does", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ level: "full" });
    });
    const sent = setAgentDefaults.mock.calls[0][0];
    expect(sent.level).toBe("full");
    expect(sent.byRuntime).toEqual({});
    expect("tools" in sent || "model" in sent).toBe(false);
  });

  it("NEVER writes a channel's record — the write-once seed is the only inheritance point", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ runtime: "codex" });
      await result.current.update({ agentChain: true });
    });
    expect(setLaunchPosture).not.toHaveBeenCalled();
  });

  it("carries the chaining flag, which is this record's and not a channel's", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ agentChain: true });
    });
    expect(setAgentDefaults.mock.calls[0][0].agentChain).toBe(true);
  });
});
