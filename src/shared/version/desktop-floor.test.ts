/**
 * The desktop minimum-version FLOOR, as a truth table. ⚠ Misconfiguring it takes
 * the product away from every user at once, so every branch asks "does a mistake
 * here fail toward NOBODY being blocked?" and the answer must be yes:
 *
 *   1. blank/OFF-spelled / malformed floor → `minSupported: null` (no floor)
 *   2. floor above the declared `latest`   → refused, `minSupported: null`
 *   3. only a well-formed, reachable floor is ever served
 *
 * ⚠ UNSET env means the CODE DEFAULT (`DEFAULT_MIN_VERSION`), not "no floor" —
 * fail-open requires an explicit OFF spelling. Every MISTAKE shape (typo,
 * malformed) still fails to "no floor".
 *
 * ⚠ (2) depends on `latest` being current: stale-LOW refuses a legitimate floor
 * (annoying, safe), missing disables the clamp (client updater guard backstops).
 * Hence `latest` is DERIVED from the release feed, env is only fallback.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_DECLARED_LATEST,
  DEFAULT_MIN_VERSION,
  MIN_VERSION_ENV,
  LATEST_VERSION_ENV,
  compareReleases,
  narrowVersion,
  resolveDesktopFloor,
} from "./desktop-floor";
import { narrowAppVersion } from "@/shared/auth/app-version-header";

const env = (min?: string, latest?: string): Record<string, string | undefined> => ({
  [MIN_VERSION_ENV]: min,
  [LATEST_VERSION_ENV]: latest,
});

describe("narrowVersion", () => {
  it("accepts a release triple and a short pre-release tag", () => {
    expect(narrowVersion("1.8.2")).toBe("1.8.2");
    expect(narrowVersion("1.9.0-beta.2")).toBe("1.9.0-beta.2");
    expect(narrowVersion("0.0.0")).toBe("0.0.0");
  });

  it("rejects everything else, including the near-misses an operator types", () => {
    for (const bad of [
      "v1.8.2",
      "1.8",
      "1.8.2.1",
      " 1.8.2",
      "1.8.2 ",
      "latest",
      "",
      "   ",
      null,
      undefined,
    ]) {
      expect(narrowVersion(bad)).toBeNull();
    }
  });

  it("agrees with the app-version HEADER predicate (the drift alarm)", () => {
    // ⚠ Deliberately separate regexes (operator config vs attacker-settable
    // header) that describe the same vocabulary today. A change to one that is
    // not a decision about both fails here.
    for (const v of ["1.8.2", "1.9.0-beta.2", "0.0.0", "9999.9999.9999"]) {
      expect(narrowVersion(v)).toBe(narrowAppVersion(v) ?? null);
    }
    for (const bad of ["v1.8.2", "1.8", "1.8.2.1", "", "latest"]) {
      expect(narrowVersion(bad)).toBeNull();
      expect(narrowAppVersion(bad)).toBeUndefined();
    }
  });
});

describe("compareReleases", () => {
  it("orders component-wise and numerically, never lexically", () => {
    expect(compareReleases("1.8.1", "1.8.2")).toBe(-1);
    expect(compareReleases("1.8.2", "1.8.2")).toBe(0);
    expect(compareReleases("1.8.3", "1.8.2")).toBe(1);
    expect(compareReleases("1.8.9", "1.8.10")).toBe(-1);
    expect(compareReleases("1.9.0", "1.8.99")).toBe(1);
    expect(compareReleases("2.0.0", "1.99.99")).toBe(1);
  });

  it("ignores the pre-release tag: a beta of the floor build IS the floor build", () => {
    // Else a 1.9.0-rc.1 tester is told to upgrade to the build they're running.
    expect(compareReleases("1.9.0-rc.1", "1.9.0")).toBe(0);
    expect(compareReleases("1.9.0-rc.1", "1.8.2")).toBe(1);
  });

  it("answers null for the unreadable, which is not an ordering", () => {
    expect(compareReleases("nope", "1.8.2")).toBeNull();
    expect(compareReleases("1.8.2", "")).toBeNull();
  });
});

describe("resolveDesktopFloor", () => {
  it("serves a well-formed floor", () => {
    expect(resolveDesktopFloor(env("1.8.2"))).toEqual({
      minSupported: "1.8.2",
      latest: DEFAULT_DECLARED_LATEST,
      latestSource: "env",
      rejected: null,
    });
  });

  it("serves the CODE DEFAULT floor when the env var is unset (Stage C)", () => {
    for (const e of [env(), {}]) {
      expect(resolveDesktopFloor(e)).toEqual({
        minSupported: DEFAULT_MIN_VERSION,
        latest: DEFAULT_DECLARED_LATEST,
        latestSource: "env",
        rejected: null,
      });
    }
  });

  it("ships defaults the clamp can never refuse (the same-commit pin)", () => {
    // ⚠ Bumping DEFAULT_MIN_VERSION without DEFAULT_DECLARED_LATEST arms the
    // anti-brick clamp against our own floor. Fail the build instead.
    expect(narrowVersion(DEFAULT_MIN_VERSION)).toBe(DEFAULT_MIN_VERSION);
    expect(narrowVersion(DEFAULT_DECLARED_LATEST)).toBe(DEFAULT_DECLARED_LATEST);
    expect(compareReleases(DEFAULT_MIN_VERSION, DEFAULT_DECLARED_LATEST)).not.toBe(1);
  });

  it("a MALFORMED floor blocks nobody, and says so", () => {
    // ⚠ `DOPL_DESKTOP_MIN_VERSION=v1.8.2` must not become a floor of "v1.8.2"
    // that no build can satisfy.
    for (const bad of ["v1.8.2", "1.8", "latest", "1.8.2 ", "not a version"]) {
      const out = resolveDesktopFloor(env(bad));
      expect(out.minSupported).toBeNull();
      expect(out.rejected).toBe("malformed");
    }
  });

  it("an OFF spelling is a decision — floorless, and not 'malformed'", () => {
    for (const off of ["", "   ", "none", "0", "off", "OFF", "None"]) {
      expect(resolveDesktopFloor(env(off))).toEqual({
        minSupported: null,
        latest: DEFAULT_DECLARED_LATEST,
        latestSource: "env",
        rejected: null,
      });
    }
  });

  it("REFUSES a floor above the declared latest (the anti-brick clamp)", () => {
    // ⚠ Fleet-outage shape: floor above the newest build that exists — every
    // client blocks with nothing to upgrade to.
    const out = resolveDesktopFloor(env("1.9.0", "1.8.2"));
    expect(out.minSupported).toBeNull();
    expect(out.rejected).toBe("above-latest");
    expect(out.latest).toBe("1.8.2");
    expect(out.latestSource).toBe("env");
  });

  it("a floor EQUAL to latest is legitimate and is served", () => {
    expect(resolveDesktopFloor(env("1.8.2", "1.8.2")).minSupported).toBe("1.8.2");
    expect(resolveDesktopFloor(env("1.8.1", "1.8.2")).minSupported).toBe("1.8.1");
  });

  it("a malformed LATEST disables the clamp instead of voiding the floor", () => {
    // latest is advisory; an unreadable one must not take a good floor with it.
    const out = resolveDesktopFloor(env("1.8.2", "v1.9.0"));
    expect(out.minSupported).toBe("1.8.2");
    expect(out.latest).toBeNull();
  });

  it("prefers the DERIVED latest over the declared one, in both directions", () => {
    // ⚠ Env is a CLAIM about what should be published; the feed is the RECORD
    // of what is. The fact wins whichever way the disagreement runs.
    // Stale-LOW env: derivation UNSTICKS a legitimate floor.
    const unstuck = resolveDesktopFloor(env("1.9.0", "1.8.2"), "1.9.0");
    expect(unstuck.minSupported).toBe("1.9.0");
    expect(unstuck.latest).toBe("1.9.0");
    expect(unstuck.latestSource).toBe("release-feed");

    // Stale-HIGH env (brick case): derivation REFUSES a floor the declared
    // value would have waved through.
    const refused = resolveDesktopFloor(env("1.8.2", "1.8.2"), "1.7.24");
    expect(refused.minSupported).toBeNull();
    expect(refused.rejected).toBe("above-latest");
    expect(refused.latest).toBe("1.7.24");
    expect(refused.latestSource).toBe("release-feed");
  });

  it("falls back to the env var when nothing has been derived yet", () => {
    const out = resolveDesktopFloor(env("1.9.0", "1.8.2"), null);
    expect(out.latest).toBe("1.8.2");
    expect(out.latestSource).toBe("env");
    expect(out.rejected).toBe("above-latest");
  });

  it("a MALFORMED derived value falls through to the env rather than voiding it", () => {
    // ⚠ Resolver is the last stop — garbage must not blank a working clamp.
    for (const bad of ["v1.8.2", "1.8", "latest", ""]) {
      const out = resolveDesktopFloor(env("1.9.0", "1.8.2"), bad);
      expect(out.latest).toBe("1.8.2");
      expect(out.latestSource).toBe("env");
    }
  });

  it("no latest from EITHER source disables the clamp, which is today's behavior", () => {
    // A decision, not a gap: with no idea what is published the clamp cannot
    // judge and the client's GUARD 2 backstops. ⚠ Expressing "no latest" takes
    // an explicit blank — the clamp-less state is opt-in, not a cold default.
    const out = resolveDesktopFloor(env("1.9.0", ""), null);
    expect(out.minSupported).toBe("1.9.0");
    expect(out.latest).toBeNull();
    expect(out.latestSource).toBeNull();
  });

  it("defaults derivedLatest to null, so an old caller keeps its old behavior", () => {
    expect(resolveDesktopFloor(env("1.9.0", "1.8.2")).latest).toBe("1.8.2");
    expect(resolveDesktopFloor.length).toBe(0); // both parameters are optional
  });

  it("reads process.env when nothing is injected", () => {
    // Pinning the production call shape: the route passes no argument, so the
    // default parameter is what makes the value request-time rather than
    // frozen at module load.
    const before = process.env[MIN_VERSION_ENV];
    try {
      // Below the default declared latest, so the clamp waves it through and
      // the assertion isolates the process.env read.
      process.env[MIN_VERSION_ENV] = "1.2.1";
      expect(resolveDesktopFloor().minSupported).toBe("1.2.1");
    } finally {
      if (before === undefined) delete process.env[MIN_VERSION_ENV];
      else process.env[MIN_VERSION_ENV] = before;
    }
  });
});
