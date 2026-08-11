import "server-only";

/**
 * THE MINIMUM DESKTOP BUILD, as a server-authoritative fact.
 *
 * WHY THIS EXISTS (docs/DESKTOP-MIGRATION-PLAN.md, Phase 4 risk register). Once
 * the website is retired the bundled Electron SPA is the ONLY client, so a Mac
 * stuck on an old build is stuck on an old UI forever — there is no Vercel
 * deploy that can fix it. `main/version-skew.js` looks like the gate and is not:
 * it compares a PEER's build for a diagnostic line and documents itself as
 * never gating. This module is the real floor, and `GET /api/version` serves it.
 *
 * WHY AN ENV VAR AND NOT A DB ROW. The floor has to be changeable without a code
 * change, and both options satisfy that. Env wins here because:
 *   • the endpoint is unauthenticated and hit by every desktop at boot and every
 *     4h thereafter — a DB read buys nothing and adds a dependency whose outage
 *     would turn a floor lookup into a 500;
 *   • the change cadence is "once per forced-upgrade event", which is exactly
 *     the cadence of a Vercel env edit + redeploy;
 *   • a DB row is only genuinely code-change-free once something can WRITE it,
 *     i.e. an admin surface that does not exist. Until then it is a migration
 *     plus a hand-run SQL statement, which is strictly worse than an env edit.
 * It is read at REQUEST time (never at module scope), so the value cannot be
 * frozen into a build.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY. The floor is a forced-upgrade nudge that
 * a cooperating client obeys; a client that lies about its version, or simply
 * never asks, is unaffected. That is the same framing as
 * `src/shared/auth/app-version-header.ts` and the reason this floor is PULLED by
 * the client rather than enforced as a 426 on `/api/**`.
 */

/**
 * Vercel env: the oldest desktop build allowed to proceed. OVERRIDE, not the
 * only source — when unset, `DEFAULT_MIN_VERSION` below is the floor (Stage C,
 * 2026-08-05: the floor rides code so raising it is a normal deploy and needs
 * no dashboard access). Set the env to reposition the floor without a deploy,
 * or to one of the OFF spellings ("", "none", "0", "off") to run floorless.
 */
export const MIN_VERSION_ENV = "DOPL_DESKTOP_MIN_VERSION";

/**
 * The floor when the env var is UNSET. Bump this in the release that should
 * become mandatory — its cadence is "once per forced-upgrade event", which is
 * release cadence, which is code cadence. A test pins it at or below
 * `DEFAULT_DECLARED_LATEST`, so bumping one without the other fails the build
 * instead of arming the anti-brick clamp against our own floor.
 */
export const DEFAULT_MIN_VERSION = "1.10.0";

/** Env spellings that mean "no floor, on purpose" rather than a typo. */
const FLOOR_OFF = new Set(["", "none", "0", "off"]);
/**
 * Vercel env: the newest desktop build actually published. OPTIONAL, and its
 * only job is the anti-brick clamp below — it is never a floor of its own.
 *
 * IT IS NO LONGER THE PRIMARY SOURCE. `latest-release.ts` derives that number
 * from the release feed the updater already reads, because a hand-bumped value
 * goes stale in silence and a stale clamp refuses legitimate floors (F-125).
 * This var survives as the cold-start fallback for the minutes before an
 * instance has reached GitHub, and as the manual override for a feed that has
 * gone away. Leave it UNSET unless one of those is true.
 */
export const LATEST_VERSION_ENV = "DOPL_DESKTOP_LATEST_VERSION";

/**
 * The declared latest when the env var is UNSET — the cold-start clamp
 * fallback, set alongside `DEFAULT_MIN_VERSION` in the same release commit so
 * the clamp can never refuse the floor shipped beside it. The release feed
 * still wins whenever an instance has reached it (derived beats declared).
 */
export const DEFAULT_DECLARED_LATEST = "1.10.2";

/**
 * `1.8.2`, optionally `1.9.0-beta.2`. Deliberately the same shape as
 * `APP_VERSION_HEADER`'s predicate and deliberately RE-STATED rather than
 * imported: that one narrows an attacker-settable header, this one narrows an
 * operator-set config value, and the two must stay free to diverge. A test pins
 * that they currently agree, so a drift is a decision, not an accident.
 */
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,16})?$/;

/** Why a configured floor was refused. `null` when the floor was served as-is. */
export type FloorRejection = "malformed" | "above-latest";

/** Where `latest` came from. The refusal log has to name it, or it misleads. */
export type LatestSource = "release-feed" | "env";

export interface DesktopVersionFloor {
  /** The floor a client must meet, or `null` for "no floor" (fail-open). */
  minSupported: string | null;
  /** The newest published build, derived or declared. `null` = no clamp. */
  latest: string | null;
  /** Which of the two produced `latest`. `null` exactly when `latest` is. */
  latestSource: LatestSource | null;
  /** Set when a floor WAS configured and this module refused to serve it. */
  rejected: FloorRejection | null;
}

/**
 * The configured value, or `null`. Untrimmed and uncoerced on purpose: an env
 * var with a stray space is a misconfiguration to notice, and the failure of
 * noticing it is "no floor", which is the safe direction.
 */
export function narrowVersion(raw: string | null | undefined): string | null {
  return typeof raw === "string" && VERSION_RE.test(raw) ? raw : null;
}

/** `[major, minor, patch]`, or `null` for anything that is not a version. */
function releaseTriple(value: string): [number, number, number] | null {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})/.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * `-1 | 0 | 1`, or `null` when either side is unreadable. Only the release
 * triple is ordered; a pre-release tag is parsed off and ignored, so `1.9.0-rc.1`
 * and `1.9.0` compare equal — the same rule `main/version-skew.js` uses, and the
 * one that keeps a beta of the floor build from being told to upgrade to itself.
 *
 * `null` is NOT an ordering. Every caller reads it as "do not act".
 */
export function compareReleases(a: string, b: string): -1 | 0 | 1 | null {
  const x = releaseTriple(a);
  const y = releaseTriple(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Resolve the floor to serve, defensively.
 *
 * THE FAILURE MODE THIS GUARDS. A floor set ABOVE the newest published build
 * blocks every user with nothing to upgrade to — a self-inflicted outage with no
 * client-side remedy. So when a `latest` is known, a floor above it is REFUSED
 * here rather than shipped: the deploy that would have bricked the fleet instead
 * serves "no floor". A stale-low `latest` therefore fails toward nobody being
 * blocked, which is the direction we want to fail in. (The client carries a
 * second, independent guard grounded in what the updater actually finds on the
 * release feed — see `main/min-version.js`.)
 *
 * DERIVED BEATS DECLARED. `derivedLatest` comes from the release feed
 * (`latest-release.ts`) and is a fact about what EXISTS; the env var is a claim
 * about what should, and a claim can run ahead of reality — `dopl-desktop-app/
 * package.json` is ahead of the newest published release as this is written.
 * Ahead is the direction that bricks, so the fact wins whenever there is one and
 * the claim is only consulted when there is not.
 *
 * THIS FUNCTION STAYS PURE. The derived value arrives as an argument rather than
 * by import, so the resolver keeps no socket, no cache and no clock, and the one
 * caller that has those things is the route.
 *
 * `env` is injectable for tests; production passes nothing and reads the live
 * process env, once per request.
 */
export function resolveDesktopFloor(
  env: Record<string, string | undefined> = process.env,
  derivedLatest: string | null = null
): DesktopVersionFloor {
  const configured = env[MIN_VERSION_ENV] ?? DEFAULT_MIN_VERSION;
  const derived = narrowVersion(derivedLatest);
  // "env" as a source now covers the code default too — both are declarations
  // (claims about what should exist), as opposed to the feed's derived fact.
  const declared = narrowVersion(env[LATEST_VERSION_ENV] ?? DEFAULT_DECLARED_LATEST);
  const latest = derived ?? declared;
  const latestSource: LatestSource | null = derived ? "release-feed" : declared ? "env" : null;

  // An explicit OFF spelling is a decision, not a typo: floorless, no rejection.
  if (FLOOR_OFF.has(configured.trim().toLowerCase())) {
    return { minSupported: null, latest, latestSource, rejected: null };
  }
  const floor = narrowVersion(configured);

  // Configured but unreadable: serve no floor. A typo must never brick a fleet.
  if (!floor) {
    return { minSupported: null, latest, latestSource, rejected: "malformed" };
  }
  if (latest && compareReleases(floor, latest) === 1) {
    return { minSupported: null, latest, latestSource, rejected: "above-latest" };
  }
  return { minSupported: floor, latest, latestSource, rejected: null };
}
