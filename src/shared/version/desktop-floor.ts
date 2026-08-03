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

/** Vercel env: the oldest desktop build allowed to proceed. Unset = no floor. */
export const MIN_VERSION_ENV = "DOPL_DESKTOP_MIN_VERSION";
/**
 * Vercel env: the newest desktop build actually published. OPTIONAL, and its
 * only job is the anti-brick clamp below — it is never a floor of its own.
 */
export const LATEST_VERSION_ENV = "DOPL_DESKTOP_LATEST_VERSION";

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

export interface DesktopVersionFloor {
  /** The floor a client must meet, or `null` for "no floor" (fail-open). */
  minSupported: string | null;
  /** The newest published build, when the operator has declared one. */
  latest: string | null;
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
 * client-side remedy. So when the operator has declared a `latest`, a floor
 * above it is REFUSED here rather than shipped: the deploy that would have
 * bricked the fleet instead serves "no floor". A stale-low `latest` therefore
 * fails toward nobody being blocked, which is the direction we want to fail in.
 * (The client carries a second, independent guard grounded in what the updater
 * actually finds on the release feed — see `main/min-version.js`.)
 *
 * `env` is injectable for tests; production passes nothing and reads the live
 * process env, once per request.
 */
export function resolveDesktopFloor(
  env: Record<string, string | undefined> = process.env
): DesktopVersionFloor {
  const configured = env[MIN_VERSION_ENV];
  const latest = narrowVersion(env[LATEST_VERSION_ENV]);
  const floor = narrowVersion(configured);

  // Configured but unreadable: serve no floor. A typo must never brick a fleet.
  if (!floor) {
    const present = typeof configured === "string" && configured.trim() !== "";
    return { minSupported: null, latest, rejected: present ? "malformed" : null };
  }
  if (latest && compareReleases(floor, latest) === 1) {
    return { minSupported: null, latest, rejected: "above-latest" };
  }
  return { minSupported: floor, latest, rejected: null };
}
