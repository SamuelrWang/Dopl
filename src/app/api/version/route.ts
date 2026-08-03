import { NextResponse } from "next/server";
import { resolveDesktopFloor } from "@/shared/version/desktop-floor";

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
export function GET() {
  const floor = resolveDesktopFloor();
  return NextResponse.json(
    { minSupported: floor.minSupported, latest: floor.latest },
    { headers: { "Cache-Control": "no-store" } }
  );
}
