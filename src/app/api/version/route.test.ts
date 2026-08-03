/**
 * `GET /api/version` — the wire contract the desktop gate is built on.
 *
 * WHAT MUST HOLD, and why each is here rather than only in the resolver's tests:
 *
 *   1. **It is always a 200 with a `minSupported` key.** The desktop treats any
 *      other shape as "no answer" and proceeds, so a route that 500'd on a bad
 *      env would still fail open — but by accident. This pins it as a decision.
 *   2. **The floor is read per REQUEST.** The gate's entire operational story is
 *      "edit the Vercel env, redeploy, clients pick it up". A value captured at
 *      module load would look identical in every test that only calls GET once.
 *   3. **Nothing is cached.** A CDN entry in front of this route delays the one
 *      change it exists to deliver.
 *
 * The resolver is NOT mocked: this route's whole body is that call, and mocking
 * it would leave the malformed/above-latest paths untested at the wire.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "./route";
import { MIN_VERSION_ENV, LATEST_VERSION_ENV } from "@/shared/version/desktop-floor";

type Body = { minSupported: string | null; latest: string | null };

async function get(): Promise<{ status: number; body: Body; cache: string | null }> {
  const res = GET();
  return {
    status: res.status,
    body: (await res.json()) as Body,
    cache: res.headers.get("Cache-Control"),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/version", () => {
  it("serves the configured floor", async () => {
    vi.stubEnv(MIN_VERSION_ENV, "1.8.2");
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toEqual({ minSupported: "1.8.2", latest: null });
  });

  it("echoes the declared latest alongside it", async () => {
    vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
    vi.stubEnv(LATEST_VERSION_ENV, "1.9.0");
    expect((await get()).body).toEqual({ minSupported: "1.8.0", latest: "1.9.0" });
  });

  it("answers 200 with a null floor when nothing is configured", async () => {
    vi.stubEnv(MIN_VERSION_ENV, "");
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.minSupported).toBeNull();
  });

  it("a malformed floor is a 200 with no floor, never an error status", async () => {
    // A 500 here would ALSO fail open (the client cannot read a floor out of
    // it), but only by luck. The answer is a deliberate "no floor".
    vi.stubEnv(MIN_VERSION_ENV, "v1.8.2");
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.minSupported).toBeNull();
  });

  it("refuses a floor above the declared latest at the wire", async () => {
    vi.stubEnv(MIN_VERSION_ENV, "1.9.9");
    vi.stubEnv(LATEST_VERSION_ENV, "1.8.2");
    expect((await get()).body).toEqual({ minSupported: null, latest: "1.8.2" });
  });

  it("re-reads the env on EVERY request (edit + redeploy is the whole story)", async () => {
    vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
    expect((await get()).body.minSupported).toBe("1.8.0");
    vi.stubEnv(MIN_VERSION_ENV, "1.9.0");
    expect((await get()).body.minSupported).toBe("1.9.0");
    vi.stubEnv(MIN_VERSION_ENV, "");
    expect((await get()).body.minSupported).toBeNull();
  });

  it("is uncacheable — a stale floor is the opposite of the point", async () => {
    vi.stubEnv(MIN_VERSION_ENV, "1.8.2");
    expect((await get()).cache).toBe("no-store");
  });

  it("carries no auth requirement: a signed-out old build still gets an answer", async () => {
    // GET takes no request at all, which is the strongest possible statement
    // that nothing about the caller changes the answer.
    expect(GET.length).toBe(0);
  });
});
