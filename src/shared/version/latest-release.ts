import "server-only";
import { after } from "next/server";
import { narrowVersion } from "./desktop-floor";

/**
 * Newest published desktop build, DERIVED (from the updater's channel file), not
 * declared. Reference value for the anti-brick clamp in `desktop-floor.ts`.
 * Rationale for the source choice: docs/ENGINEERING.md § minimum-version gate.
 *
 * ⚠ NEVER ON THE REQUEST PATH. `GET /api/version` answers from the cache below
 * and schedules the refresh via `after()`. Nothing here is awaited by a request,
 * so a GitHub outage can never reach the desktop's boot path.
 *
 * ⚠ EVERY FAILURE MUST DEGRADE TOWARD A LOWER latest — refuses MORE floors,
 * blocks FEWER people. This module may never invent a version HIGHER than the
 * release feed advertises.
 */

/** ⚠ Must mirror `dopl-desktop-app/package.json` → `build.publish[0]`. Test-pinned. */
export const RELEASE_OWNER = "SamuelrWang";
export const RELEASE_REPO = "Dopl";
/** electron-builder's mac channel file, published beside the zip every release. */
export const RELEASE_CHANNEL_FILE = "latest-mac.yml";

/**
 * `/releases/latest/download/:asset` resolves to the newest NON-prerelease
 * release and 302s to the asset CDN. Prereleases invisible on purpose: missing a
 * beta means a lower latest, and lower is the safe direction.
 */
export const LATEST_RELEASE_URL =
  `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}` +
  `/releases/latest/download/${RELEASE_CHANNEL_FILE}`;

/** ANSWER good for a while; NO answer retried sooner. Not a floor-propagation
 *  delay — the floor is still read per request. */
export const LATEST_RELEASE_TTL_MS = 10 * 60 * 1000;
/** After a failure. Short enough to recover, long enough not to hammer GitHub. */
export const LATEST_RELEASE_RETRY_MS = 60 * 1000;
/** Nothing waits on this — bounds a background socket only. */
export const LATEST_RELEASE_TIMEOUT_MS = 4000;

/** Read this much of the body and no more; the rest cannot contain line 1. */
const MAX_FEED_CHARS = 8 * 1024;

/**
 * `version: 1.7.24`, the channel file's first line. ⚠ Anchored to line start
 * (`m`) so indented `- url:`/`version` fragments below cannot match; tolerates
 * quotes and a `v` prefix; narrowed through `narrowVersion` so derived and
 * configured versions share ONE vocabulary. HTML error page / truncated /
 * empty / `version: latest` → `null`.
 */
const CHANNEL_VERSION_RE = /^version:[ \t]*["']?v?([0-9A-Za-z.-]{1,40})["']?[ \t\r]*$/m;

export function parseChannelVersion(body: string | null | undefined): string | null {
  if (typeof body !== "string" || body === "") return null;
  const m = CHANNEL_VERSION_RE.exec(body.slice(0, MAX_FEED_CHARS));
  return m ? narrowVersion(m[1]) : null;
}

// Module state = per lambda instance; a cold instance starts at "never asked".
let value: string | null = null;
let nextAttemptAt = 0; // epoch ms; `0` is "never asked"
let inFlight: Promise<string | null> | null = null;

/**
 * Last version the feed gave us, AT ANY AGE.
 *
 * ⚠ Expiry must NOT blank it. Stale-LOW latest refuses floors and blocks nobody;
 * `null` disables the clamp entirely and lets a mistyped floor through. Expiry
 * only schedules a refresh.
 */
export function cachedLatestRelease(): string | null {
  return value;
}

/** TTL (or failure backoff) elapsed and nothing in flight. */
export function isLatestReleaseRefreshDue(now: number = Date.now()): boolean {
  return inFlight === null && now >= nextAttemptAt;
}

/** Single-flight round trip. ⚠ NEVER rejects: every failure is `null`, which
 *  leaves `value` untouched. */
export function refreshLatestRelease(): Promise<string | null> {
  if (inFlight) return inFlight;
  const run = async (): Promise<string | null> => {
    try {
      const fetched = await fetchChannelVersion();
      const now = Date.now();
      if (fetched) {
        value = fetched;
        nextAttemptAt = now + LATEST_RELEASE_TTL_MS;
      } else {
        nextAttemptAt = now + LATEST_RELEASE_RETRY_MS;
      }
      return value;
    } finally {
      inFlight = null;
    }
  };
  inFlight = run();
  return inFlight;
}

/**
 * The request path's ONE call. Returns immediately, always. `after()` runs the
 * refresh post-flush; outside a request scope (tests, scripts) `after()` throws
 * and the work runs detached instead.
 */
export function scheduleLatestReleaseRefresh(now: number = Date.now()): void {
  if (!isLatestReleaseRefreshDue(now)) return;
  // ⚠ Second check is load-bearing. `after()` defers, so a burst of concurrent
  // boots all pass the check above with nothing yet in flight; without this each
  // callback refetches. Same `now` is fine — the cache changes, not the clock.
  const run = () => {
    if (isLatestReleaseRefreshDue(now)) void refreshLatestRelease();
  };
  try {
    after(run);
  } catch {
    run();
  }
}

async function fetchChannelVersion(): Promise<string | null> {
  try {
    const res = await fetch(LATEST_RELEASE_URL, {
      // github.com 302s to the release-asset CDN — following it IS the request.
      redirect: "follow",
      headers: { accept: "text/yaml, text/plain, */*" },
      // ⚠ This module owns the TTL; Next must not own a second one on top.
      cache: "no-store",
      signal: AbortSignal.timeout(LATEST_RELEASE_TIMEOUT_MS),
    });
    if (!res.ok) return note(`${LATEST_RELEASE_URL} answered ${res.status}`);
    // Channel file is a few hundred bytes; anything declaring itself huge is a
    // redirect landing on an artifact. Buffering it to look would be an outage.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FEED_CHARS) {
      return note(`${RELEASE_CHANNEL_FILE} answered ${declared} bytes, which is not a channel file`);
    }
    const parsed = parseChannelVersion(await res.text());
    return parsed ?? note(`${RELEASE_CHANNEL_FILE} carried no readable version`);
  } catch (err) {
    return note(`${RELEASE_CHANNEL_FILE} fetch failed: ${(err as Error)?.message ?? String(err)}`);
  }
}

/** Warn once per distinct message. A failure here is invisible on the wire (the
 *  clamp falls back), but the desktop asks every 4h — a line per attempt buries
 *  it. Deduped on the message, so a DIFFERENT failure still gets said. */
let lastNote: string | null = null;

function note(detail: string): null {
  if (detail !== lastNote) {
    lastNote = detail;
    console.warn(`[desktop-latest] ${detail} — the anti-brick clamp falls back.`);
  }
  return null;
}

/** Tests only: cache is module state; each case states its own start. */
export function __resetLatestReleaseForTests(): void {
  value = null;
  nextAttemptAt = 0;
  inFlight = null;
  lastNote = null;
}
