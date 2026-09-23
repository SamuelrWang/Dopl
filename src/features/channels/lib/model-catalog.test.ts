/** Miss and failure paths assert no Claude id, not merely emptiness. */

import { describe, expect, it } from "vitest";
import {
  CATALOG_VERSION,
  catalogFor,
  catalogReady,
  catalogReason,
  catalogSelection,
  dimensionDefaultFor,
  dimensionOptionsFor,
  modelLabel,
  modelOptionsFor,
  normalizeCatalogs,
  selectableModels,
} from "./model-catalog";
import { AGENT_MODELS } from "./agent-models";
import { catalog, wireCatalog } from "../hooks/launch-selection-harness";

const CLAUDE_IDS = AGENT_MODELS.map((m) => m.id);

const wire = (over: Record<string, unknown> = {}) => ({
  ...wireCatalog("codex", [
    {
      id: "gpt-a",
      label: "GPT Alpha",
      isDefault: true,
      efforts: ["low", "medium", "high"],
      effortDefault: "medium",
    },
    { id: "gpt-b", label: "GPT Beta", efforts: ["high"] },
    { id: "gpt-hidden", label: "GPT Hidden", short: null, hidden: true },
  ]),
  ...over,
});

const catalogs = (over: Record<string, unknown> = {}) =>
  normalizeCatalogs({ codex: wire(over) }, CATALOG_VERSION);

const codex = (over: Record<string, unknown> = {}) =>
  catalogFor(catalogs(over), "codex");

const noClaude = (ids: ReadonlyArray<string>) => {
  for (const id of ids) expect(CLAUDE_IDS).not.toContain(id);
};

describe("the wire, narrowed", () => {
  it("ignores a catalog VERSION this bundle does not know, rather than half-reading it", () => {
    expect(normalizeCatalogs({ codex: wire() }, CATALOG_VERSION + 1)).toEqual({});
  });

  it("narrows a bad shape instead of throwing, and drops a row with no id", () => {
    const list = normalizeCatalogs(
      { codex: wire({ models: [{ id: "" }, { id: "ok" }, null, "nope", { id: "ok" }] }) },
      CATALOG_VERSION
    );
    expect(catalogFor(list, "codex")?.models.map((m) => m.id)).toEqual(["ok"]);
    expect(normalizeCatalogs("not an object")).toEqual({});
    expect(normalizeCatalogs({ codex: 7 })).toEqual({});
  });

  it("reads an UNKNOWN status as `loading`, never as `ready`", () => {
    // A newer desktop's fifth state: `loading` offers and refuses nothing; `ready` or `unavailable`
    // would claim something nobody reported.
    const c = codex({ status: "quantum" });
    expect(c?.status).toBe("loading");
    expect(catalogReason(c)).toBeNull();
  });

  it("clears a defaultId that names no model it carries", () => {
    expect(codex({ defaultId: "gpt-gone" })?.defaultId).toBeNull();
  });
});

// `catalogFor` has no fallback arm: a miss (an older desktop's absent `catalogs` included) is null.
describe("no runtime borrows another's models", () => {
  it("a MISS answers null — there is no 'else' arm and no merge", () => {
    const list = catalogs();
    expect(catalogFor(list, "cursor")).toBeNull();
    expect(catalogFor(list, "")).toBeNull();
    expect(catalogFor(null, "codex")).toBeNull();
  });

  it("an UNAVAILABLE Codex catalog offers nothing, and nothing Claude-shaped", () => {
    const c = codex({
      status: "unavailable",
      models: [],
      defaultId: null,
      reason: "`codex` is not installed where Dopl can find it.",
    });
    expect(selectableModels(c)).toEqual([]);
    expect(modelOptionsFor(c, "")).toEqual([]);
    expect(catalogSelection(c, "")).toBe("");
    expect(catalogReason(c)).toMatch(/not installed/);
    noClaude(modelOptionsFor(c, "").map((o) => o.value));
  });
});

describe("the four states drive what may be picked", () => {
  it("READY offers the visible models, in the runtime's own order", () => {
    const c = codex();
    expect(catalogReady(c)).toBe(true);
    expect(selectableModels(c).map((m) => m.id)).toEqual(["gpt-a", "gpt-b"]);
    expect(modelOptionsFor(c, "")).toEqual([
      { value: "gpt-a", label: "GPT Alpha" },
      { value: "gpt-b", label: "GPT Beta" },
    ]);
  });

  it("a HIDDEN model is out of the picker and still LABELLED", () => {
    const c = codex();
    expect(selectableModels(c).map((m) => m.id)).not.toContain("gpt-hidden");
    expect(modelLabel(c, "gpt-hidden")).toBe("GPT Hidden");
  });

  it("LOADING explains nothing and offers nothing — it is not a failure", () => {
    const c = codex({ status: "loading", models: [], defaultId: null, reason: "" });
    expect(catalogReason(c)).toBeNull();
    expect(selectableModels(c)).toEqual([]);
  });

  it("STALE still LABELS and may not be newly SELECTED", () => {
    const c = codex({ status: "stale", reason: "the Codex CLI was upgraded" });
    expect(modelLabel(c, "gpt-a")).toBe("GPT Alpha");
    expect(selectableModels(c)).toEqual([]);
    expect(catalogReason(c)).toMatch(/upgraded/);
  });

  it("a READY catalog may carry a NOTE — the status is what is read, never the string", () => {
    const c = codex({ truncated: true, reason: "Codex's model list is unusual: no default." });
    expect(catalogReady(c)).toBe(true);
    expect(selectableModels(c)).toHaveLength(2);
    expect(catalogReason(c)).toMatch(/unusual/);
  });
});

describe("omission is the platform default — displayed, never persisted", () => {
  it("nothing stored SHOWS the runtime's declared default", () => {
    expect(catalogSelection(codex(), "")).toBe("gpt-a");
    expect(catalogSelection(codex(), null)).toBe("gpt-a");
  });

  it("a catalog with NO declared default shows nothing rather than guessing one", () => {
    expect(catalogSelection(codex({ defaultId: null }), "")).toBe("");
  });

  it("a stored id wins over the default, and an UNKNOWN one is returned as itself", () => {
    expect(catalogSelection(codex(), "gpt-b")).toBe("gpt-b");
    expect(catalogSelection(codex(), "gpt-from-the-future")).toBe("gpt-from-the-future");
  });

  it("an id that left the roster still renders — the select does not go BLANK", () => {
    // A `SelectMenu` whose value matches no option renders blank; the value is appended, never inserted.
    const c = codex();
    const options = modelOptionsFor(c, "gpt-retired");
    expect(options.map((o) => o.value)).toEqual(["gpt-a", "gpt-b", "gpt-retired"]);
    expect(options[2].label).toBe("gpt-retired");
    expect(modelLabel(c, "gpt-retired")).toBe("gpt-retired");
    expect(modelOptionsFor(c, "gpt-b").map((o) => o.value)).toEqual(["gpt-a", "gpt-b"]);
  });

  it("a raw id is readable off an UNAVAILABLE catalog too — labelling is not selecting", () => {
    const c = codex({ status: "unavailable", models: [], defaultId: null, reason: "no CLI" });
    expect(modelLabel(c, "gpt-retired")).toBe("gpt-retired");
    expect(modelLabel(null, "gpt-retired")).toBe("gpt-retired");
  });
});

describe("reasoning effort follows the MODEL, not the runtime", () => {
  it("the options change when the selected model changes", () => {
    const c = codex();
    expect(dimensionOptionsFor(c, "gpt-a").map((o) => o.value)).toEqual(["low", "medium", "high"]);
    expect(dimensionOptionsFor(c, "gpt-b").map((o) => o.value)).toEqual(["high"]);
    expect(dimensionDefaultFor(c, "gpt-a")).toBe("medium");
    expect(dimensionDefaultFor(c, "gpt-b")).toBe("high");
  });

  it("a model with no efforts gets NO CONTROL — absent, not an empty dropdown", () => {
    expect(dimensionOptionsFor(codex(), "gpt-hidden")).toEqual([]);
    expect(dimensionDefaultFor(codex(), "gpt-hidden")).toBeNull();
  });

  it("with no model named, it answers for the catalog's DEFAULT model", () => {
    expect(dimensionOptionsFor(codex(), "").map((o) => o.value)).toEqual(["low", "medium", "high"]);
  });

  it("an ALIAS of a model gets that model's efforts", () => {
    const c = codex({
      models: catalog("codex", [
        {
          id: "gpt-a",
          label: "A",
          isDefault: true,
          aliases: ["gpt-a-legacy"],
          efforts: ["low", "high"],
          effortDefault: "high",
        },
      ]).models,
    });
    expect(dimensionOptionsFor(c, "gpt-a-legacy").map((o) => o.value)).toEqual(["low", "high"]);
    expect(dimensionDefaultFor(c, "gpt-a-legacy")).toBe("high");
  });

  it("a dimension whose options are empty on the wire is DROPPED, not rendered blank", () => {
    const c = codex({
      models: [
        {
          id: "gpt-a",
          label: "A",
          isDefault: true,
          hidden: false,
          dimensions: { reasoningEffort: { options: [], default: "medium" } },
        },
      ],
    });
    expect(dimensionOptionsFor(c, "gpt-a")).toEqual([]);
  });
});
