// @vitest-environment jsdom
/** `useLaunchSelection` at both scopes; a refused write re-adopts what is stored and echoes nothing. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { installSpaBridge } from "@/shared/testing/spa-bridge";
import { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } from "../lib/runtime-descriptors-harness";
import { useLaunchSelection } from "./use-launch-selection";

const CHANNEL = "11111111-2222-3333-4444-555555555555";

const getLaunchPosture = vi.fn();
const setLaunchPosture = vi.fn();
const getAgentDefaults = vi.fn();
const setAgentDefaults = vi.fn();

/** What a current main answers: the legacy keys and the versioned record, additively
 *  (`channel-dir-ipc.js › channels:getLaunchPosture`). */
const postureReply = (over: Record<string, unknown> = {}) => ({
  tools: "accept_edits",
  messages: "ask",
  runtime: "",
  runtimes: REAL_DESCRIPTORS,
  defaultRuntime: REAL_DEFAULT_RUNTIME,
  connected: ["claude"],
  selectionVersion: 2,
  needsReview: [],
  selection: {
    v: 2,
    runtime: "",
    messages: "ask",
    byRuntime: {
      claude: { tools: "accept_edits" },
      codex: { tools: "on-request", native: { sandbox_mode: "read-only" } },
    },
  },
  ...over,
});

/** What `channels:getAgentDefaults` answers — the record ITSELF, plus the roster. */
const defaultsReply = (over: Record<string, unknown> = {}) => ({
  tools: "accept_edits",
  messages: "ask",
  agentChain: false,
  runtime: "",
  v: 2,
  byRuntime: {
    claude: { tools: "accept_edits" },
    codex: { native: { sandbox_mode: "read-only" } },
  },
  runtimes: REAL_DESCRIPTORS,
  defaultRuntime: REAL_DEFAULT_RUNTIME,
  connected: ["claude"],
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
  it("reads every runtime's record, not just the selected one", async () => {
    const { result } = await channelHook();
    expect(result.current.recordFor("claude").tools).toBe("accept_edits");
    expect(result.current.recordFor("codex").tools).toBe("on-request");
    expect(result.current.recordFor("codex").native).toEqual({ sandbox_mode: "read-only" });
  });

  it("sends EXACTLY the keys the caller patched — a runtime switch restates nothing", async () => {
    const { result } = await channelHook();
    await act(async () => {
      await result.current.update({ runtime: "codex" });
    });
    expect(setLaunchPosture).toHaveBeenCalledWith(CHANNEL, { runtime: "codex" });
  });

  it("carries a native bag as its own key", async () => {
    const { result } = await channelHook();
    await act(async () => {
      await result.current.update({ native: { sandbox_mode: "workspace-write" } });
    });
    expect(setLaunchPosture).toHaveBeenCalledWith(CHANNEL, {
      native: { sandbox_mode: "workspace-write" },
    });
  });

  it("RE-READS after a write rather than echoing the request", async () => {
    const { result } = await channelHook();
    getLaunchPosture.mockClear();
    await act(async () => {
      await result.current.update({ tools: "auto" });
    });
    expect(getLaunchPosture).toHaveBeenCalled();
  });

  it("on a refusal changes nothing and surfaces main's own sentence", async () => {
    setLaunchPosture.mockResolvedValue({
      ok: false,
      rejected: ['"accept_edits" is not a tool setting Codex offers'],
    });
    const { result } = await channelHook();
    getLaunchPosture.mockClear();
    await act(async () => {
      await result.current.update({ tools: "accept_edits" });
    });
    // Main fails closed before the store: nothing to re-read, nothing to revert.
    expect(getLaunchPosture).not.toHaveBeenCalled();
    expect(result.current.rejected).toEqual(['"accept_edits" is not a tool setting Codex offers']);
    expect(result.current.recordFor("claude").tools).toBe("accept_edits");
  });

  it("keeps the last good reply when the re-read after a write fails", async () => {
    const { result } = await channelHook();
    getLaunchPosture.mockRejectedValueOnce(new Error("ipc down"));
    await act(async () => {
      await result.current.update({ tools: "auto" });
    });
    expect(result.current.runtimeSupported).toBe(true);
    expect(result.current.recordFor("claude").tools).toBe("accept_edits");
    expect(result.current.busy).toBe(false);
  });

  it("a THROWING write settles as not applied rather than rejecting the caller", async () => {
    setLaunchPosture.mockRejectedValueOnce(new Error("ipc down"));
    const { result } = await channelHook();
    await act(async () => {
      await expect(result.current.update({ tools: "auto" })).resolves.toBeUndefined();
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.recordFor("claude").tools).toBe("accept_edits");
  });
});

// A defaults write is the whole record and carries `v`: without it `agent-defaults.js › normalizeDefaults`
// reads it as legacy and drops every other runtime's record.
describe("the DEFAULTS scope", () => {
  it("writes the WHOLE record, carrying `v` so main does not read it as legacy", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ runtime: "codex" });
    });
    const sent = setAgentDefaults.mock.calls[0][0];
    expect(sent.v).toBe(2);
    expect(sent.runtime).toBe("codex");
    expect(sent.messages).toBe("ask");
    expect(sent.agentChain).toBe(false);
  });

  it("carries EVERY runtime's record through a write that names one", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ runtime: "codex", tools: "never" });
    });
    const sent = setAgentDefaults.mock.calls[0][0];
    expect(sent.byRuntime.claude).toEqual({ tools: "accept_edits" });
    expect(sent.byRuntime.codex.tools).toBe("never");
    // The native bag survives a tools-only write…
    expect(sent.byRuntime.codex.native).toEqual({ sandbox_mode: "read-only" });
    // …and no model is written at either level.
    expect("model" in sent).toBe(false);
    expect(JSON.stringify(sent.byRuntime)).not.toContain("model");
  });

  it("NEVER writes a channel's record — the write-once seed is the only inheritance point", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ runtime: "codex" });
      await result.current.update({ agentChain: true });
    });
    expect(setLaunchPosture).not.toHaveBeenCalled();
  });

  it("with NO runtime picked, files the edit under the DEFAULT runtime's key main reads", async () => {
    // Main's `activeRecord` reads `byRuntime[runtime || defaultId]`; a `byRuntime[""]` key is never read.
    const { result } = await defaultsHook();
    expect(result.current.runtime).toBe("");
    await act(async () => {
      await result.current.update({ tools: "auto" });
    });
    const sent = setAgentDefaults.mock.calls[0][0];
    expect(sent.runtime).toBe("");
    expect(sent.byRuntime[REAL_DEFAULT_RUNTIME].tools).toBe("auto");
    expect(Object.keys(sent.byRuntime)).not.toContain("");
    expect(sent.byRuntime.codex).toEqual({ native: { sandbox_mode: "read-only" } });
  });

  it("carries the chaining flag, which is this record's and not a channel's", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ agentChain: true });
    });
    expect(setAgentDefaults.mock.calls[0][0].agentChain).toBe(true);
  });
});
