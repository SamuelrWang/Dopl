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
 *   4. **GitHub is never on the request path.** The clamp's `latest` is derived
 *      from the release feed, and the derivation is read from a cache and
 *      refreshed afterwards. A hung GitHub must not cost this route anything.
 *
 * Neither the resolver nor the derivation is mocked: this route's whole body is
 * those two calls, and mocking them would leave the malformed/above-latest paths
 * untested at the wire. Only `fetch` is stubbed, at the network edge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import {
  DEFAULT_DECLARED_LATEST,
  MIN_VERSION_ENV,
  LATEST_VERSION_ENV,
} from "@/shared/version/desktop-floor";
import {
  __resetLatestReleaseForTests,
  refreshLatestRelease,
} from "@/shared/version/latest-release";

type Body = { minSupported: string | null; latest: string | null };

async function get(): Promise<{ status: number; body: Body; cache: string | null }> {
  const res = GET();
  return {
    status: res.status,
    body: (await res.json()) as Body,
    cache: res.headers.get("Cache-Control"),
  };
}

/** The release feed answering with a published version. */
function serveFeed(version: string): ReturnType<typeof vi.fn> {
  const spy = vi.fn(
    async () => new Response(`version: ${version}\nfiles:\n  - url: Dopl.zip\n`)
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** GitHub at its worst: hung. Answers nothing, logs nothing, caches nothing. */
function hangFeed(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  // The derived latest is module state that outlives a test, and every case
  // here states its own starting point rather than inheriting one. The default
  // is a feed that never answers, so a test that does not care about GitHub
  // exercises exactly the env-var behavior this route had before F-125's fix.
  __resetLatestReleaseForTests();
  hangFeed();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/version", () => {
  it("serves the configured floor", async () => {
    vi.stubEnv(MIN_VERSION_ENV, "1.8.2");
    const { status, body } = await get();
    expect(status).toBe(200);
    // `latest` is the code-default declared value now (Stage C) — the clamp
    // fallback ships beside the floor rather than arriving by env.
    expect(body).toEqual({ minSupported: "1.8.2", latest: DEFAULT_DECLARED_LATEST });
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
    // Latest held above every floor below so the clamp stays out of the frame;
    // this test is about the read cadence, not the clamp.
    vi.stubEnv(LATEST_VERSION_ENV, "1.9.9");
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

  it("SAYS SO IN THE LOG when it refuses a floor, because the wire cannot", async () => {
    // A refused floor is served as the same plain "no floor" a correct unset
    // config produces — which is what makes it safe, and also what makes it
    // silent. The only person who can fix it is the operator who set the env
    // var, so the refusal is reported where they will look.
    // The dedupe is module state, so this test states its own starting point
    // rather than inheriting whatever ran before it.
    vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
    vi.stubEnv(LATEST_VERSION_ENV, "");
    await get();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubEnv(MIN_VERSION_ENV, "1.9.9");
      vi.stubEnv(LATEST_VERSION_ENV, "1.8.2");
      await get();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(MIN_VERSION_ENV);
      expect(warn.mock.calls[0][0]).toContain(LATEST_VERSION_ENV);

      // Deduped: every desktop asks at boot and every 4h, and a line per request
      // would bury the one that matters.
      await get();
      expect(warn).toHaveBeenCalledTimes(1);

      // A DIFFERENT mistake is a different line.
      vi.stubEnv(MIN_VERSION_ENV, "v1.8.2");
      await get();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[1][0]).toContain("not a version");

      // And a fixed config says nothing at all.
      vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
      await get();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("carries no auth requirement: a signed-out old build still gets an answer", async () => {
    // GET takes no request at all, which is the strongest possible statement
    // that nothing about the caller changes the answer.
    expect(GET.length).toBe(0);
  });
});

/**
 * The anti-brick clamp, end to end, against a DERIVED latest (F-125 residual).
 *
 * The failure being fixed: `DOPL_DESKTOP_LATEST_VERSION` was bumped by hand, so
 * it decayed, and a decayed clamp refuses legitimate floors — the gate fails
 * safe and useless at the same time. The clamp now reads the release feed the
 * updater already reads, so it tracks reality without anyone remembering to
 * type a number.
 */
describe("GET /api/version — the derived anti-brick clamp", () => {
  it("still REFUSES a floor above the newest published release", async () => {
    await serveAndDerive("1.7.24");
    vi.stubEnv(MIN_VERSION_ENV, "1.9.0");
    // No env var declares anything: the refusal is entirely the feed's doing.
    vi.stubEnv(LATEST_VERSION_ENV, "");
    expect((await get()).body).toEqual({ minSupported: null, latest: "1.7.24" });
  });

  it("lets the floor RISE the moment a newer release exists", async () => {
    // The operator's real loop, in three steps. Nothing about it involves
    // editing a "latest" anywhere.
    await serveAndDerive("1.7.24");
    vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
    vi.stubEnv(LATEST_VERSION_ENV, "");
    expect((await get()).body.minSupported).toBeNull(); // 1.8.0 is not out yet

    __resetLatestReleaseForTests();
    await serveAndDerive("1.8.0"); // Samuel runs `npm run release`
    expect((await get()).body).toEqual({ minSupported: "1.8.0", latest: "1.8.0" });
  });

  it("OVERRULES a stale env var, in the direction each staleness needs", async () => {
    // Stale-LOW: the hand-bumped var was refusing a floor that is genuinely
    // published. The feed unsticks it.
    await serveAndDerive("1.8.0");
    vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
    vi.stubEnv(LATEST_VERSION_ENV, "1.7.24");
    expect((await get()).body).toEqual({ minSupported: "1.8.0", latest: "1.8.0" });

    // Stale-HIGH: someone copied `dopl-desktop-app/package.json`'s version, as
    // the old docs told them to, and that file runs AHEAD of what is published.
    // The feed refuses the floor that would have bricked every Mac.
    __resetLatestReleaseForTests();
    await serveAndDerive("1.7.24");
    vi.stubEnv(MIN_VERSION_ENV, "1.8.2");
    vi.stubEnv(LATEST_VERSION_ENV, "1.8.2");
    expect((await get()).body).toEqual({ minSupported: null, latest: "1.7.24" });
  });

  it("falls back to the env var while the feed is unreachable", async () => {
    // A cold lambda that has not reached GitHub yet. The env var survives for
    // exactly this, and for the day the feed goes away.
    vi.stubEnv(MIN_VERSION_ENV, "1.9.0");
    vi.stubEnv(LATEST_VERSION_ENV, "1.8.2");
    expect((await get()).body).toEqual({ minSupported: null, latest: "1.8.2" });
  });

  it("a HUNG GitHub costs this route nothing at all", async () => {
    // The constraint the whole design turns on. `GET` is a synchronous function
    // — it cannot await a socket even by accident — and the round trip it kicks
    // off is still in flight when the response is already built.
    const feed = hangFeed();
    vi.stubEnv(MIN_VERSION_ENV, "1.8.2");
    const res = GET();
    expect(res).not.toBeInstanceOf(Promise);
    // The declared default answers while GitHub hangs — the clamp no longer
    // goes dark on a cold instance (Stage C's second half).
    expect(await res.json()).toEqual({ minSupported: "1.8.2", latest: DEFAULT_DECLARED_LATEST });
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it("schedules ONE refresh across a burst, then leaves the cache alone", async () => {
    const feed = serveFeed("1.7.24");
    await get();
    await get();
    await get();
    await vi.waitFor(() => expect(feed).toHaveBeenCalled());
    // Single-flight during, TTL after: three boots do not become three trips.
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it("names the SOURCE it refused against, because the two need opposite fixes", async () => {
    // A derived latest means "publish the build"; a declared one means "your env
    // var is stale". F-125's lesson was that a refusal invisible on the wire has
    // to be legible in the log, and a log that names the wrong knob is worse
    // than one that names none.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await serveAndDerive("1.7.24");
      vi.stubEnv(MIN_VERSION_ENV, "1.9.0");
      vi.stubEnv(LATEST_VERSION_ENV, "");
      await get();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("newest published release");
      expect(warn.mock.calls[0][0]).toContain("1.7.24");
      expect(warn.mock.calls[0][0]).not.toContain(LATEST_VERSION_ENV);
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * Fill the derived cache the way a warm lambda would have, but synchronously
 * enough to assert on. The route only ever READS this cache, so a test that
 * wants a derived value asks for it up front rather than racing the scheduler.
 */
async function serveAndDerive(version: string): Promise<void> {
  serveFeed(version);
  await refreshLatestRelease();
}
