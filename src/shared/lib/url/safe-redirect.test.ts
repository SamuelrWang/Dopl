import { describe, it, expect } from "vitest";
import { safeRedirect } from "./safe-redirect";
import { WEB_POST_AUTH_LANDING } from "./post-auth-landing";

describe("safeRedirect", () => {
  it("allows same-origin paths", () => {
    expect(safeRedirect("/get-started")).toBe("/get-started");
    expect(safeRedirect("/foo/bar")).toBe("/foo/bar");
    expect(safeRedirect("/foo?bar=1")).toBe("/foo?bar=1");
    expect(safeRedirect("/foo#anchor")).toBe("/foo#anchor");
    expect(safeRedirect("/foo?bar=1#x")).toBe("/foo?bar=1#x");
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirect("https://evil.com")).toBe("/get-started");
    expect(safeRedirect("http://evil.com/x")).toBe("/get-started");
    expect(safeRedirect("javascript:alert(1)")).toBe("/get-started");
    expect(safeRedirect("data:text/html,<script>")).toBe("/get-started");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirect("//evil.com")).toBe("/get-started");
    expect(safeRedirect("//evil.com/x")).toBe("/get-started");
    expect(safeRedirect("/\\evil.com")).toBe("/get-started");
  });

  it("rejects empty / missing values", () => {
    expect(safeRedirect("")).toBe("/get-started");
    expect(safeRedirect(null)).toBe("/get-started");
    expect(safeRedirect(undefined)).toBe("/get-started");
  });

  it("respects a custom fallback", () => {
    expect(safeRedirect(null, "/login")).toBe("/login");
    expect(safeRedirect("https://evil.com", "/login")).toBe("/login");
  });

  it("rejects relative paths without a leading slash", () => {
    expect(safeRedirect("canvas")).toBe("/get-started");
    expect(safeRedirect("../etc/passwd")).toBe("/get-started");
  });

  it("normalizes encoded paths", () => {
    expect(safeRedirect("/foo%20bar")).toBe("/foo%20bar");
  });

  it("rejects malformed input that throws", () => {
    expect(safeRedirect("/")).toBe("/");
  });

  it("strips host injection via URL parsing", () => {
    const result = safeRedirect("/../etc/passwd");
    // URL normalizes /../etc/passwd → /etc/passwd; same origin, allowed.
    expect(result.startsWith("/")).toBe(true);
    expect(result.includes("evil")).toBe(false);
  });

  // ⚠ DRIFT GUARD. `safe-redirect.ts` is the LEAF, so it cannot import
  // `WEB_POST_AUTH_LANDING` back without closing a cycle and carries its own
  // literal. This is the only thing keeping the two from parting company.
  it("the local fallback literal still equals the post-auth landing", () => {
    expect(safeRedirect(null)).toBe(WEB_POST_AUTH_LANDING);
    expect(safeRedirect("https://evil.com")).toBe(WEB_POST_AUTH_LANDING);
  });
});
