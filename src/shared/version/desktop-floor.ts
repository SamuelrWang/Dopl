import "server-only";

/**
 * Minimum desktop build, server-authoritative. Served by `GET /api/version`.
 * ⚠ `main/version-skew.js` looks like the gate and is NOT — it compares a PEER's
 * build for a diagnostic line. This module is the real floor.
 * ⚠ Read at REQUEST time, never module scope, so it cannot freeze into a build.
 * ⚠ NOT A SECURITY BOUNDARY: a forced-upgrade nudge a cooperating client obeys.
 * Same framing as `src/shared/auth/app-version-header.ts`, and why the client
 * PULLS it rather than us enforcing a 426 on `/api/**`.
 */

/**
 * Vercel env: oldest desktop build allowed to proceed. OVERRIDE only — unset
 * means `DEFAULT_MIN_VERSION` below. Set to an OFF spelling ("", "none", "0",
 * "off") to run floorless.
 */
export const MIN_VERSION_ENV = "DOPL_DESKTOP_MIN_VERSION";

/**
 * Floor when the env var is UNSET. Bump in the release that should become
 * mandatory. ⚠ A test pins it at or below `DEFAULT_DECLARED_LATEST` — bumping
 * one without the other fails the build rather than arming the anti-brick clamp
 * against our own floor.
 */
export const DEFAULT_MIN_VERSION = "1.21.0";

/** Env spellings that mean "no floor, on purpose" rather than a typo. */
const FLOOR_OFF = new Set(["", "none", "0", "off"]);
/**
 * Vercel env: newest desktop build actually published. OPTIONAL, feeds the
 * anti-brick clamp only — never a floor of its own.
 *
 * ⚠ Leave UNSET. `latest-release.ts` derives this from the release feed; a
 * hand-bumped value goes stale in silence and a stale clamp refuses legitimate
 * floors (F-125). Only for the cold-start window or a vanished feed.
 */
export const LATEST_VERSION_ENV = "DOPL_DESKTOP_LATEST_VERSION";

/** Declared latest when the env var is UNSET — cold-start clamp fallback. ⚠ Set
 *  alongside `DEFAULT_MIN_VERSION` in the SAME release commit so the clamp can
 *  never refuse the floor shipped beside it. Release feed wins when reachable. */
export const DEFAULT_DECLARED_LATEST = "1.21.0";

/**
 * `1.8.2`, optionally `1.9.0-beta.2`. ⚠ Deliberately RE-STATED rather than
 * imported from `APP_VERSION_HEADER`'s predicate: that narrows an
 * attacker-settable header, this narrows an operator-set config value, and the
 * two must stay free to diverge. A test pins that they currently agree.
 */
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,16})?$/;

/** Why a configured floor was refused. `null` when the floor was served as-is. */
export type FloorRejection = "malformed" | "above-latest";

/** Where `latest` came from — the refusal log must name it, or it misleads. */
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

/** ⚠ Untrimmed and uncoerced on purpose: an env var with a stray space is a
 *  misconfiguration to notice, and failing to notice yields "no floor" — the
 *  safe direction. */
export function narrowVersion(raw: string | null | undefined): string | null {
  return typeof raw === "string" && VERSION_RE.test(raw) ? raw : null;
}

/** `[major, minor, patch]`, or `null` for anything that is not a version. */
function releaseTriple(value: string): [number, number, number] | null {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})/.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * `-1 | 0 | 1`, or `null` when either side is unreadable. ⚠ Only the release
 * triple is ordered; a pre-release tag is parsed off and ignored, so
 * `1.9.0-rc.1` and `1.9.0` compare equal — same rule as `main/version-skew.js`,
 * and what keeps a beta of the floor build from being told to upgrade to itself.
 *
 * ⚠ `null` is NOT an ordering. Every caller reads it as "do not act".
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
 * ⚠ ANTI-BRICK CLAMP: a floor above the newest published build blocks every user
 * with nothing to upgrade to — a self-inflicted outage with no client-side
 * remedy. When `latest` is known, a floor above it is REFUSED here and "no
 * floor" is served instead. A stale-low `latest` therefore fails toward nobody
 * blocked. (Client carries an independent second guard — `main/min-version.js`.)
 *
 * ⚠ DERIVED BEATS DECLARED. `derivedLatest` (release feed) is a fact about what
 * EXISTS; the env var is a claim that can run AHEAD of reality, and ahead is the
 * direction that bricks. The claim is consulted only when there is no fact.
 *
 * ⚠ STAYS PURE — derived value arrives as an argument, not by import: no socket,
 * no cache, no clock. `env` injectable for tests; production reads live process
 * env once per request.
 */
export function resolveDesktopFloor(
  env: Record<string, string | undefined> = process.env,
  derivedLatest: string | null = null
): DesktopVersionFloor {
  const configured = env[MIN_VERSION_ENV] ?? DEFAULT_MIN_VERSION;
  const derived = narrowVersion(derivedLatest);
  // Source "env" covers the code default too — both are declarations.
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
