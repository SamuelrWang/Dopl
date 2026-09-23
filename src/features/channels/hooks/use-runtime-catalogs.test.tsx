// @vitest-environment jsdom
/**
 * THE MODEL CATALOG ON A SETTINGS READ (U6, 2026-09-21) — `use-runtime-catalogs.ts`, and the two
 * hook this file drives (`use-channel-launch-posture.ts`; `use-launch-selection.ts` has its own suite).
 *
 * THE PROPERTY THIS FILE EXISTS FOR:
 *
 *   🔒 **THE MODEL ROW'S SOURCE IS NOW THE SELECTED RUNTIME'S CATALOG.** Before U6 every surface
 *      read `lib/agent-models.ts` — four CLAUDE ids — whatever runtime was selected, so picking
 *      Codex offered Fable. These cases assert that a Codex-selected hook hands out CODEX models
 *      and that a Codex failure hands out NOTHING rather than Claude's list.
 *
 * AND THE THREE-STATE PROBE THAT MAKES AN OLDER DESKTOP SAFE: no `catalogs` key (a build that
 * predates the contract) is NOT the same answer as `catalogs: {}` (this build, no adapters).
 * Reading the first as "no models" empties the picker on a machine that works perfectly.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
  useChannelLaunchPosture,
  type ChannelLaunchPostureState,
} from "./use-channel-launch-posture";
import { CATALOG_VERSION, selectableModels } from "../lib/model-catalog";
import { MAIN_ROSTER_SETTLE_MS, MAX_RELOADS, RELOAD_DELAY_MS } from "./use-runtime-catalogs";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as { dopl?: unknown }).dopl;
});

const CH = "44444444-4444-4444-8444-444444444444";

const CLAUDE_IDS = [
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
];

/** Two minimal descriptors — enough for `normalizeRuntimes` / `descriptorFor`. */
const RUNTIMES = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex", models: { source: "live", dimensions: ["reasoningEffort"] } },
];

const codexCatalog = (over: Record<string, unknown> = {}) => ({
  runtime: "codex",
  source: "live",
  status: "ready",
  reason: "",
  models: [
    {
      id: "gpt-a",
      label: "GPT Alpha",
      short: "GPT Alpha",
      isDefault: true,
      hidden: false,
      dimensions: {
        reasoningEffort: {
          options: [{ value: "medium", label: "medium", description: null }],
          default: "medium",
        },
      },
    },
  ],
  defaultId: "gpt-a",
  dimensions: ["reasoningEffort"],
  truncated: false,
  ...over,
});

const claudeCatalog = {
  runtime: "claude",
  source: "frozen",
  status: "ready",
  reason: "",
  models: CLAUDE_IDS.map((id) => ({
    id,
    label: id,
    short: id,
    isDefault: id === "claude-sonnet-5",
    hidden: false,
    dimensions: {},
  })),
  defaultId: "claude-sonnet-5",
  dimensions: [],
  truncated: false,
};

/** Install a bridge whose posture read answers `reply`. A function is called per read. */
function installBridge(reply: unknown | (() => unknown)) {
  const read = () => (typeof reply === "function" ? (reply as () => unknown)() : reply);
  const getLaunchPosture = vi.fn().mockImplementation(async () => read());
  const setLaunchPosture = vi.fn().mockResolvedValue({ ok: true });
  const getAgentDefaults = vi.fn().mockImplementation(async () => read());
  const setAgentDefaults = vi.fn().mockResolvedValue({ ok: true });
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    channels: { getLaunchPosture, setLaunchPosture, getAgentDefaults, setAgentDefaults },
  };
  return { getLaunchPosture, getAgentDefaults };
}

/** Publishes from an effect — a render-phase write trips `react-hooks/immutability`. */
async function mount<T>(use: () => T) {
  const holder: { value: T | null } = { value: null };
  function Probe() {
    const state = use();
    useEffect(() => {
      holder.value = state;
    });
    return null;
  }
  await act(async () => {
    render(<Probe />);
  });
  return holder as { value: T };
}

const mountPosture = () =>
  mount<ChannelLaunchPostureState>(() => useChannelLaunchPosture(CH));

const reply = (over: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = {
    runtime: "codex",
    runtimes: RUNTIMES,
    defaultRuntime: "claude",
    connected: ["claude"],
    catalogVersion: CATALOG_VERSION,
    catalogs: { claude: claudeCatalog, codex: codexCatalog() },
    ...over,
  };
  // The channel's pick rides the versioned record, as every current reply carries it.
  return { ...row, selection: { v: 2, runtime: row.runtime, messages: "ask", byRuntime: {} } };
};

describe("🔒 the selected runtime's catalog is what the model row gets", () => {
  it("Codex selected ⇒ Codex models, and NOT ONE Claude id", async () => {
    installBridge(reply());
    const holder = await mountPosture();
    expect(holder.value.catalog?.runtime).toBe("codex");
    const ids = selectableModels(holder.value.catalog).map((m) => m.id);
    expect(ids).toEqual(["gpt-a"]);
    for (const id of ids) expect(CLAUDE_IDS).not.toContain(id);
  });

  it("no pick ⇒ the DEFAULT runtime's catalog, because that is what a launch would use", async () => {
    installBridge(reply({ runtime: "" }));
    const holder = await mountPosture();
    expect(holder.value.catalog?.runtime).toBe("claude");
    expect(selectableModels(holder.value.catalog).map((m) => m.id)).toEqual(CLAUDE_IDS);
  });

  it("a Codex catalog that FAILED offers nothing, and never the default runtime's list", async () => {
    installBridge(reply({
      catalogs: {
        claude: claudeCatalog,
        codex: codexCatalog({
          status: "unavailable",
          models: [],
          defaultId: null,
          reason: "`codex` is not installed where Dopl can find it.",
        }),
      },
    }));
    const holder = await mountPosture();
    expect(holder.value.catalog?.status).toBe("unavailable");
    expect(selectableModels(holder.value.catalog)).toEqual([]);
    expect(holder.value.catalog?.reason).toMatch(/not installed/);
    // ⚠ THE NEIGHBOUR IS UNTOUCHED: one runtime's outage is not the map's.
    expect(holder.value.catalogs.claude.status).toBe("ready");
  });
});

describe("an OLDER desktop is not read as 'no models'", () => {
  it("no `catalogs` key ⇒ the DEFAULT runtime falls back to the frozen list", async () => {
    // ⚠ THE FALLBACK IS THE ONE THIS BUILD RENDERS ANYWAY on such a desktop. Reading the absent
    // key as an empty catalog would empty the picker on a machine that works perfectly.
    installBridge({
      tools: "manual", messages: "ask",
      runtime: "", runtimes: RUNTIMES, defaultRuntime: "claude", connected: [],
    });
    const holder = await mountPosture();
    expect(holder.value.catalog?.source).toBe("frozen");
    expect(selectableModels(holder.value.catalog).map((m) => m.id)).toEqual(CLAUDE_IDS);
  });

  it("🔒 …and a NON-default runtime on that desktop gets NOTHING, never Claude's list", async () => {
    installBridge({
      runtimes: RUNTIMES, defaultRuntime: "claude", connected: [],
      selection: { v: 2, runtime: "codex", messages: "ask", byRuntime: {} },
    });
    const holder = await mountPosture();
    expect(holder.value.catalog).toBeNull();
    expect(selectableModels(holder.value.catalog)).toEqual([]);
  });

  it("`catalogs: {}` is a DIFFERENT answer — this build said, and registered nothing", async () => {
    installBridge(reply({ catalogs: {}, runtime: "" }));
    const holder = await mountPosture();
    // ⚠ NO FALLBACK HERE: the desktop answered. Substituting the frozen list would claim four
    // models on a machine that reported none.
    expect(holder.value.catalog).toBeNull();
  });
});

describe("a `loading` roster is re-read, boundedly", () => {
  it("re-reads until the catalog settles, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let settled = false;
    const { getLaunchPosture } = installBridge(() =>
      reply({
        catalogs: {
          claude: claudeCatalog,
          codex: settled
            ? codexCatalog()
            : codexCatalog({ status: "loading", models: [], defaultId: null }),
        },
      }));
    const holder = await mountPosture();
    expect(holder.value.catalog?.status).toBe("loading");
    // ⚠ `loading` CARRIES NO SENTENCE: nothing was attempted, so there is nothing to explain.
    expect(holder.value.catalog?.reason).toBe("");
    const first = getLaunchPosture.mock.calls.length;

    settled = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(holder.value.catalog?.status).toBe("ready");
    expect(getLaunchPosture.mock.calls.length).toBeGreaterThan(first);

    // Once everything is settled the re-read stops — it is a hand-off, not a standing timer.
    const after = getLaunchPosture.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(getLaunchPosture.mock.calls.length).toBe(after);
  });

  it("gives up after a bounded number of tries, and STAYS `loading` rather than inventing a failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { getLaunchPosture } = installBridge(() =>
      reply({
        catalogs: {
          codex: codexCatalog({ status: "loading", models: [], defaultId: null }),
        },
      }));
    const holder = await mountPosture();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    // ⚠ "NOTHING CAME BACK YET" IS THE TRUE STATEMENT. Flipping to `unavailable` here would put
    // words in the desktop's mouth about a read it never reported failing (INVARIANTS §11).
    expect(holder.value.catalog?.status).toBe("loading");
    expect(getLaunchPosture.mock.calls.length).toBeLessThanOrEqual(1 + MAX_RELOADS + 1);
  });

  it("F3: the re-read budget outlasts main's own roster leash (probe + model/list)", () => {
    expect(MAX_RELOADS * RELOAD_DELAY_MS).toBeGreaterThan(MAIN_ROSTER_SETTLE_MS);
  });

  /** Advance in small steps, each its own `act`, so every reload's state lands before the next. */
  async function advance(ms: number) {
    for (let t = 0; t < ms; t += 300) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
    }
  }

  it("F3: a roster that settles at ~12s (past the old 7.2s budget) still reaches the picker", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let settled = false;
    installBridge(() =>
      reply({
        catalogs: {
          codex: settled ? codexCatalog() : codexCatalog({ status: "loading", models: [], defaultId: null }),
        },
      }));
    const holder = await mountPosture();
    await advance(12000);
    expect(holder.value.catalog?.status).toBe("loading");
    settled = true;
    await advance(2400);
    expect(holder.value.catalog?.status).toBe("ready");
  });

  it("F3: once the budget is spent, window focus re-reads a catalog that is STILL loading", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let settled = false;
    const { getLaunchPosture } = installBridge(() =>
      reply({
        catalogs: {
          codex: settled ? codexCatalog() : codexCatalog({ status: "loading", models: [], defaultId: null }),
        },
      }));
    const holder = await mountPosture();
    await advance(MAX_RELOADS * RELOAD_DELAY_MS + 3000);
    expect(holder.value.catalog?.status).toBe("loading");
    const spent = getLaunchPosture.mock.calls.length;
    expect(spent, "the whole budget was spent, then it stopped").toBe(1 + MAX_RELOADS);
    await advance(5000);
    expect(getLaunchPosture.mock.calls.length, "no standing timer after the budget").toBe(spent);
    settled = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getLaunchPosture.mock.calls.length).toBeGreaterThan(spent);
    expect(holder.value.catalog?.status).toBe("ready");
  });
});

describe("🔒 a SETTLED failure recovers after repair, with no restart (CXP-5)", () => {
  const failed = () =>
    codexCatalog({
      status: "unavailable",
      models: [],
      defaultId: null,
      reason: "`codex` is not installed where Dopl can find it.",
    });

  it("unavailable → (window focus) → loading → ready, and never one Claude id on the way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let phase: "failed" | "retrying" | "ready" = "failed";
    const { getLaunchPosture } = installBridge(() =>
      reply({
        catalogs: {
          claude: claudeCatalog,
          codex:
            phase === "failed"
              ? failed()
              : phase === "retrying"
                ? codexCatalog({ status: "loading", models: [], defaultId: null })
                : codexCatalog(),
        },
      }));
    const holder = await mountPosture();
    const noClaude = () => {
      for (const m of holder.value.catalog?.models ?? []) expect(CLAUDE_IDS).not.toContain(m.id);
      for (const m of selectableModels(holder.value.catalog)) expect(CLAUDE_IDS).not.toContain(m.id);
    };
    expect(holder.value.catalog?.status).toBe("unavailable");
    noClaude();

    // Settled: no timer re-reads a failure on its own.
    const settledCalls = getLaunchPosture.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(getLaunchPosture.mock.calls.length).toBe(settledCalls);

    // The operator repairs Codex in a terminal and comes back to the window.
    phase = "retrying";
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getLaunchPosture.mock.calls.length).toBeGreaterThan(settledCalls);
    expect(holder.value.catalog?.status).toBe("loading");
    expect(holder.value.catalog?.runtime).toBe("codex");
    noClaude();

    phase = "ready";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(holder.value.catalog?.status).toBe("ready");
    expect(selectableModels(holder.value.catalog).map((m) => m.id)).toEqual(["gpt-a"]);
    noClaude();
  });

  it("a READY map does not listen for focus — the re-read is for failures only", async () => {
    const { getLaunchPosture } = installBridge(reply());
    await mountPosture();
    const calls = getLaunchPosture.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(getLaunchPosture.mock.calls.length).toBe(calls);
  });
});
