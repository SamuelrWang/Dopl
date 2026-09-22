/**
 * THE RUNTIME-KEYED MODEL CATALOG, ON THE WEB SIDE (U6, 2026-09-21) — `lib/model-catalog.ts`.
 *
 * THE PROPERTY THIS FILE EXISTS FOR:
 *
 *   🔒 **NO SURFACE MAY RENDER ONE RUNTIME'S MODELS WHILE ANOTHER IS SELECTED.** The defect U6
 *      closes is that `lib/agent-models.ts` — four CLAUDE ids — was every runtime's source, so
 *      picking Codex offered Fable. Every miss and every failure path below is asserted to
 *      contain NONE of those ids, not merely to be "empty".
 *
 * AND THE THREE RULES THAT FOLLOW FROM THE FOUR STATES:
 *
 *   • an empty `models` list means NOTHING without its status (INVARIANTS §11);
 *   • a `stale` or `unavailable` id may still be LABELLED and may not be newly SELECTED;
 *   • omission is the platform default — it is DISPLAYED and never persisted.
 */

import { describe, expect, it } from "vitest";
import {
  CATALOG_VERSION,
  canSelectModel,
  catalogFor,
  catalogReady,
  catalogReason,
  catalogSelection,
  dimensionDefaultFor,
  dimensionOptionsFor,
  hasCatalogKey,
  modelLabel,
  modelOptionsFor,
  modelShortLabel,
  normalizeCatalogs,
  normalizeDimensionValue,
  selectableModels,
} from "./model-catalog";
import { defaultRuntimeFallbackCatalog } from "./agent-models";

const CLAUDE_IDS = [
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
];

const effort = (values: string[], fallback: string | null) => ({
  reasoningEffort: {
    options: values.map((v) => ({ value: v, label: v, description: null })),
    default: fallback,
  },
});

const wire = (over: Record<string, unknown> = {}) => ({
  version: CATALOG_VERSION,
  runtime: "codex",
  source: "live",
  status: "ready",
  reason: "",
  key: "/opt/homebrew/bin/codex@1.0.0",
  models: [
    {
      id: "gpt-a",
      label: "GPT Alpha",
      short: "GPT Alpha",
      isDefault: true,
      hidden: false,
      dimensions: effort(["low", "medium", "high"], "medium"),
    },
    {
      id: "gpt-b",
      label: "GPT Beta",
      short: "GPT Beta",
      isDefault: false,
      hidden: false,
      dimensions: effort(["high"], "high"),
    },
    {
      id: "gpt-hidden",
      label: "GPT Hidden",
      short: null,
      isDefault: false,
      hidden: true,
      dimensions: {},
    },
  ],
  defaultId: "gpt-a",
  dimensions: ["reasoningEffort"],
  truncated: false,
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
  it("reads an own-key probe, so an OLDER desktop is not read as 'no models'", () => {
    // ⚠ THE THREE STATES ARE THREE ANSWERS: no key (an older build), an empty map (this build
    // registered nothing), and a populated one. Collapsing the first two empties the picker on a
    // machine that works perfectly.
    expect(hasCatalogKey({ tools: "manual" })).toBe(false);
    expect(hasCatalogKey({ catalogs: {} })).toBe(true);
    expect(hasCatalogKey(null)).toBe(false);
  });

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
    // A newer desktop with a fifth state is telling this bundle something it cannot act on.
    // `loading` persists nothing and refuses nothing; `ready` would offer a list it cannot vouch
    // for, and `unavailable` would invent a failure nobody reported.
    const c = codex({ status: "quantum" });
    expect(c?.status).toBe("loading");
    expect(catalogReason(c)).toBeNull();
  });

  it("clears a defaultId that names no model it carries", () => {
    expect(codex({ defaultId: "gpt-gone" })?.defaultId).toBeNull();
  });
});

describe("🔒 no runtime borrows another's models", () => {
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

  it("the older-desktop fallback is scoped to the DEFAULT runtime and says so", () => {
    // It is the only Claude-shaped list left on this side, and it is a catalog for ONE runtime id.
    const fallback = defaultRuntimeFallbackCatalog("claude");
    expect(fallback.runtime).toBe("claude");
    expect(fallback.models.map((m) => m.id)).toEqual(CLAUDE_IDS);
    expect(fallback.defaultId).toBe("claude-sonnet-5");
    expect(fallback.models.filter((m) => m.isDefault)).toHaveLength(1);
    expect(fallback.dimensions).toEqual([]);
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
    expect(canSelectModel(c, "gpt-hidden")).toBe(false);
    expect(modelLabel(c, "gpt-hidden")).toBe("GPT Hidden");
    // ⚠ `short` FALLS BACK TO THE FULL LABEL, never to a truncation.
    expect(modelShortLabel(c, "gpt-hidden")).toBe("GPT Hidden");
  });

  it("LOADING explains nothing and offers nothing — it is not a failure", () => {
    const c = codex({ status: "loading", models: [], defaultId: null, reason: "" });
    expect(catalogReason(c)).toBeNull();
    expect(selectableModels(c)).toEqual([]);
    expect(canSelectModel(c, "gpt-a")).toBe(false);
  });

  it("STALE still LABELS and may not be newly SELECTED", () => {
    // The plan's rule, in one case: "unknown effective models stay visible as RAW IDs on
    // historical session cards, while a stale/unavailable id cannot be NEWLY selected."
    const c = codex({ status: "stale", reason: "the Codex CLI was upgraded" });
    expect(modelLabel(c, "gpt-a")).toBe("GPT Alpha");
    expect(canSelectModel(c, "gpt-a")).toBe(false);
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
    // A `SelectMenu` whose value matches no option renders empty, which would report "no model"
    // about a channel that has one. The current value is APPENDED, never inserted.
    const c = codex();
    const options = modelOptionsFor(c, "gpt-retired");
    expect(options.map((o) => o.value)).toEqual(["gpt-a", "gpt-b", "gpt-retired"]);
    expect(options[2].label).toBe("gpt-retired");
    expect(modelLabel(c, "gpt-retired")).toBe("gpt-retired");
    // ⚠ AND IT IS GONE the moment the value is a member again.
    expect(modelOptionsFor(c, "gpt-b").map((o) => o.value)).toEqual(["gpt-a", "gpt-b"]);
  });

  it("a raw id is readable off an UNAVAILABLE catalog too — labelling is not selecting", () => {
    const c = codex({ status: "unavailable", models: [], defaultId: null, reason: "no CLI" });
    expect(modelLabel(c, "gpt-retired")).toBe("gpt-retired");
    expect(modelLabel(null, "gpt-retired")).toBe("gpt-retired");
    expect(modelShortLabel(null, "")).toBeNull();
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

  it("a value the NEWLY selected model cannot honour is normalized to that model's own default", () => {
    const c = codex();
    // Kept when it is still supported…
    expect(normalizeDimensionValue(c, "gpt-a", "low")).toBe("low");
    // …and moved to the NEW model's default when it is not. Never left spending an effort the
    // selected model refuses, and never borrowed from the previous model.
    expect(normalizeDimensionValue(c, "gpt-b", "low")).toBe("high");
  });

  it("a model with no efforts normalizes to ABSENT — the platform's own pick, not a failure", () => {
    expect(normalizeDimensionValue(codex(), "gpt-hidden", "high")).toBe("");
    expect(normalizeDimensionValue(null, "gpt-a", "high")).toBe("");
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
