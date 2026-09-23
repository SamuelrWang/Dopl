// @vitest-environment jsdom
/**
 * THE DURABLE LAUNCH SELECTION AT BOTH SCOPES — the two persistence contracts, and the three
 * ways a write can end (2026-09-21, U7/U8).
 *
 * The properties here, every one of which fails silently:
 *
 *  - **A CHANNEL WRITE IS AN OWN-KEY PATCH.** Main leaves a key the caller did not send alone, so
 *    a control with no model concept must not restate one. The failure this closes is concrete:
 *    before U8 the preload coerced an absent `tools` to `''`, so a runtime-only write arrived as
 *    `{tools:'', messages:''}` and `patchRejections` REFUSED THE WHOLE THING — the row reverted
 *    with nothing on screen saying why.
 *  - **A DEFAULTS WRITE IS THE WHOLE RECORD, AND IT CARRIES `v` AND `byRuntime`.**
 *    `agent-defaults.js › normalizeDefaults` branches on `v == null` and reads a record without it
 *    as a pre-U5 LEGACY one — which migrates the single global `tools`/`model` into the DEFAULT
 *    runtime's slot and drops every other runtime's settings. A `v`-less write from this tab
 *    erased the operator's Codex model on every keystroke.
 *  - **PROFILE DEFAULTS NEVER TOUCH A CHANNEL.** Samuel's write-once ruling: the seed is
 *    `channels:applyAgentDefaults` at creation and nothing else. A defaults write that reached
 *    `setLaunchPosture` would re-point rooms the operator never opened.
 *  - **A REFUSED WRITE RE-ADOPTS WHAT IS STORED AND ECHOES NOTHING.** Main fails closed before the
 *    store, so there is no optimistic value to revert and no rejected value to display.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useLaunchSelection } from "./use-launch-selection";

const CHANNEL = "11111111-2222-3333-4444-555555555555";

const getLaunchPosture = vi.fn();
const setLaunchPosture = vi.fn();
const getAgentDefaults = vi.fn();
const setAgentDefaults = vi.fn();

/** What a current main answers. ⚠ The legacy keys AND the versioned record, additively —
 *  `channel-dir-ipc.js › channels:getLaunchPosture` is the statement of record. (No `model`
 *  since 2026-09-23 — the channel stores none.) */
const postureReply = (over: Record<string, unknown> = {}) => ({
  tools: "accept_edits",
  messages: "ask",
  runtime: "",
  runtimes: [{ id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex" }],
  defaultRuntime: "claude",
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
  runtimes: [{ id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex" }],
  defaultRuntime: "claude",
  connected: ["claude"],
  ...over,
});

beforeEach(() => {
  getLaunchPosture.mockReset().mockResolvedValue(postureReply());
  setLaunchPosture.mockReset().mockResolvedValue({ ok: true });
  getAgentDefaults.mockReset().mockResolvedValue(defaultsReply());
  setAgentDefaults.mockReset().mockResolvedValue({ ok: true });
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    channels: { getLaunchPosture, setLaunchPosture, getAgentDefaults, setAgentDefaults },
  };
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

async function channelHook() {
  const hook = renderHook(() => useLaunchSelection({ kind: "channel", channelId: CHANNEL }));
  await waitFor(() => expect(hook.result.current.supported).toBe(true));
  return hook;
}

async function defaultsHook() {
  const hook = renderHook(() => useLaunchSelection({ kind: "defaults" }));
  await waitFor(() => expect(hook.result.current.supported).toBe(true));
  return hook;
}

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
    // ⚠ NO RE-READ, because nothing was written — and no optimistic value to revert.
    expect(getLaunchPosture).not.toHaveBeenCalled();
    expect(result.current.rejected).toEqual(['"accept_edits" is not a tool setting Codex offers']);
    expect(result.current.recordFor("claude").tools).toBe("accept_edits");
  });

  it("reads an older desktop's legacy pair WITHOUT inventing per-runtime records", async () => {
    // ⚠ INVARIANTS §11 — the legacy reply describes the SELECTED runtime and nothing else, so
    // every other runtime answers EMPTY rather than borrowing it.
    getLaunchPosture.mockResolvedValue({
      tools: "auto",
      messages: "ask",
      model: "claude-opus-5", // ⚠ an OLDER desktop still sends it — it is NOT read (2026-09-23)
      runtime: "claude",
      runtimes: [{ id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex" }],
      defaultRuntime: "claude",
    });
    const hook = renderHook(() => useLaunchSelection({ kind: "channel", channelId: CHANNEL }));
    await waitFor(() => expect(hook.result.current.runtime).toBe("claude"));
    expect(hook.result.current.supported).toBe(false);
    expect(hook.result.current.recordFor("claude")).toEqual({ tools: "auto" });
    expect(hook.result.current.recordFor("codex")).toEqual({});
  });
});

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
    // Decision #1: editing Codex may not clear Claude, and vice versa.
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ runtime: "codex", tools: "never" });
    });
    const sent = setAgentDefaults.mock.calls[0][0];
    expect(sent.byRuntime.claude).toEqual({ tools: "accept_edits" });
    expect(sent.byRuntime.codex.tools).toBe("never");
    // ⚠ AND THE NATIVE BAG SURVIVES A TOOLS-ONLY WRITE.
    expect(sent.byRuntime.codex.native).toEqual({ sandbox_mode: "read-only" });
    // ⚠ AND NO MODEL IS WRITTEN, AT EITHER LEVEL (2026-09-23).
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

  it("carries the chaining flag, which is this record's and not a channel's", async () => {
    const { result } = await defaultsHook();
    await act(async () => {
      await result.current.update({ agentChain: true });
    });
    expect(setAgentDefaults.mock.calls[0][0].agentChain).toBe(true);
  });
});
