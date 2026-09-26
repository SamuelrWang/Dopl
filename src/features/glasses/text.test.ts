import { describe, expect, it } from "vitest";
import {
  GlassesValidationError,
  cleanField,
  cleanList,
  cleanSeconds,
  isUuid,
  sanitizeGlassesText,
  utf8Bytes,
} from "./text";

describe("sanitizeGlassesText", () => {
  it("straightens curly quotes and flattens dashes", () => {
    expect(sanitizeGlassesText("“Hi” it’s 3–4 — ok")).toBe(
      "\"Hi\" it's 3-4 - ok",
    );
  });

  it("strips emoji, non-BMP chars, variation selectors and ZWJ", () => {
    expect(sanitizeGlassesText("Deploy \u{1F680} done ✅️ \u{1F468}‍\u{1F4BB}")).toBe(
      "Deploy done",
    );
  });

  it("keeps plain accented latin", () => {
    expect(sanitizeGlassesText("café naïve")).toBe("café naïve");
  });

  it("expands ellipsis and collapses spaces", () => {
    expect(sanitizeGlassesText("  wait…   now ")).toBe("wait... now");
  });
});

describe("byte limits", () => {
  it("counts UTF-8 bytes, not chars", () => {
    expect(utf8Bytes("é")).toBe(2);
  });

  it("names the field and both numbers when over the cap", () => {
    expect(() => cleanField("question", "x".repeat(83), 60)).toThrow(
      "question is 83 bytes; max 60. Shorten it.",
    );
  });

  it("measures after sanitizing", () => {
    expect(cleanField("title", "a—b", 3)).toBe("a-b");
  });

  it("rejects empty-after-sanitize and non-strings", () => {
    expect(() => cleanField("title", "\u{1F600}", 64)).toThrow(GlassesValidationError);
    expect(() => cleanField("title", 5, 64)).toThrow("title must be a string");
  });

  it("enforces list counts and per-item caps", () => {
    expect(() => cleanList("options", ["a"], { min: 2, max: 4 }, 40)).toThrow(
      "options has 1 items; need 2-4",
    );
    expect(() => cleanList("options", ["a", "b".repeat(41)], { min: 2, max: 4 }, 40)).toThrow(
      "options[1] is 41 bytes; max 40",
    );
    expect(cleanList("lines", ["x – y"], { min: 1, max: 4 }, 100)).toEqual(["x - y"]);
  });

  it("bounds seconds and applies defaults", () => {
    expect(cleanSeconds("ttl_sec", undefined, 60, 5, 100)).toBe(60);
    expect(() => cleanSeconds("ttl_sec", 1, 60, 5, 100)).toThrow("ttl_sec is 1; allowed 5-100");
  });

  it("recognises uuids", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("nope")).toBe(false);
  });
});
