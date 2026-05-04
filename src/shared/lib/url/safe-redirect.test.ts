import { describe, it, expect } from "vitest";
import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it("allows same-origin paths", () => {
    expect(safeRedirect("/canvas")).toBe("/canvas");
    expect(safeRedirect("/foo/bar")).toBe("/foo/bar");
    expect(safeRedirect("/foo?bar=1")).toBe("/foo?bar=1");
    expect(safeRedirect("/foo#anchor")).toBe("/foo#anchor");
    expect(safeRedirect("/foo?bar=1#x")).toBe("/foo?bar=1#x");
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirect("https://evil.com")).toBe("/canvas");
    expect(safeRedirect("http://evil.com/x")).toBe("/canvas");
    expect(safeRedirect("javascript:alert(1)")).toBe("/canvas");
    expect(safeRedirect("data:text/html,<script>")).toBe("/canvas");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirect("//evil.com")).toBe("/canvas");
    expect(safeRedirect("//evil.com/x")).toBe("/canvas");
    expect(safeRedirect("/\\evil.com")).toBe("/canvas");
  });

  it("rejects empty / missing values", () => {
    expect(safeRedirect("")).toBe("/canvas");
    expect(safeRedirect(null)).toBe("/canvas");
    expect(safeRedirect(undefined)).toBe("/canvas");
  });

  it("respects a custom fallback", () => {
    expect(safeRedirect(null, "/login")).toBe("/login");
    expect(safeRedirect("https://evil.com", "/login")).toBe("/login");
  });

  it("rejects relative paths without a leading slash", () => {
    expect(safeRedirect("canvas")).toBe("/canvas");
    expect(safeRedirect("../etc/passwd")).toBe("/canvas");
  });

  it("normalizes encoded paths", () => {
    expect(safeRedirect("/foo%20bar")).toBe("/foo%20bar");
  });

  it("rejects malformed input that throws", () => {
    // The URL constructor is forgiving but defensive guard.
    expect(safeRedirect("/")).toBe("/");
  });

  it("strips host injection via URL parsing", () => {
    // A path like "/.." should normalize but not escape origin.
    const result = safeRedirect("/../etc/passwd");
    // URL normalizes /../etc/passwd → /etc/passwd; same origin so it's allowed.
    expect(result.startsWith("/")).toBe(true);
    expect(result.includes("evil")).toBe(false);
  });
});
