// Codex effort in the New Agent dialog (2026-10-08): the control is read ENTIRELY off the live catalog
// (no per-runtime table, no effort list), and only a pick the operator made rides the launch.
import { describe, expect, it } from "vitest";
import { dimensionRowsFor } from "./launch-agent-dialog-state";
import { launchWithIdentity } from "./use-agent-launch-run";
import type { ModelCatalog } from "../lib/model-catalog";
import type { AgentLaunchPanel } from "./use-agent-launch";
import type { AgentLaunchControls } from "./use-agents-panel";

const opt = (value: string) => ({ value, label: value, description: null });
const catalog: ModelCatalog = {
  runtime: "codex",
  source: "live",
  status: "ready",
  reason: "",
  defaultId: "m1",
  dimensions: ["reasoningEffort"],
  truncated: false,
  models: [
    { id: "m1", label: "M1", short: "M1", isDefault: true, hidden: false, aliases: [],
      dimensions: { reasoningEffort: { options: [opt("low"), opt("high"), opt("telepathic")], default: "low" } } },
    { id: "m2", label: "M2", short: "M2", isDefault: false, hidden: false, aliases: [], dimensions: {} },
  ],
};

describe("dimensionRowsFor", () => {
  it("offers exactly the shown model's values — a level Dopl never heard of included", () => {
    const [row] = dimensionRowsFor(catalog, "m1", {});
    expect(row.key).toBe("reasoningEffort");
    expect(row.label).toBe("Reasoning effort");
    expect(row.options.map((o) => o.key)).toEqual(["", "low", "high", "telepathic"]);
    expect(row.options[0].label).toBe("Default (low)");
    expect(row.value).toBe("");
  });

  it("no pick = the catalog's default model; a model with no efforts shows no control", () => {
    expect(dimensionRowsFor(catalog, "", {})).toHaveLength(1);
    expect(dimensionRowsFor(catalog, "m2", { reasoningEffort: "high" })).toEqual([]);
  });

  it("a pick the shown model does not offer reads as Default; an unready catalog shows nothing", () => {
    expect(dimensionRowsFor(catalog, "m1", { reasoningEffort: "warp" })[0].value).toBe("");
    expect(dimensionRowsFor(catalog, "m1", { reasoningEffort: "high" })[0].value).toBe("high");
    expect(dimensionRowsFor({ ...catalog, status: "loading" }, "m1", {})).toEqual([]);
    expect(dimensionRowsFor(null, "m1", {})).toEqual([]);
  });
});

describe("the launch payload", () => {
  const panel = (dimensions: Record<string, string>) =>
    ({ model: "", runtime: "", identityId: null, instructions: "", instructionsBaseline: "", dimensions } as unknown as AgentLaunchPanel);
  const capture = () => {
    const seen: unknown[] = [];
    const newAgent = {
      launchAgent: async (_t: unknown, _i: unknown, overrides: unknown) => { seen.push(overrides); return { ok: false, reason: "busy" }; },
    } as unknown as AgentLaunchControls;
    return { seen, newAgent };
  };

  it("carries only the picks the operator made; none = a one-click launch payload", async () => {
    const a = capture();
    await launchWithIdentity(a.newAgent, panel({ reasoningEffort: "high" }), null, "codex");
    expect(a.seen[0]).toEqual({ dimensions: { reasoningEffort: "high" } });
    const b = capture();
    await launchWithIdentity(b.newAgent, panel({}), null, "codex");
    expect(b.seen[0]).toBeUndefined();
  });
});
