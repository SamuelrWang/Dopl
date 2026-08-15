import { describe, expect, it } from "vitest";
import { composeSegment, parseSegment } from "./parse-segment";

describe("parseSegment", () => {
  it("parses a canonical segment", () => {
    expect(parseSegment("dopl-team-workspace-x7k2j9hf2k1q")).toEqual({
      slug: "dopl-team-workspace",
      publicId: "x7k2j9hf2k1q",
    });
  });

  it("returns null for a slug-only segment", () => {
    expect(parseSegment("dopl-team-workspace")).toBeNull();
  });

  it("returns null when the suffix is shorter than 12 chars", () => {
    expect(parseSegment("foo-bar-12345")).toBeNull();
  });

  it("returns null when the suffix is longer than 12 chars", () => {
    expect(parseSegment("foo-1234567890123")).toBeNull();
  });

  it("rejects suffixes containing non-alphanumeric characters", () => {
    expect(parseSegment("foo-abc-def-12345")).toBeNull();
  });

  it("rejects suffixes with uppercase letters", () => {
    // ⚠ Reject uppercase explicitly (proxy already 308s mixed-case to
    // lowercase) so a hand-typed canonical doesn't look up a missing publicId.
    expect(parseSegment("foo-AAAAAAAAAAAA")).toBeNull();
  });

  it("greedily consumes prefix when slug ends in 12 alphanumerics", () => {
    expect(parseSegment("foo-aaaaaaaaaaaa-bbbbbbbbbbbb")).toEqual({
      slug: "foo-aaaaaaaaaaaa",
      publicId: "bbbbbbbbbbbb",
    });
  });

  it("handles single-char slug prefix", () => {
    expect(parseSegment("a-1234567890ab")).toEqual({
      slug: "a",
      publicId: "1234567890ab",
    });
  });

  it("returns null when only the suffix is present", () => {
    expect(parseSegment("1234567890ab")).toBeNull();
  });
});

describe("composeSegment", () => {
  it("joins with a single hyphen", () => {
    expect(composeSegment("foo-bar", "1234567890ab")).toBe("foo-bar-1234567890ab");
  });

  it("round-trips through parseSegment", () => {
    const segment = composeSegment("dopl-team-workspace", "x7k2j9hf2k1q");
    expect(parseSegment(segment)).toEqual({
      slug: "dopl-team-workspace",
      publicId: "x7k2j9hf2k1q",
    });
  });
});
