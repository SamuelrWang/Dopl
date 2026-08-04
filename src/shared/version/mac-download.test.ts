/**
 * THE DOWNLOAD BUTTON'S TARGET, as a failure table.
 *
 * The bug this module replaced was not a crash — it was a link that had 404'd
 * since the day it was written, on the one page whose entire job is that link.
 * Nothing in the repo noticed, because a hardcoded URL has no failure mode a
 * test can observe. So the properties pinned here are the two that would have
 * caught it, plus the ones that keep the fix from becoming a new hazard:
 *
 *   • the asset name is READ from the release feed, never guessed
 *   • every bad day still yields a github.com URL a human can use
 *   • nothing the feed says can point the button off GitHub
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { RELEASE_OWNER, RELEASE_REPO } from "./latest-release";
import {
  MAC_DOWNLOAD_TTL_S,
  RELEASES_PAGE_URL,
  __resetMacDownloadForTests,
  macDownloadUrlFor,
  parseChannelDmgAsset,
  resolveMacDownloadAsset,
  resolveMacDownloadUrl,
} from "./mac-download";

/** The real file, byte-for-byte as GitHub served it while this was written. */
const REAL_CHANNEL_FILE = [
  "version: 1.7.24",
  "files:",
  "  - url: Dopl-1.7.24-arm64-mac.zip",
  "    sha512: oKsY8lynq7QXdJ/jFFEAIoRBJ1dShUBHdhyhurHc/klY==",
  "    size: 199969717",
  "  - url: Dopl-1.7.24-arm64.dmg",
  "    sha512: Kv28dx3sSZcDNDK80DxxCNru7JF2l+sufxr6I3eRs3o==",
  "    size: 200175212",
  "path: Dopl-1.7.24-arm64-mac.zip",
  "sha512: oKsY8lynq7QXdJ/jFFEAIoRBJ1dShUBHdhyhurHc/klY==",
  "releaseDate: '2026-08-03T00:18:37.036Z'",
  "",
].join("\n");

let warn: Mock<(...args: unknown[]) => void>;

/** Stub the ONE round trip. `body` null means "the request failed outright". */
function serve(body: string | null, status = 200, headers?: HeadersInit) {
  const spy = vi.fn(async () => {
    if (body === null) throw new TypeError("fetch failed");
    return new Response(body, { status, headers });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  __resetMacDownloadForTests();
  warn = vi.fn();
  vi.spyOn(console, "warn").mockImplementation(warn);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── The parser ───────────────────────────────────────────────────────────────

describe("parseChannelDmgAsset", () => {
  it("reads the dmg out of a real latest-mac.yml", () => {
    expect(parseChannelDmgAsset(REAL_CHANNEL_FILE)).toBe("Dopl-1.7.24-arm64.dmg");
  });

  it("does NOT return the zip, the blockmap or the `path:` line", () => {
    // `path:` names the zip and sits at column 0; the `files:` entries are
    // indented list items. Only a `.dmg` may come back, or the button hands a
    // visitor an auto-update archive to open by hand.
    const asset = parseChannelDmgAsset(REAL_CHANNEL_FILE);
    expect(asset).not.toContain(".zip");
    expect(asset).not.toContain(".blockmap");
  });

  it("survives the name the artifacts would have if they were ever renamed", () => {
    // The whole point: this keeps working whatever electron-builder's
    // `artifactName` becomes, because it never assumed one.
    expect(parseChannelDmgAsset("files:\n  - url: Dopl-arm64.dmg\n")).toBe("Dopl-arm64.dmg");
    expect(parseChannelDmgAsset("files:\n  - url: Dopl-2.0.0-universal.dmg\n")).toBe(
      "Dopl-2.0.0-universal.dmg"
    );
  });

  it("is null for a body that is not a channel file", () => {
    expect(parseChannelDmgAsset("<!DOCTYPE html><h1>404 Not Found</h1>")).toBeNull();
    expect(parseChannelDmgAsset("version: 1.7.24\n")).toBeNull();
    expect(parseChannelDmgAsset("")).toBeNull();
    expect(parseChannelDmgAsset(null)).toBeNull();
    expect(parseChannelDmgAsset(undefined)).toBeNull();
    expect(parseChannelDmgAsset(42 as unknown as string)).toBeNull();
  });

  it("refuses anything that could re-point the URL off the release", () => {
    // The capture is interpolated into a github.com URL. A name carrying a
    // slash, a scheme, an encoded byte, a query or whitespace is not an asset
    // name — it is an attempt to make this function write a different URL.
    const hostile = [
      "  - url: ../../../../etc/passwd.dmg",
      "  - url: https://evil.example/x.dmg",
      "  - url: //evil.example/x.dmg",
      "  - url: x.dmg?redirect=https://evil.example",
      "  - url: x.dmg#https://evil.example",
      "  - url: %2e%2e%2fx.dmg",
      "  - url: two words.dmg",
      "  - url: x.dmg.exe",
    ];
    for (const line of hostile) {
      expect(parseChannelDmgAsset(`files:\n${line}\n`)).toBeNull();
    }
  });

  it("bounds the name it will accept", () => {
    const tooLong = `files:\n  - url: ${"a".repeat(200)}.dmg\n`;
    expect(parseChannelDmgAsset(tooLong)).toBeNull();
  });

  it("reads only the head of the body", () => {
    // A response that is not the channel file must not be scanned in full.
    const buried = `${"# padding\n".repeat(2000)}files:\n  - url: Dopl-9.9.9-arm64.dmg\n`;
    expect(parseChannelDmgAsset(buried)).toBeNull();
  });
});

// ── The URL ──────────────────────────────────────────────────────────────────

describe("macDownloadUrlFor", () => {
  it("is the evergreen /releases/latest/download/:asset pattern", () => {
    // Evergreen in the RELEASE, not in the asset name — GitHub resolves "latest"
    // and then demands the exact file, which is the half the old constant got
    // wrong. Nothing here may reach for api.github.com (rate-limited per IP on a
    // shared lambda egress; see latest-release.ts).
    expect(macDownloadUrlFor("Dopl-1.7.24-arm64.dmg")).toBe(
      `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}` +
        "/releases/latest/download/Dopl-1.7.24-arm64.dmg"
    );
    expect(macDownloadUrlFor("x.dmg")).not.toContain("api.github.com");
  });

  it("names the repo the desktop app actually publishes to", () => {
    expect(macDownloadUrlFor("x.dmg").startsWith("https://github.com/SamuelrWang/Dopl/")).toBe(true);
  });
});

// ── The resolve ──────────────────────────────────────────────────────────────

describe("resolveMacDownloadUrl", () => {
  it("resolves a real feed to the dmg of the newest release", async () => {
    serve(REAL_CHANNEL_FILE);
    await expect(resolveMacDownloadUrl()).resolves.toBe(
      macDownloadUrlFor("Dopl-1.7.24-arm64.dmg")
    );
  });

  it("asks for the feed once per TTL rather than once per click", async () => {
    const spy = serve(REAL_CHANNEL_FILE);
    await resolveMacDownloadUrl();
    // `fetch`'s second argument, reached without typing the stub's params —
    // an unused-parameter warning is not worth carrying for one assertion.
    const init = (spy.mock.calls[0] as unknown as unknown[])[1] as {
      next?: { revalidate?: number };
    };
    expect(init.next?.revalidate).toBe(MAC_DOWNLOAD_TTL_S);
    expect(MAC_DOWNLOAD_TTL_S).toBeGreaterThan(0);
  });

  it.each([
    ["a network failure", null, 200],
    ["a 404", "Not Found", 404],
    ["a 5xx", "upstream error", 503],
    ["an HTML captive portal", "<!DOCTYPE html><title>Sign in</title>", 200],
    ["a feed with no dmg in it", "version: 1.7.24\npath: Dopl-1.7.24-arm64-mac.zip\n", 200],
    ["an empty body", "", 200],
  ])("falls back to the releases page on %s", async (_label, body, status) => {
    serve(body, status);
    await expect(resolveMacDownloadUrl()).resolves.toBe(RELEASES_PAGE_URL);
  });

  it("refuses a body that declares itself far too large to be a channel file", async () => {
    serve(REAL_CHANNEL_FILE, 200, { "content-length": String(50 * 1024 * 1024) });
    await expect(resolveMacDownloadUrl()).resolves.toBe(RELEASES_PAGE_URL);
  });

  it("never resolves to anything but a github.com release URL", async () => {
    // The one invariant a Download button cannot lose, whatever the feed says.
    for (const body of [null, "", "<html>", "files:\n  - url: https://evil.example/x.dmg\n"]) {
      __resetMacDownloadForTests();
      serve(body);
      const url = await resolveMacDownloadUrl();
      expect(new URL(url).origin).toBe("https://github.com");
      expect(url.startsWith(`https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/`)).toBe(
        true
      );
    }
  });

  it("says a failure once and then shuts up", async () => {
    serve(null);
    await resolveMacDownloadUrl();
    await resolveMacDownloadUrl();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ── The name in the install instructions ─────────────────────────────────────

describe("resolveMacDownloadAsset", () => {
  it("is the file name a user will actually find in Downloads", async () => {
    // `/get-started` prints this in step 2. It is the same read as the URL, so
    // the page cannot name one build while the button serves another.
    serve(REAL_CHANNEL_FILE);
    await expect(resolveMacDownloadAsset()).resolves.toBe("Dopl-1.7.24-arm64.dmg");
  });

  it("is the name INSIDE the url the button uses — one fact, not two", async () => {
    serve(REAL_CHANNEL_FILE);
    const asset = await resolveMacDownloadAsset();
    __resetMacDownloadForTests();
    serve(REAL_CHANNEL_FILE);
    const url = await resolveMacDownloadUrl();
    expect(url).toBe(macDownloadUrlFor(asset!));
  });

  it.each([
    ["a network failure", null, 200],
    ["a 404", "Not Found", 404],
    ["an HTML captive portal", "<!DOCTYPE html><title>Sign in</title>", 200],
    ["a feed with no dmg in it", "version: 1.7.24\npath: Dopl-1.7.24-arm64-mac.zip\n", 200],
  ])("is null on %s — the copy stops naming a file rather than guessing one", async (
    _label,
    body,
    status
  ) => {
    // Null, NOT the releases page: this value goes into a sentence, and a
    // sentence telling somebody to double-click a URL is nonsense. The button
    // beside it still degrades to the releases page on the same failure.
    serve(body, status);
    await expect(resolveMacDownloadAsset()).resolves.toBeNull();
  });

  it("refuses a hostile name for the same reason the URL does", async () => {
    // The name is rendered into the page. It gets the parser's full guarantee,
    // not a softer one — nothing here may become a link or a path.
    serve("files:\n  - url: https://evil.example/x.dmg\n");
    await expect(resolveMacDownloadAsset()).resolves.toBeNull();
  });
});
