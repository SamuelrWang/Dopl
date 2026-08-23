// @vitest-environment jsdom
/**
 * ORCHESTRATOR LAUNCHES — the per-machine switch that lets the operator's own
 * EXTERNAL Claude session start agents on this Mac (2026-08-22).
 *
 * The properties that fail SILENTLY, which is what this file is for:
 *
 *  - **OFF IS THE ONLY SAFE WRONG ANSWER.** The flag decides whether something
 *    outside this app may spawn agents that run with real tool profiles on the
 *    operator's machine. "Could not ask", "not answered yet", "answered with a
 *    shape this build does not recognise" and "the write was refused" must ALL
 *    read OFF — a switch that drifts ON is a capability nobody granted.
 *  - **A HALF-PRESENT BRIDGE IS NOT A BRIDGE.** "Has the getter, has no setter"
 *    is a real build shape while this ships, and a row that can read but not
 *    write is worse than no row: it shows a switch that silently does nothing.
 *  - **IT IS PER-MACHINE.** No `channelId` reaches it, so switching channels
 *    must not re-read it. A future refactor that keys this by channel would give
 *    one store key N surfaces that disagree.
 *  - ⚠ **THE BRIDGE SHAPE IS ASSUMED, NOT DECLARED** (see the hook's header) —
 *    the desktop ops had not landed when this shipped. These cases pin the shape
 *    this tree CALLS, so the day the real one lands, a mismatch is a red test
 *    rather than a dead switch.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
  useOrchestratorLaunch,
  type OrchestratorLaunchState,
} from "./use-orchestrator-launch";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function installBridge(over: Record<string, unknown> = {}) {
  const get = vi.fn().mockResolvedValue({ enabled: false });
  const set = vi.fn().mockResolvedValue({ ok: true });
  const orchestratorLaunch = { get, set, ...over };
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    orchestratorLaunch,
  };
  return orchestratorLaunch as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
}

/** Publishes from an effect — a render-phase write trips `react-hooks/immutability`. */
async function mount() {
  const holder: { value: OrchestratorLaunchState | null } = { value: null };
  function Probe() {
    const state = useOrchestratorLaunch();
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

describe("the bridge detection — capability-keyed, never truthiness", () => {
  it("is absent in a plain browser, so the row never renders", async () => {
    const state = await mount();
    expect(state.value?.bridge).toBeNull();
    expect(state.value?.enabled).toBe(false);
  });

  /** ⚠ The legacy wrapper's partial `window.dopl` must never read as a bridge. */
  it("is absent on a desktop whose main has no such member", async () => {
    (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn(), channels: {} };
    const state = await mount();
    expect(state.value?.bridge).toBeNull();
  });

  it("refuses a HALF-PRESENT member — a switch that cannot write is not a switch", async () => {
    installBridge({ set: undefined });
    expect((await mount()).value?.bridge).toBeNull();
    cleanup();
    installBridge({ get: undefined });
    expect((await mount()).value?.bridge).toBeNull();
  });

  it("takes a member carrying BOTH ops", async () => {
    installBridge();
    expect((await mount()).value?.bridge).not.toBeNull();
  });
});

describe("the stored flag — every unknown reads OFF", () => {
  it("mirrors a stored ON", async () => {
    installBridge({ get: vi.fn().mockResolvedValue({ enabled: true }) });
    expect((await mount()).value?.enabled).toBe(true);
  });

  it("reads a REJECTED get as OFF, never as unchanged", async () => {
    installBridge({ get: vi.fn().mockRejectedValue(new Error("no ipc")) });
    expect((await mount()).value?.enabled).toBe(false);
  });

  /** ⚠ THE SHAPE GUESS'S OWN FAILURE MODE. If the landed op answers something
   *  else, a truthy read would turn the capability ON off a value that never
   *  said so — hence the strict `=== true`. */
  it("reads an UNRECOGNISED answer shape as OFF", async () => {
    for (const answer of [undefined, null, {}, { enabled: "yes" }, true]) {
      installBridge({ get: vi.fn().mockResolvedValue(answer) });
      expect((await mount()).value?.enabled).toBe(false);
      cleanup();
    }
  });

  it("reads it ONCE per mount and passes no channel — it is per-machine", async () => {
    const ops = installBridge();
    await mount();
    expect(ops.get).toHaveBeenCalledTimes(1);
    expect(ops.get).toHaveBeenCalledWith();
  });
});

describe("the write — optimistic, and it REVERTS on a refusal", () => {
  it("stores ON and keeps it when main confirms", async () => {
    const ops = installBridge();
    const state = await mount();
    await act(async () => {
      await state.value?.update(true);
    });
    expect(ops.set).toHaveBeenCalledWith(true);
    expect(state.value?.enabled).toBe(true);
  });

  /** ⚠ THE CASE THE WHOLE REVERT EXISTS FOR: a switch left reading ON over a
   *  store that says OFF tells the operator they granted something they did not. */
  it("REVERTS to OFF when main refuses the write", async () => {
    const ops = installBridge({ set: vi.fn().mockResolvedValue({ ok: false }) });
    const state = await mount();
    await act(async () => {
      await state.value?.update(true);
    });
    expect(ops.set).toHaveBeenCalledWith(true);
    expect(state.value?.enabled).toBe(false);
  });

  it("REVERTS when the write throws", async () => {
    installBridge({ set: vi.fn().mockRejectedValue(new Error("no ipc")) });
    const state = await mount();
    await act(async () => {
      await state.value?.update(true);
    });
    expect(state.value?.enabled).toBe(false);
  });

  it("REVERTS an unrecognised answer shape — silence is not consent", async () => {
    installBridge({ set: vi.fn().mockResolvedValue(undefined) });
    const state = await mount();
    await act(async () => {
      await state.value?.update(true);
    });
    expect(state.value?.enabled).toBe(false);
  });

  /** ⚠ Turning it OFF must survive the same paths — a refused DISABLE reverts to
   *  ON, because the capability really is still granted. */
  it("reverts a refused DISABLE back to ON", async () => {
    installBridge({
      get: vi.fn().mockResolvedValue({ enabled: true }),
      set: vi.fn().mockResolvedValue({ ok: false }),
    });
    const state = await mount();
    await act(async () => {
      await state.value?.update(false);
    });
    expect(state.value?.enabled).toBe(true);
  });

  it("writes nothing at all without a bridge", async () => {
    const state = await mount();
    await act(async () => {
      await state.value?.update(true);
    });
    expect(state.value?.enabled).toBe(false);
  });
});
