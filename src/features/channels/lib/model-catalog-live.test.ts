/**
 * THE CLAUDE ROSTER WENT LIVE (2026-09-22) — what the web side must do with it.
 *
 * Samuel: *"if claude or codex add a new model, would dopl auto mark those as options"*. The
 * desktop now sends the CLI's own `supportedModels()` roster (`dopl-desktop-app/main/runtime/
 * claude/roster.js`), so the web must:
 *
 *   • render WHATEVER the catalog sends — a model this bundle has never heard of included;
 *   • label with the runtime's own display name, and a model with none by its raw id (never hidden);
 *   • find a legacy stored id through the entry's `aliases`, so an old pick shows as ONE option;
 *   • keep the frozen `agent-models.ts` list as the older-desktop fallback only.
 */

import { describe, expect, it } from "vitest";
import {
  canSelectModel,
  catalogSelection,
  findModel,
  modelLabel,
  modelOptionsFor,
  modelShortLabel,
  normalizeCatalogs,
} from "./model-catalog";
import { agentModelLabel, agentModelShortLabel, rememberCatalogs } from "./agent-models";
import { modelBelongsTo } from "./model-affinity";

// ⚠ The shape the desktop sends for the MEASURED roster (2026-09-22), plus one model no table has.
const WIRE = {
  claude: {
    runtime: "claude",
    source: "live",
    status: "ready",
    reason: "",
    models: [
      { id: "claude-opus-5[1m]", label: "Opus (1M context)", short: "Opus", isDefault: false, hidden: false, dimensions: {}, aliases: ["opus[1m]", "claude-opus-5", "opus"] },
      { id: "claude-sonnet-5", label: "Sonnet", short: "Sonnet", isDefault: true, hidden: false, dimensions: {}, aliases: ["sonnet"] },
      { id: "claude-opus-6[1m]", label: null, short: null, isDefault: false, hidden: false, dimensions: {} },
    ],
    defaultId: "claude-sonnet-5",
    dimensions: [],
    truncated: false,
  },
};
const catalog = normalizeCatalogs(WIRE).claude;

describe("the live Claude roster, on the web", () => {
  it("offers every model the desktop sends, including one this bundle has never heard of", () => {
    expect(modelOptionsFor(catalog, "").map((o) => o.value)).toEqual([
      "claude-opus-5[1m]",
      "claude-sonnet-5",
      "claude-opus-6[1m]",
    ]);
    expect(canSelectModel(catalog, "claude-opus-6[1m]")).toBe(true);
  });

  it("labels by the runtime's own name, and an unnamed model by its raw id — never hidden", () => {
    expect(modelLabel(catalog, "claude-opus-5[1m]")).toBe("Opus (1M context)");
    expect(modelLabel(catalog, "claude-opus-6[1m]")).toBe("claude-opus-6[1m]");
    expect(modelShortLabel(catalog, "claude-opus-6[1m]")).toBe("claude-opus-6[1m]");
    expect(modelOptionsFor(catalog, "").find((o) => o.value === "claude-opus-6[1m]")?.label).toBe("claude-opus-6[1m]");
  });

  it("finds a LEGACY stored id through the entry's aliases — one option, not two", () => {
    expect(findModel(catalog, "claude-opus-5")?.id).toBe("claude-opus-5[1m]");
    expect(catalogSelection(catalog, "claude-opus-5")).toBe("claude-opus-5[1m]");
    expect(modelOptionsFor(catalog, "claude-opus-5")).toHaveLength(3); // no extra raw row appended
    expect(canSelectModel(catalog, "opus")).toBe(true);
    expect(modelBelongsTo(catalog, "claude-opus-5")).toBe(true);
    expect(modelLabel(catalog, "claude-opus-5")).toBe("Opus (1M context)");
  });

  it("an id nobody lists is still shown as itself and is not selectable", () => {
    expect(catalogSelection(catalog, "claude-from-the-future-9")).toBe("claude-from-the-future-9");
    expect(canSelectModel(catalog, "claude-from-the-future-9")).toBe(false);
    expect(modelOptionsFor(catalog, "claude-from-the-future-9").at(-1)).toEqual({
      value: "claude-from-the-future-9",
      label: "claude-from-the-future-9",
    });
  });

  it("glance labels (cards, chips) prefer the runtime's own name once any catalog was read", () => {
    expect(agentModelShortLabel("claude-opus-5[1m]")).toBe("claude-opus-5[1m]"); // nothing read yet
    rememberCatalogs(normalizeCatalogs(WIRE));
    expect(agentModelShortLabel("claude-opus-5[1m]")).toBe("Opus");
    expect(agentModelLabel("claude-opus-5[1m]")).toBe("Opus (1M context)");
    expect(agentModelShortLabel("claude-opus-6[1m]")).toBe("claude-opus-6[1m]"); // unnamed → raw id
    expect(agentModelShortLabel("gpt-6-luna")).toBe("gpt-6-luna"); // no catalog lists it → itself
  });
});
