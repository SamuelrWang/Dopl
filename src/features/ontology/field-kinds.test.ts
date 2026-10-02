import { describe, expect, it } from "vitest";
import {
  attributeFromField,
  cleanOptions,
  emptyValue,
  FIELD_KINDS,
  formatIsoDate,
  isHttpUrl,
  isIsoDate,
} from "./field-kinds";
import { KIND_LABELS } from "./components/template-editor";

describe("field-kinds", () => {
  it("every kind has a label in the panel's picker", () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual([...FIELD_KINDS].sort());
    expect(KIND_LABELS.enum).toBe("Select");
  });

  it("string kinds are born empty strings, list kinds empty lists", () => {
    for (const k of ["text", "pill", "enum", "date", "link"] as const) {
      expect(emptyValue(k)).toEqual({ kind: k, value: "" });
    }
    for (const k of ["ref", "knowledge", "skill"] as const) {
      expect(emptyValue(k)).toEqual({ kind: k, value: [] });
    }
  });

  it("a child is born with the field's (enum) options and NOT its description", () => {
    // The description is the type's alone (2026-10-01) — no per-card copy.
    expect(
      attributeFromField({ key: "c", label: "C", kind: "enum", options: ["A"], description: "d" })
    ).toEqual({ key: "c", label: "C", value: { kind: "enum", value: "" }, options: ["A"] });
    // A legacy field births exactly the old shape — no new keys.
    expect(attributeFromField({ key: "s", label: "S", kind: "pill" })).toEqual({
      key: "s",
      label: "S",
      value: { kind: "pill", value: "" },
    });
  });

  it("validates days, links and options", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isHttpUrl("http://a.co")).toBe(true);
    expect(isHttpUrl("https://")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(cleanOptions([" A ", "a", "", "B"])).toEqual(["A", "B"]);
  });

  it("formats a stored day as that day, whatever the local zone", () => {
    const shown = formatIsoDate("2026-10-01");
    expect(shown).toMatch(/2026/);
    expect(shown).not.toMatch(/30/);
  });
});
