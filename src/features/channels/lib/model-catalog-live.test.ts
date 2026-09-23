/** The live Claude roster (`dopl-desktop-app/main/runtime/claude/roster.js`) as the web reads it. */

import { describe, expect, it } from "vitest";
import {
  catalogSelection,
  findModel,
  modelLabel,
  modelOptionsFor,
  normalizeCatalogs,
  selectableModels,
} from "./model-catalog";
import { agentModelLabel, agentModelShortLabel } from "./agent-models";
import { modelBelongsTo } from "./model-affinity";
import { wireCatalog } from "../hooks/launch-selection-harness";

// The desktop's measured roster shape, plus one model no table names.
const WIRE = {
  claude: wireCatalog("claude", [
    { id: "claude-opus-5[1m]", label: "Opus (1M context)", short: "Opus", aliases: ["opus[1m]", "claude-opus-5", "opus"] },
    { id: "claude-sonnet-5", label: "Sonnet", isDefault: true, aliases: ["sonnet"] },
    { id: "claude-opus-6[1m]", label: null },
  ]),
};
const catalog = normalizeCatalogs(WIRE).claude;

describe("the live Claude roster, on the web", () => {
  it("offers every model the desktop sends, including one this bundle has never heard of", () => {
    expect(modelOptionsFor(catalog, "").map((o) => o.value)).toEqual([
      "claude-opus-5[1m]",
      "claude-sonnet-5",
      "claude-opus-6[1m]",
    ]);
    expect(selectableModels(catalog).map((m) => m.id)).toContain("claude-opus-6[1m]");
  });

  it("labels by the runtime's own name, and an unnamed model by its raw id — never hidden", () => {
    expect(modelLabel(catalog, "claude-opus-5[1m]")).toBe("Opus (1M context)");
    expect(modelLabel(catalog, "claude-opus-6[1m]")).toBe("claude-opus-6[1m]");
    expect(modelOptionsFor(catalog, "").find((o) => o.value === "claude-opus-6[1m]")?.label).toBe("claude-opus-6[1m]");
  });

  it("finds a LEGACY stored id through the entry's aliases — one option, not two", () => {
    expect(findModel(catalog, "claude-opus-5")?.id).toBe("claude-opus-5[1m]");
    expect(catalogSelection(catalog, "claude-opus-5")).toBe("claude-opus-5[1m]");
    expect(modelOptionsFor(catalog, "claude-opus-5")).toHaveLength(3); // no extra raw row appended
    expect(findModel(catalog, "opus")?.id).toBe("claude-opus-5[1m]");
    expect(modelBelongsTo(catalog, "claude-opus-5")).toBe(true);
    expect(modelLabel(catalog, "claude-opus-5")).toBe("Opus (1M context)");
  });

  it("an id nobody lists is still shown as itself and is not selectable", () => {
    expect(catalogSelection(catalog, "claude-from-the-future-9")).toBe("claude-from-the-future-9");
    expect(findModel(catalog, "claude-from-the-future-9")).toBeNull();
    expect(modelOptionsFor(catalog, "claude-from-the-future-9").at(-1)).toEqual({
      value: "claude-from-the-future-9",
      label: "claude-from-the-future-9",
    });
  });

  it("glance labels (cards, chips) use the runtime's own name from the catalogs they are handed", () => {
    // No module-level label cache: the same call with and without the catalogs.
    expect(agentModelShortLabel("claude-opus-5[1m]")).toBe("claude-opus-5[1m]");
    const catalogs = normalizeCatalogs(WIRE);
    expect(agentModelShortLabel("claude-opus-5[1m]", catalogs)).toBe("Opus");
    expect(agentModelLabel("claude-opus-5[1m]", catalogs)).toBe("Opus (1M context)");
    expect(agentModelShortLabel("claude-opus-5[1m]")).toBe("claude-opus-5[1m]"); // nothing remembered
    expect(agentModelShortLabel("claude-opus-6[1m]", catalogs)).toBe("claude-opus-6[1m]"); // unnamed → raw id
    expect(agentModelShortLabel("gpt-6-luna", catalogs)).toBe("gpt-6-luna"); // no catalog lists it → itself
  });
});
