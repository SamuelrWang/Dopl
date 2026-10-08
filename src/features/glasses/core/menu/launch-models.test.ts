import { describe, expect, it } from "vitest";
import { CATALOG_LAGGING_MS, CATALOG_STALE_AFTER_MS, type StoredCatalog } from "@/features/model-catalogs/contract";
import { REFRESH_NOTE, launchModels } from "./launch-models";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const at = (ms: number) => new Date(ms).toISOString();
const cat = (runtime: string, publishedMs: number, ids = ["m-1", "m-2"], deviceId = "mac-a"): StoredCatalog => ({
  runtime,
  deviceId,
  models: ids.map((id, i) => ({ id, label: `Model ${i + 1}`, isDefault: i === 0 })),
  defaultId: ids[0] ?? null,
  publishedAt: at(publishedMs),
});

describe("launch models", () => {
  it("fresh catalog: Default + the catalog, and past launches it no longer lists are dropped", () => {
    const r = launchModels("claude", [cat("claude", NOW - 1000)], ["old-model", "m-2"], NOW);
    expect(r).toEqual({
      models: [
        { id: "", label: "Default" },
        { id: "m-1", label: "Model 1" },
        { id: "m-2", label: "Model 2" },
      ],
      stale: false,
      note: null,
    });
  });

  it("an OLD catalog is still shown, plus history, marked stale with the note", () => {
    const r = launchModels("claude", [cat("claude", NOW - CATALOG_STALE_AFTER_MS - 1)], ["old-model"], NOW);
    expect(r.models.map((m) => m.id)).toEqual(["", "m-1", "m-2", "old-model"]);
    expect(r.stale).toBe(true);
    expect(r.note).toBe(REFRESH_NOTE);
  });

  it("a runtime the desktop STOPPED publishing (others kept going) is stale", () => {
    const rows = [cat("codex", NOW - CATALOG_LAGGING_MS - 60_000), cat("claude", NOW - 1000)];
    expect(launchModels("codex", rows, [], NOW).stale).toBe(true);
    expect(launchModels("claude", rows, [], NOW).stale).toBe(false);
  });

  it("no catalog: Default + past launches (the pre-catalog behaviour), with the note", () => {
    const r = launchModels("cursor", [], ["c-1"], NOW);
    expect(r.models.map((m) => m.id)).toEqual(["", "c-1"]);
    expect(r.note).toBe(REFRESH_NOTE);
  });

  it("🔒 an unparseable publish time reads stale, never fresh", () => {
    const bad = { ...cat("claude", NOW), publishedAt: "not a date" };
    expect(launchModels("claude", [bad], [], NOW).stale).toBe(true);
  });

  it("labels go through the caller's sanitizer", () => {
    const r = launchModels("claude", [cat("claude", NOW)], [], NOW, (_id, raw) => raw.toUpperCase());
    expect(r.models[1].label).toBe("MODEL 1");
  });

  describe("two computers", () => {
    it("🔒 a QUIET Mac never marks a busy Mac's list stale (staleness is per computer)", () => {
      // mac-b published codex long ago and nothing since; mac-a is busy. mac-a's claude is fresh.
      const rows = [cat("claude", NOW - 1000, ["a-1"], "mac-a"), cat("codex", NOW - CATALOG_LAGGING_MS * 3, ["c-1"], "mac-b")];
      expect(launchModels("claude", rows, [], NOW).stale).toBe(false);
      // …and mac-b's codex is NOT lagging behind mac-a: only its own publishes count.
      expect(launchModels("codex", rows, [], NOW).stale).toBe(false);
    });

    it("unions the fresh computers' models, newest first, no duplicates", () => {
      const rows = [cat("claude", NOW - 5000, ["shared", "b-only"], "mac-b"), cat("claude", NOW - 1000, ["a-only", "shared"], "mac-a")];
      expect(launchModels("claude", rows, [], NOW).models.map((m) => m.id)).toEqual(["", "a-only", "shared", "b-only"]);
    });

    it("one fresh computer is enough: a stale one's extra models are not offered", () => {
      const rows = [cat("claude", NOW - 1000, ["a-1"], "mac-a"), cat("claude", NOW - CATALOG_STALE_AFTER_MS - 1, ["gone-1"], "mac-b")];
      const r = launchModels("claude", rows, ["hist-1"], NOW);
      expect(r.models.map((m) => m.id)).toEqual(["", "a-1"]);
      expect(r.stale).toBe(false);
    });

    it("all computers stale: everything known + history, with the note", () => {
      const old = NOW - CATALOG_STALE_AFTER_MS - 1;
      const rows = [cat("claude", old, ["a-1"], "mac-a"), cat("claude", old - 10, ["b-1"], "mac-b")];
      const r = launchModels("claude", rows, ["h-1"], NOW);
      expect(r.models.map((m) => m.id)).toEqual(["", "a-1", "b-1", "h-1"]);
      expect(r.note).toBe(REFRESH_NOTE);
    });

    it("a runtime one computer stopped publishing (while it kept publishing others) is stale THERE only", () => {
      const rows = [
        cat("codex", NOW - CATALOG_LAGGING_MS - 60_000, ["c-a"], "mac-a"),
        cat("claude", NOW - 1000, ["x"], "mac-a"),
        cat("codex", NOW - 2000, ["c-b"], "mac-b"),
      ];
      expect(launchModels("codex", rows, [], NOW).models.map((m) => m.id)).toEqual(["", "c-b"]);
    });
  });
});

