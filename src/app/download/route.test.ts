/**
 * GET /download — the landing Download button's one hop: a 307 to whatever the
 * resolver says is the newest dmg, never cached (a cached redirect would pin a
 * visitor to the build current on their first click).
 */
import { describe, expect, it, vi } from "vitest";

const resolver = vi.hoisted(() => ({ url: "" }));
vi.mock("@/shared/version/mac-download", () => ({
  resolveMacDownloadUrl: () => Promise.resolve(resolver.url),
}));

const { GET, dynamic } = await import("./route");

describe("GET /download", () => {
  it("307s to the resolved build and forbids caching the redirect", async () => {
    resolver.url = "https://github.com/o/r/releases/download/v1.2.3/Dopl-1.2.3-arm64.dmg";
    const res = await GET();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(resolver.url);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("follows the resolver on every request rather than a first answer", async () => {
    resolver.url = "https://github.com/o/r/releases/latest";
    const res = await GET();
    expect(res.headers.get("location")).toBe(resolver.url);
  });

  it("is never statically rendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
