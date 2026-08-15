/**
 * `GET /api/version` — the wire contract the desktop gate is built on:
 *   1. always a 200 with a `minSupported` key (any other shape reads as "no answer");
 *   2. the floor is read per REQUEST — a module-load capture looks identical in a one-GET test;
 *   3. nothing is cached;
 *   4. GitHub is never on the request path.
 * Neither the resolver nor the derivation is mocked — only `fetch`, at the network edge.
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
  // Derived latest is module state that outlives a test, so every case states its own start.
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
    // A 500 would also fail open, but by luck. This is a deliberate "no floor".
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
    // Latest held above every floor so the clamp stays out of frame; this is about cadence.
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
    // A refused floor is silent on the wire, so it is reported in the log. Dedupe is module
    // state, so this test states its own starting point.
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

      await get();
      expect(warn).toHaveBeenCalledTimes(1);

      vi.stubEnv(MIN_VERSION_ENV, "v1.8.2");
      await get();
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[1][0]).toContain("not a version");

      vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
      await get();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("carries no auth requirement: a signed-out old build still gets an answer", async () => {
    // GET takes no request at all: nothing about the caller changes the answer.
    expect(GET.length).toBe(0);
  });
});

/** The anti-brick clamp end to end against a DERIVED latest — a hand-bumped
 *  `DOPL_DESKTOP_LATEST_VERSION` decays, and a decayed clamp refuses legitimate floors. */
describe("GET /api/version — the derived anti-brick clamp", () => {
  it("still REFUSES a floor above the newest published release", async () => {
    await serveAndDerive("1.7.24");
    vi.stubEnv(MIN_VERSION_ENV, "1.9.0");
    vi.stubEnv(LATEST_VERSION_ENV, "");
    expect((await get()).body).toEqual({ minSupported: null, latest: "1.7.24" });
  });

  it("lets the floor RISE the moment a newer release exists", async () => {
    // The operator's real loop — no "latest" is edited anywhere.
    await serveAndDerive("1.7.24");
    vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
    vi.stubEnv(LATEST_VERSION_ENV, "");
    expect((await get()).body.minSupported).toBeNull(); // 1.8.0 is not out yet

    __resetLatestReleaseForTests();
    await serveAndDerive("1.8.0"); // Samuel runs `npm run release`
    expect((await get()).body).toEqual({ minSupported: "1.8.0", latest: "1.8.0" });
  });

  it("OVERRULES a stale env var, in the direction each staleness needs", async () => {
    // Stale-LOW: the hand-bumped var refused a genuinely published floor.
    await serveAndDerive("1.8.0");
    vi.stubEnv(MIN_VERSION_ENV, "1.8.0");
    vi.stubEnv(LATEST_VERSION_ENV, "1.7.24");
    expect((await get()).body).toEqual({ minSupported: "1.8.0", latest: "1.8.0" });

    // Stale-HIGH: `dopl-desktop-app/package.json`'s version runs AHEAD of what is published;
    // copying it would brick every Mac.
    __resetLatestReleaseForTests();
    await serveAndDerive("1.7.24");
    vi.stubEnv(MIN_VERSION_ENV, "1.8.2");
    vi.stubEnv(LATEST_VERSION_ENV, "1.8.2");
    expect((await get()).body).toEqual({ minSupported: null, latest: "1.7.24" });
  });

  it("falls back to the env var while the feed is unreachable", async () => {
    // A cold lambda that has not reached GitHub yet — what the env var survives for.
    vi.stubEnv(MIN_VERSION_ENV, "1.9.0");
    vi.stubEnv(LATEST_VERSION_ENV, "1.8.2");
    expect((await get()).body).toEqual({ minSupported: null, latest: "1.8.2" });
  });

  it("a HUNG GitHub costs this route nothing at all", async () => {
    // ⚠ `GET` is SYNCHRONOUS — it cannot await a socket even by accident.
    const feed = hangFeed();
    vi.stubEnv(MIN_VERSION_ENV, "1.8.2");
    const res = GET();
    expect(res).not.toBeInstanceOf(Promise);
    // The declared default answers while GitHub hangs.
    expect(await res.json()).toEqual({ minSupported: "1.8.2", latest: DEFAULT_DECLARED_LATEST });
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it("schedules ONE refresh across a burst, then leaves the cache alone", async () => {
    const feed = serveFeed("1.7.24");
    await get();
    await get();
    await get();
    await vi.waitFor(() => expect(feed).toHaveBeenCalled());
    expect(feed).toHaveBeenCalledTimes(1);
  });

  it("names the SOURCE it refused against, because the two need opposite fixes", async () => {
    // Derived means "publish the build", declared means "your env var is stale" — a log naming
    // the wrong knob is worse than one naming none.
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

/** Fill the derived cache as a warm lambda would, synchronously enough to assert on. */
async function serveAndDerive(version: string): Promise<void> {
  serveFeed(version);
  await refreshLatestRelease();
}
