import { NextResponse } from "next/server";
import {
  resolveDesktopFloor,
  MIN_VERSION_ENV,
  LATEST_VERSION_ENV,
  type DesktopVersionFloor,
} from "@/shared/version/desktop-floor";

export const dynamic = "force-dynamic";

/**
 * `GET /api/version` — the minimum desktop build this server still supports.
 *
 * The one server-authoritative half of the forced-upgrade gate (Phase 4
 * prerequisite; see `src/shared/version/desktop-floor.ts` for why the floor is
 * an env var). The desktop asks at boot and on the updater's own 4h cadence,
 * compares its `app.getVersion()` against `minSupported`, and blocks itself when
 * it is below — see `dopl-desktop-app/main/min-version.js`.
 *
 * UNAUTHENTICATED, deliberately. A below-floor build must learn it is below the
 * floor even while signed out, and there is nothing here to protect: the floor
 * is the same public fact for every caller and the release feed already carries
 * it. Adding auth would mean an old build could only be told to upgrade after it
 * finished a sign-in flow it may be too old to complete.
 *
 * WHICH TAKES TWO PLACES, NOT ONE. Having no auth wrapper here is not enough:
 * `src/proxy.ts` 401s every unmatched `/api/**` path before a route runs, so
 * this path is listed in its PUBLIC_ROUTES **and** SELF_AUTH_ROUTES. Without
 * those entries the desktop gets a 401, reads it as "no answer", fails open, and
 * the entire forced-upgrade gate silently never blocks anyone — which is exactly
 * how it shipped, and how a live `version gate: floor fetch 401` caught it.
 * `proxy.test.ts` pins the signed-out 200.
 *
 * ALWAYS A 200. `minSupported: null` is the fail-open answer and the shape every
 * misconfiguration collapses to (unset env, a typo, a floor above the declared
 * latest). This route never 4xx/5xxs on a config problem, because a client that
 * cannot read a floor treats the check as "no answer" and proceeds — and we want
 * "no answer" to be the DECIDED outcome of a bad config, not an accident of it.
 *
 * NOT CACHED. The client asks at most a few times a day per Mac, so a CDN entry
 * buys nothing and would put a stale floor in front of the change the operator
 * just made to force an upgrade.
 */
/**
 * A REFUSED floor is invisible on the wire — it is served as the same plain "no
 * floor" a correct unset config produces, which is what makes it safe and also
 * what makes it silent. The one person who can fix it is the operator who set
 * the env var, so it is said in the server log, where they will look.
 *
 * Deduped on (reason, value): every desktop asks at boot and every 4h, and a
 * line per request would bury the one that matters. Module state is per lambda
 * instance, so the worst case is one line per cold start, and a CORRECTED value
 * is a new key and says so once more.
 */
let lastRejection: string | null = null;

function reportRejection(floor: DesktopVersionFloor): void {
  const key = floor.rejected ? `${floor.rejected}:${process.env[MIN_VERSION_ENV] ?? ""}` : null;
  if (key === lastRejection) return;
  lastRejection = key;
  if (!floor.rejected) return;
  const detail =
    floor.rejected === "malformed"
      ? `is not a version ("${process.env[MIN_VERSION_ENV] ?? ""}")`
      : `is above ${LATEST_VERSION_ENV} (${floor.latest ?? "?"}), so it would block every desktop with nothing to install`;
  console.warn(`[api/version] ${MIN_VERSION_ENV} ${detail} — serving NO floor.`);
}

export function GET() {
  const floor = resolveDesktopFloor();
  reportRejection(floor);
  return NextResponse.json(
    { minSupported: floor.minSupported, latest: floor.latest },
    { headers: { "Cache-Control": "no-store" } }
  );
}
