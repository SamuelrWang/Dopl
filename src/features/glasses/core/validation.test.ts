import { describe, expect, it } from "vitest";
import { sanitizeG2Text as S } from "../platforms/even-g2/text";
import { flattenChannelText } from "./channel-text";
import { GlassesValidationError, cleanField, cleanList, cleanSeconds, isUuid, utf8Bytes } from "./validation";

describe("byte limits", () => {
  it("counts UTF-8 bytes, not chars", () => {
    expect(utf8Bytes("é")).toBe(2);
  });

  it("names the field and both numbers when over the cap", () => {
    expect(() => cleanField(S, "question", "x".repeat(83), 60)).toThrow(
      "question is 83 bytes; max 60. Shorten it.",
    );
  });

  it("measures after sanitizing", () => {
    expect(cleanField(S, "title", "a—b", 3)).toBe("a-b");
  });

  it("rejects empty-after-sanitize and non-strings", () => {
    expect(() => cleanField(S, "title", "\u{1F600}", 64)).toThrow(GlassesValidationError);
    expect(() => cleanField(S, "title", 5, 64)).toThrow("title must be a string");
  });

  it("enforces list counts and per-item caps", () => {
    expect(() => cleanList(S, "options", ["a"], { min: 2, max: 4 }, 40)).toThrow(
      "options has 1 items; need 2-4",
    );
    expect(() => cleanList(S, "options", ["a", "b".repeat(41)], { min: 2, max: 4 }, 40)).toThrow(
      "options[1] is 41 bytes; max 40",
    );
    expect(cleanList(S, "lines", ["x – y"], { min: 1, max: 4 }, 100)).toEqual(["x - y"]);
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

describe("channel text", () => {
  it("flattens markdown and reduces embeds to notes", () => {
    expect(flattenChannelText("# Title\n- one\n- `two`\n[link](http://x)", S).text).toBe("Title\n- one\n- two\nlink");
    expect(flattenChannelText("a  \n\n\n\n  b\r\nc", S).text).toBe("a\n\nb\nc");
    expect(flattenChannelText("See ![chart](https://x/c.png) and [Q3 report](https://x/q3.pdf).", S)).toEqual({
      text: "See [image] and [file: Q3 report] .",
      notes: ["[image]", "[file: Q3 report]"],
    });
  });
});
