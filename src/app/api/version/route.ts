import { NextResponse } from "next/server";
import {
  resolveDesktopFloor,
  MIN_VERSION_ENV,
  LATEST_VERSION_ENV,
  type DesktopVersionFloor,
} from "@/shared/version/desktop-floor";
import {
  cachedLatestRelease,
  scheduleLatestReleaseRefresh,
} from "@/shared/version/latest-release";

export const dynamic = "force-dynamic";

/**
 * `GET /api/version` — the minimum desktop build this server still supports. Server half of the
 * forced-upgrade gate; the desktop compares `app.getVersion()` against `minSupported` at boot and
 * every 4h (`dopl-desktop-app/main/min-version.js`).
 *
 * UNAUTHENTICATED, deliberately: a below-floor build must learn it is below the floor while
 * signed out, and the floor is a public fact.
 * ⚠ THAT TAKES TWO PLACES. `src/proxy.ts` 401s every unmatched `/api/**` before a route runs, so
 * this path must stay in BOTH its PUBLIC_ROUTES and SELF_AUTH_ROUTES. Without them the desktop
 * gets a 401, reads it as "no answer", fails open, and the gate silently blocks nobody — which is
 * how it shipped. `proxy.test.ts` pins the signed-out 200.
 *
 * ⚠ ALWAYS A 200, never 4xx/5xx on a config problem. `minSupported: null` is the fail-open answer
 * and the shape every misconfiguration collapses to, so "no answer" is a DECIDED outcome.
 *
 * NOT CACHED: a CDN entry would put a stale floor in front of the change forcing the upgrade.
 *
 * ⚠ IT TALKS TO GITHUB AND NEVER WAITS FOR IT. The clamp's `latest` is derived from the release
 * feed (`latest-release.ts`), READ from cache here and REFRESHED after the response. Every
 * degraded value refuses MORE floors than the truth, never fewer. `GET` being a SYNCHRONOUS
 * function is the guarantee, not a coincidence; a test pins it.
 */
/**
 * A refused floor is invisible on the wire (served as plain "no floor"), so it is said in the
 * server log where the operator who set the env var will look. Deduped on (reason, value):
 * every desktop asks at boot and every 4h. Module state is per lambda, so worst case is one line
 * per cold start; a CORRECTED value is a new key and says so once more.
 */
let lastRejection: string | null = null;

function reportRejection(floor: DesktopVersionFloor): void {
  const key = floor.rejected
    ? `${floor.rejected}:${process.env[MIN_VERSION_ENV] ?? ""}:${floor.latest ?? ""}:${floor.latestSource ?? ""}`
    : null;
  if (key === lastRejection) return;
  lastRejection = key;
  if (!floor.rejected) return;
  // Derived latest means "publish the build"; declared means "your env var is stale" — opposite
  // fixes, so the line must say which it read.
  const source =
    floor.latestSource === "release-feed"
      ? "the newest published release"
      : LATEST_VERSION_ENV;
  const detail =
    floor.rejected === "malformed"
      ? `is not a version ("${process.env[MIN_VERSION_ENV] ?? ""}")`
      : `is above ${source} (${floor.latest ?? "?"}), so it would block every desktop with nothing to install`;
  console.warn(`[api/version] ${MIN_VERSION_ENV} ${detail} — serving NO floor.`);
}

export function GET() {
  // ⚠ Read, then schedule: the answer uses what this instance already knows; the round trip is a
  // side effect for the NEXT caller.
  const floor = resolveDesktopFloor(process.env, cachedLatestRelease());
  scheduleLatestReleaseRefresh();
  reportRejection(floor);
  return NextResponse.json(
    { minSupported: floor.minSupported, latest: floor.latest },
    { headers: { "Cache-Control": "no-store" } }
  );
}
