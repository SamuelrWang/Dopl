/**
 * THE DERIVED "newest published build", as a failure table.
 *
 * This module exists to keep the anti-brick clamp's reference value from
 * decaying, so the property under test is not "does it read GitHub" — it is
 * "what does it hand the clamp when GitHub does NOT behave". Every case below
 * checks the same direction of failure:
 *
 *   a wrong-LOW latest  → the clamp refuses more floors → fewer people blocked
 *   a wrong-HIGH latest → the clamp permits a floor nothing can install → BRICK
 *
 * So `null`, a stale value and an old value are all acceptable outcomes of a bad
 * day, and inventing a version is the one unacceptable one. Nothing here may
 * make the request path wait, either: the cache is read synchronously and the
 * refresh is scheduled, never awaited.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LATEST_RELEASE_URL,
  LATEST_RELEASE_TTL_MS,
  LATEST_RELEASE_RETRY_MS,
  RELEASE_OWNER,
  RELEASE_REPO,
  RELEASE_CHANNEL_FILE,
  __resetLatestReleaseForTests,
  cachedLatestRelease,
  isLatestReleaseRefreshDue,
  parseChannelVersion,
  refreshLatestRelease,
  scheduleLatestReleaseRefresh,
} from "./latest-release";

/** The real file, byte-for-byte as GitHub served it while this was written. */
const REAL_CHANNEL_FILE = [
  "version: 1.7.24",
  "files:",
  "  - url: Dopl-1.7.24-arm64-mac.zip",
  "    sha512: oKsY8lynq7QXdJ/jFFEAIoRBJ1dShUBHdhyhurHc/klY==",
  "    size: 199969717",
  "path: Dopl-1.7.24-arm64-mac.zip",
  "sha512: oKsY8lynq7QXdJ/jFFEAIoRBJ1dShUBHdhyhurHc/klY==",
  "releaseDate: '2026-08-03T00:18:37.036Z'",
  "",
].join("\n");

let warn: Mock<(...args: unknown[]) => void>;

/** Stub the ONE round trip. `body` null means "the request failed outright". */
function serve(body: string | null, status = 200): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => {
    if (body === null) throw new TypeError("fetch failed");
    return new Response(body, { status });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  __resetLatestReleaseForTests();
  warn = vi.fn();
  vi.spyOn(console, "warn").mockImplementation(warn);
  serve(REAL_CHANNEL_FILE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── The source ───────────────────────────────────────────────────────────────

describe("the release feed URL", () => {
  it("points at the repo the desktop app actually publishes to (the drift alarm)", () => {
    // The URL is a constant, so nothing in this repo would notice a rename. The
    // desktop's own publish block is the only other place the pair is written,
    // and if the two disagree the derivation silently 404s forever and the
    // clamp quietly falls back to the stale env var — the exact failure this
    // module was built to end. Read the real file rather than restate it.
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "dopl-desktop-app", "package.json"), "utf8")
    ) as { build: { publish: { provider: string; owner: string; repo: string }[] } };
    const publish = pkg.build.publish[0];
    expect(publish.provider).toBe("github");
    expect(publish.owner).toBe(RELEASE_OWNER);
    expect(publish.repo).toBe(RELEASE_REPO);
  });

  it("asks for the updater's own channel file, not the REST API", () => {
    // Two reasons, both load-bearing. (1) `api.github.com` is 60/hr per IP
    // unauthenticated and a lambda egresses from a shared pool — the probe that
    // designed this module got a 403 before it got a release. (2) The channel
    // file is the byte-for-byte file electron-updater consumes, so the server's
    // clamp and the client's GUARD 2 read ONE fact instead of two that drift.
    expect(LATEST_RELEASE_URL).toBe(
      `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest/download/${RELEASE_CHANNEL_FILE}`
    );
    expect(LATEST_RELEASE_URL).not.toContain("api.github.com");
  });
});

// ── The parser ───────────────────────────────────────────────────────────────

describe("parseChannelVersion", () => {
  it("reads the version out of a real latest-mac.yml", () => {
    expect(parseChannelVersion(REAL_CHANNEL_FILE)).toBe("1.7.24");
  });

  it("strips a tag-style `v` prefix and surrounding quotes", () => {
    // The channel file does not use either today. A tag does (`v1.7.24`), and
    // a yml emitter is free to quote, so both are absorbed rather than becoming
    // an unreadable version that blanks the clamp.
    expect(parseChannelVersion("version: v1.7.24")).toBe("1.7.24");
    expect(parseChannelVersion("version: '1.7.24'")).toBe("1.7.24");
    expect(parseChannelVersion('version: "v1.9.0-beta.2"')).toBe("1.9.0-beta.2");
    expect(parseChannelVersion("version:1.7.24")).toBe("1.7.24");
    expect(parseChannelVersion("version: \t1.7.24  \t")).toBe("1.7.24");
  });

  it("survives CRLF, and a version that is not on the first line", () => {
    expect(parseChannelVersion("files:\r\nversion: 1.7.24\r\npath: x\r\n")).toBe("1.7.24");
  });

  it("answers null for everything that is not a version", () => {
    for (const bad of [
      "",
      null,
      undefined,
      "<!DOCTYPE html><html><body>Not Found</body></html>",
      '{"message":"API rate limit exceeded"}',
      "files:\n  - url: Dopl.zip\n",
      "version: latest",
      "version: 1.8",
      "version: 1.8.2.1",
      "version:",
      "Version: 1.7.24", // yaml is case-sensitive and so is this
    ]) {
      expect(parseChannelVersion(bad)).toBeNull();
    }
  });

  it("does not match an INDENTED version — those belong to a file entry", () => {
    // `files:` entries are nested, and a nested key is not the release version.
    expect(parseChannelVersion("files:\n  - url: x.zip\n    version: 9.9.9\n")).toBeNull();
  });

  it("refuses to scan an unbounded body", () => {
    // A captive portal or an error page can be arbitrarily large, and a regex
    // over megabytes on the request path is its own outage. Only the head of
    // the body is read, so a version buried past it is simply not found.
    const buried = `${"# padding\n".repeat(5000)}version: 1.7.24\n`;
    expect(parseChannelVersion(buried)).toBeNull();
    expect(parseChannelVersion(`version: 1.7.24\n${"# padding\n".repeat(5000)}`)).toBe("1.7.24");
  });
});

// ── The cache ────────────────────────────────────────────────────────────────

describe("refreshLatestRelease", () => {
  it("starts empty and knows it is due", () => {
    expect(cachedLatestRelease()).toBeNull();
    expect(isLatestReleaseRefreshDue(0)).toBe(true);
  });

  it("caches a good answer and stops being due for the TTL", async () => {
    expect(await refreshLatestRelease()).toBe("1.7.24");
    expect(cachedLatestRelease()).toBe("1.7.24");
    const now = Date.now();
    expect(isLatestReleaseRefreshDue(now + LATEST_RELEASE_TTL_MS - 1000)).toBe(false);
    expect(isLatestReleaseRefreshDue(now + LATEST_RELEASE_TTL_MS + 1000)).toBe(true);
  });

  it("KEEPS the stale value past the TTL — expiry schedules, it never blanks", async () => {
    // The asymmetry that makes this safe: a stale-low latest refuses floors and
    // blocks nobody, while a null latest disables the clamp and lets a mistyped
    // floor through. So an expired entry is still the better answer of the two,
    // and it stays until something better replaces it.
    await refreshLatestRelease();
    expect(isLatestReleaseRefreshDue(Date.now() + LATEST_RELEASE_TTL_MS + 1)).toBe(true);
    expect(cachedLatestRelease()).toBe("1.7.24");
  });

  it("a GitHub OUTAGE leaves the last good value in place", async () => {
    await refreshLatestRelease();
    serve(null); // fetch throws: DNS, TLS, connection reset, abort
    expect(await refreshLatestRelease()).toBe("1.7.24");
    expect(cachedLatestRelease()).toBe("1.7.24");
  });

  it("a RATE LIMIT or any non-2xx is the same as an outage", async () => {
    for (const status of [403, 404, 429, 500, 503]) {
      __resetLatestReleaseForTests();
      serve(REAL_CHANNEL_FILE);
      await refreshLatestRelease();
      serve('{"message":"API rate limit exceeded"}', status);
      expect(await refreshLatestRelease()).toBe("1.7.24");
    }
  });

  it("a 200 carrying GARBAGE is the same as an outage", async () => {
    // The dangerous shape: a proxy or an error page answering 200. A body we
    // cannot read a version out of must not become a version.
    await refreshLatestRelease();
    serve("<!DOCTYPE html><html>error</html>");
    expect(await refreshLatestRelease()).toBe("1.7.24");
  });

  it("backs off after a failure rather than retrying every request", async () => {
    serve(null);
    await refreshLatestRelease();
    expect(cachedLatestRelease()).toBeNull();
    const now = Date.now();
    expect(isLatestReleaseRefreshDue(now + LATEST_RELEASE_RETRY_MS - 1000)).toBe(false);
    expect(isLatestReleaseRefreshDue(now + LATEST_RELEASE_RETRY_MS + 1000)).toBe(true);
    // And the retry is far shorter than the success TTL: an instance that never
    // reached GitHub should converge in a minute, not ten.
    expect(LATEST_RELEASE_RETRY_MS).toBeLessThan(LATEST_RELEASE_TTL_MS);
  });

  it("refuses a body that DECLARES itself huge, without buffering it", async () => {
    // A redirect that landed on the 200MB zip, or something answering for
    // GitHub. Reading it to find out would be its own outage.
    await refreshLatestRelease();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("version: 9.9.9\n", { headers: { "content-length": "199969717" } })
      )
    );
    expect(await refreshLatestRelease()).toBe("1.7.24");
  });

  it("takes a LOWER answer too — a pulled release is a real fact", async () => {
    await refreshLatestRelease();
    serve("version: 1.7.20\n");
    expect(await refreshLatestRelease()).toBe("1.7.20");
  });

  it("is single-flight: a burst of requests is ONE round trip", async () => {
    const spy = serve(REAL_CHANNEL_FILE);
    const all = await Promise.all([
      refreshLatestRelease(),
      refreshLatestRelease(),
      refreshLatestRelease(),
    ]);
    expect(all).toEqual(["1.7.24", "1.7.24", "1.7.24"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never rejects, whatever fetch does", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("synchronous explosion");
    });
    await expect(refreshLatestRelease()).resolves.toBeNull();
  });

  it("says a NEW failure once and repeats itself never", async () => {
    // F-125's own lesson is that a silent failure is the bug — but the desktop
    // fleet asks on a timer, and a line per attempt buries the one that matters.
    serve(null);
    await refreshLatestRelease();
    expect(warn).toHaveBeenCalledTimes(1);
    await refreshLatestRelease();
    expect(warn).toHaveBeenCalledTimes(1);
    serve("<html>nope</html>"); // a DIFFERENT failure is worth a line
    await refreshLatestRelease();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("says NOTHING on the happy path", async () => {
    await refreshLatestRelease();
    expect(warn).not.toHaveBeenCalled();
  });
});

// ── The request path ─────────────────────────────────────────────────────────

/**
 * THE REAL-TIMER FLAKE, FIXED (2026-08-06). These three assertions waited on
 * `vi.waitFor`'s DEFAULT 1000ms budget, and the work they wait for is deferred through
 * `after()` — so the wait is a race against however loaded the machine is. It passed in
 * isolation and failed under the full suite, which is the signature of exactly that, and it
 * was carried as a known flake rather than fixed.
 *
 * FAKE TIMERS ARE NOT THE FIX HERE: the deferred work is a real promise chain around a
 * stubbed `fetch`, not a scheduled timer, so advancing a clock would not release it. What is
 * wrong is the BUDGET, not the mechanism — 1000ms is a guess about machine speed sitting in
 * the middle of an assertion about caching. A budget wide enough that only a genuine hang
 * can exhaust it removes the guess without weakening what is asserted: the polling interval
 * is unchanged, so a passing run is exactly as fast as it was.
 */
const waitForCache = (fn: () => void) =>
  vi.waitFor(fn, { timeout: 15_000, interval: 10 });

describe("scheduleLatestReleaseRefresh", () => {
  it("returns before the round trip does, always", () => {
    // The guarantee the route depends on. A never-resolving fetch is GitHub at
    // its worst — hung rather than down — and the scheduler still returns.
    const spy = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", spy);
    scheduleLatestReleaseRefresh();
    expect(spy).toHaveBeenCalledTimes(1); // the trip really is in flight
    expect(cachedLatestRelease()).toBeNull(); // and nothing waited on it
  });

  it("does nothing at all while the cached value is fresh", async () => {
    await refreshLatestRelease();
    const spy = serve(REAL_CHANNEL_FILE);
    scheduleLatestReleaseRefresh();
    scheduleLatestReleaseRefresh();
    expect(spy).not.toHaveBeenCalled();
  });

  it("a BURST of cold requests is still one round trip", async () => {
    // `after()` defers, so every request in a burst passes the due check with
    // nothing yet in flight. The re-check inside the scheduled work is what
    // stops that from becoming one GitHub trip per boot.
    const spy = serve(REAL_CHANNEL_FILE);
    scheduleLatestReleaseRefresh();
    scheduleLatestReleaseRefresh();
    scheduleLatestReleaseRefresh();
    await waitForCache(() => expect(cachedLatestRelease()).toBe("1.7.24"));
    scheduleLatestReleaseRefresh(); // and the warm cache is left alone after
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("runs detached outside a request scope, so the cache still warms", async () => {
    // `after()` throws where there is no request (tests, scripts); the fallback
    // is the `scheduleEntryEmbedding` idiom. Without it every test below this
    // one would be asserting against a cache nothing ever fills.
    scheduleLatestReleaseRefresh();
    await waitForCache(() => expect(cachedLatestRelease()).toBe("1.7.24"));
  });

  it("honours an injected clock, so the TTL is testable without a timer stub", async () => {
    await refreshLatestRelease();
    const spy = serve("version: 1.9.0\n");
    scheduleLatestReleaseRefresh(Date.now() + LATEST_RELEASE_TTL_MS - 1);
    expect(spy).not.toHaveBeenCalled();
    scheduleLatestReleaseRefresh(Date.now() + LATEST_RELEASE_TTL_MS + 1);
    await waitForCache(() => expect(cachedLatestRelease()).toBe("1.9.0"));
  });
});
