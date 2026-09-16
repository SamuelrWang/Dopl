// @vitest-environment jsdom
/**
 * ORCHESTRATOR DIRECTIONS — the per-machine switch that lets the operator's own
 * EXTERNAL Claude session send PRIVATE INSTRUCTIONS to agents already running on
 * this Mac (lane 2026-08-31, control 2026-09-16).
 *
 * ⚠ **THIS FILE IS THE ONE THAT DID NOT EXIST, AND ITS ABSENCE IS THE BUG.** The
 * lane shipped with a store key, an IPC pair and a preload bridge, and nothing in
 * the SPA ever called them — so `orchestratorDirectEnabled` was never written, the
 * consent read `false` forever, and 38 of 38 private directions filed between
 * 2026-08-31 and 2026-09-15 expired unclaimed with no cause reported to anyone.
 * `DIRECTION-DROP-TRACE.md` carries the trace;
 * `scripts/check-bridge-caller-drift.mjs` is what makes the absence fail a build.
 *
 * The properties that fail SILENTLY, which is what this file is for:
 *
 *  - **OFF IS THE ONLY SAFE WRONG ANSWER.** The flag decides whether something
 *    outside this app may start a TURN inside an agent already running here.
 *    "Could not ask", "not answered yet", "answered with a shape this build does
 *    not recognise" and "the write was refused" must ALL read OFF — a switch that
 *    drifts ON is a capability nobody granted.
 *  - **A HALF-PRESENT BRIDGE IS NOT A BRIDGE.** "Has the getter, has no setter" is
 *    a real build shape while this ships, and a row that can read but not write is
 *    worse than no row: it shows a switch that silently does nothing.
 *  - **IT IS PER-MACHINE.** No `channelId` reaches it, so switching channels must
 *    not re-read it.
 *  - ⚠ **IT IS A SEPARATE GRANT FROM `orchestratorLaunch`.** These cases install
 *    ONLY this member, so a hook that quietly read the launch flag instead — the
 *    obvious refactor, and the wrong one — goes red here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
  useOrchestratorDirect,
  type OrchestratorDirectState,
} from "./use-orchestrator-direct";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function installBridge(over: Record<string, unknown> = {}) {
  const get = vi.fn().mockResolvedValue({ enabled: false });
  const set = vi.fn().mockResolvedValue({ ok: true });
  const orchestratorDirect = { get, set, ...over };
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    orchestratorDirect,
  };
  return orchestratorDirect as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
}

/** Publishes from an effect — a render-phase write trips `react-hooks/immutability`. */
async function mount() {
  const holder: { value: OrchestratorDirectState | null } = { value: null };
  function Probe() {
    const state = useOrchestratorDirect();
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
    // ⚠ INCLUDES A FULLY-FORMED `orchestratorLaunch`: the two consents are separate
    // grants, so a main carrying only the LAUNCH pair must read as NO bridge here.
    // Folding the two hooks into one would make this case pass while granting a
    // capability the operator never armed.
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      channels: {},
      orchestratorLaunch: { get: vi.fn(), set: vi.fn() },
    };
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
