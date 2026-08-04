import "server-only";
import { after } from "next/server";
import { narrowVersion } from "./desktop-floor";

/**
 * THE NEWEST PUBLISHED DESKTOP BUILD, derived instead of declared.
 *
 * WHY THIS EXISTS (F-125 residual). The anti-brick clamp in `desktop-floor.ts`
 * refuses any floor above "latest", and "latest" was a hand-bumped env var. A
 * hand-bumped number goes stale in silence, and stale means the clamp starts
 * refusing LEGITIMATE floors: the gate fails safe (nobody is blocked) and also
 * fails useless (the operator can no longer raise the floor, and nothing says
 * so). A clamp whose reference value decays is a clamp that quietly turns off.
 *
 * WHY THE UPDATER'S CHANNEL FILE AND NOT THE REST API. The obvious source is
 * `api.github.com/repos/:owner/:repo/releases/latest`. It lost on four counts:
 *   • RATE LIMIT. Unauthenticated is 60/hr per IP, and a Vercel lambda has no IP
 *     of its own — it egresses from a shared pool it shares with strangers. The
 *     first probe written while designing this module got `403 API rate limit
 *     exceeded` from an ordinary IP before it ever got a release. A source that
 *     is already 403ing is not a source, and the credential that would fix it is
 *     a new secret on the boot path of an UNAUTHENTICATED endpoint.
 *   • IT IS THE SAME FACT THE CLIENT USES. `latest-mac.yml` is the byte-for-byte
 *     file `electron-updater` consumes (`main/updater.js` takes the feed from the
 *     baked `app-update.yml`). Deriving from it makes the server's clamp and the
 *     client's GUARD 2 two readings of ONE fact rather than two facts that drift.
 *   • A TAG IS NOT A BUILD. `tag_name` exists the moment a release is created,
 *     with or without a mac artifact behind it. `version:` inside the channel
 *     file exists only because a build was uploaded, which is the exact question
 *     the clamp asks: "is there something a blocked Mac could install?"
 *   • IT IS NOT THE API. The channel file is a release ASSET: github.com 302s to
 *     the asset CDN, outside the REST quota entirely.
 *
 * WHY NOT BUMP IT AT RELEASE TIME (the rejected design). A `postpublish` step
 * writing `dopl-desktop-app/package.json`'s version somewhere is worse, not
 * better: that file says `1.8.2` today while the newest PUBLISHED release is
 * `1.7.24`. Publish-time automation would therefore declare a "latest" that does
 * not exist and hand the clamp permission to serve a floor nothing can install —
 * a NEW way to brick the fleet, which is the one thing this may not add. It also
 * wants a Vercel write credential inside a manual, laptop-run release, and it
 * fails the same silent way the hand bump does (a release run where the step
 * errors is a release that left the value stale). `package.json` is a claim
 * about what SHOULD ship; the channel file is the record of what DID.
 *
 * NEVER ON THE REQUEST PATH. `GET /api/version` answers out of the cache below
 * and schedules the refresh for afterwards (`after()`), so the route's latency
 * is unchanged whether GitHub is fast, slow, rate-limited or gone. Nothing here
 * is awaited by a request, which is what keeps a GitHub outage from being able
 * to reach the desktop's boot path at all.
 *
 * EVERY FAILURE DEGRADES THE SAME DIRECTION — toward a LOWER latest, which makes
 * the clamp refuse MORE floors, which blocks FEWER people:
 *   fetch throws / times out / 5xx / 403 → keep the last value, retry sooner
 *   body is HTML, empty, or version-less → same
 *   never succeeded at all               → fall back to the env var, then to
 *                                          `null`, which is today's behavior
 * The one thing this module can never do is invent a version HIGHER than what
 * the release feed actually advertises to the updater.
 */

/** Mirrors `dopl-desktop-app/package.json` → `build.publish[0]`. A test pins it. */
export const RELEASE_OWNER = "SamuelrWang";
export const RELEASE_REPO = "Dopl";
/** electron-builder's mac channel file. Published beside the zip on every release. */
export const RELEASE_CHANNEL_FILE = "latest-mac.yml";

/**
 * `/releases/latest/download/:asset` resolves to the newest NON-prerelease
 * release and 302s to the asset CDN. Prereleases are invisible here on purpose:
 * missing a beta means a lower latest, and lower is the safe direction.
 */
export const LATEST_RELEASE_URL =
  `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}` +
  `/releases/latest/download/${RELEASE_CHANNEL_FILE}`;

/**
 * Cadence, the `version-gate.js` shape: an ANSWER is good for a while, NO answer
 * is retried sooner. Ten minutes is chosen against the operator's real loop —
 * publish, then set `DOPL_DESKTOP_MIN_VERSION`, which redeploys and cold-starts
 * every instance anyway — so this only governs an instance that outlives a
 * release. It is not a floor-propagation delay: the floor is still read per
 * request.
 */
export const LATEST_RELEASE_TTL_MS = 10 * 60 * 1000;
/** After a failure. Short enough to recover, long enough not to hammer GitHub. */
export const LATEST_RELEASE_RETRY_MS = 60 * 1000;
/** Nothing waits on this, so the timeout only bounds a background socket. */
export const LATEST_RELEASE_TIMEOUT_MS = 4000;

/** Read this much of the body and no more; the rest cannot contain line 1. */
const MAX_FEED_CHARS = 8 * 1024;

/**
 * `version: 1.7.24`, the channel file's first line.
 *
 * Anchored to a line start (`m`) so the indented `- url:`/`version` fragments
 * further down cannot match, tolerant of quotes (`'1.7.24'`) and of a `v` prefix
 * the file does not currently use but a tag would (`v1.7.24`), and narrowed
 * through `narrowVersion` so a derived version and a configured one are held to
 * the SAME vocabulary. Anything else — an HTML error page, a truncated body, an
 * empty file, `version: latest` — is `null`.
 */
const CHANNEL_VERSION_RE = /^version:[ \t]*["']?v?([0-9A-Za-z.-]{1,40})["']?[ \t\r]*$/m;

export function parseChannelVersion(body: string | null | undefined): string | null {
  if (typeof body !== "string" || body === "") return null;
  const m = CHANNEL_VERSION_RE.exec(body.slice(0, MAX_FEED_CHARS));
  return m ? narrowVersion(m[1]) : null;
}

/**
 * The cache is three variables on purpose: it holds ONE value and there is
 * nothing to evict. Module state is per lambda instance, so a cold instance
 * simply starts from "never asked" and warms on its first request.
 */
let value: string | null = null; // the newest version the feed has ever given us
let nextAttemptAt = 0; // epoch ms; `0` is "never asked"
let inFlight: Promise<string | null> | null = null;

/**
 * The last version the feed gave us, AT ANY AGE.
 *
 * Expiry deliberately does not blank it. A stale-LOW latest refuses floors,
 * which blocks nobody; a `null` latest disables the clamp entirely and lets a
 * mistyped floor straight through. Serving stale is therefore the safe read and
 * dropping to `null` is the unsafe one, so expiry only schedules a refresh.
 */
export function cachedLatestRelease(): string | null {
  return value;
}

/** True when the TTL (or the failure backoff) has run out and nothing is in flight. */
export function isLatestReleaseRefreshDue(now: number = Date.now()): boolean {
  return inFlight === null && now >= nextAttemptAt;
}

/**
 * One round trip, single-flight, and it NEVER rejects: every failure is `null`,
 * which the caller reads as "no answer" and which leaves `value` untouched.
 */
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
 * refresh once the response has flushed, which is what makes "GitHub is down"
 * unable to cost `/api/version` a millisecond; outside a request scope (tests,
 * scripts) `after()` throws and the work runs detached instead — the
 * `scheduleEntryEmbedding` idiom.
 */
export function scheduleLatestReleaseRefresh(now: number = Date.now()): void {
  if (!isLatestReleaseRefreshDue(now)) return;
  // Checked TWICE, and the second one is the load-bearing one. `after()` defers,
  // so a burst of concurrent boots all pass the check above with nothing yet in
  // flight; without this the first callback would fill the cache and the rest
  // would each go and fill it again. Re-reading the same `now` is enough: what
  // changes between the two checks is the cache, not the clock.
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
      // This module owns the TTL above; Next must not own a second one on top.
      cache: "no-store",
      signal: AbortSignal.timeout(LATEST_RELEASE_TIMEOUT_MS),
    });
    if (!res.ok) return note(`${LATEST_RELEASE_URL} answered ${res.status}`);
    // The channel file is a few hundred bytes. Anything declaring itself huge is
    // not it — a redirect landed on an artifact, or something is answering for
    // GitHub — and buffering it to look would be its own outage.
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

/**
 * Says it once, then shuts up. A failure here is invisible on the wire (the
 * clamp just falls back), and F-125's own lesson is that an invisible failure is
 * the bug — but the desktop asks every 4h and a line per attempt would bury it.
 * Deduped on the message, so a DIFFERENT failure still gets said.
 */
let lastNote: string | null = null;

function note(detail: string): null {
  if (detail !== lastNote) {
    lastNote = detail;
    console.warn(`[desktop-latest] ${detail} — the anti-brick clamp falls back.`);
  }
  return null;
}

/** Tests only: the cache is module state and each case states its own start. */
export function __resetLatestReleaseForTests(): void {
  value = null;
  nextAttemptAt = 0;
  inFlight = null;
  lastNote = null;
}
