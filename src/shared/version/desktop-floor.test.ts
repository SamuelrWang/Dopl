/**
 * The desktop minimum-version FLOOR, as a truth table.
 *
 * THE PROPERTY THIS FILE EXISTS FOR: a floor is the one config value in this
 * repo whose misconfiguration takes the product away from every user at once.
 * The desktop blocks itself when it is below the floor, so anything this
 * resolver hands out is, a few seconds later, a screen someone cannot get past.
 * Every branch below therefore asks the same question — "does a mistake here
 * fail toward NOBODY being blocked?" — and the answer has to be yes:
 *
 *   1. blank/OFF-spelled / malformed floor → `minSupported: null` (no floor)
 *   2. floor above the declared `latest`   → refused, `minSupported: null`
 *   3. only a well-formed, reachable floor is ever served
 *
 * STAGE C (2026-08-05): an UNSET env no longer means "no floor" — it means the
 * CODE DEFAULT (`DEFAULT_MIN_VERSION`), shipped beside a matching declared
 * latest so the clamp can never refuse its own release's floor. Fail-open now
 * requires an explicit OFF spelling; every MISTAKE shape (typo, malformed)
 * still fails to "no floor".
 *
 * The one intentional asymmetry is (2)'s dependence on `latest` being kept
 * current: a stale-LOW latest refuses a legitimate floor (annoying, safe), and
 * a missing latest disables the clamp entirely (the client's updater-grounded
 * guard is the backstop there). That is why `latest` is now DERIVED from the
 * release feed and the env var is only the fallback — see `latest-release.ts`,
 * and the `derivedLatest` cases at the bottom of this file.
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
    // The two regexes are deliberately separate — one narrows an operator's
    // config, the other narrows an attacker-settable header — but they describe
    // the same version vocabulary today. A change to either that is not a
    // decision about both fails here.
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
    // Otherwise a 1.9.0-rc.1 tester would be told to upgrade to 1.9.0, which is
    // the build they are already running.
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
    // The floor rides code now; the env var is the override. Unset = the
    // release's own floor, clamped against the matching declared latest.
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
    // Bumping DEFAULT_MIN_VERSION without DEFAULT_DECLARED_LATEST would arm
    // the anti-brick clamp against our own floor. Fail the build instead.
    expect(narrowVersion(DEFAULT_MIN_VERSION)).toBe(DEFAULT_MIN_VERSION);
    expect(narrowVersion(DEFAULT_DECLARED_LATEST)).toBe(DEFAULT_DECLARED_LATEST);
    expect(compareReleases(DEFAULT_MIN_VERSION, DEFAULT_DECLARED_LATEST)).not.toBe(1);
  });

  it("a MALFORMED floor blocks nobody, and says so", () => {
    // The whole point: `DOPL_DESKTOP_MIN_VERSION=v1.8.2` must not become a
    // floor of "v1.8.2" that no build can ever satisfy.
    for (const bad of ["v1.8.2", "1.8", "latest", "1.8.2 ", "not a version"]) {
      const out = resolveDesktopFloor(env(bad));
      expect(out.minSupported).toBeNull();
      expect(out.rejected).toBe("malformed");
    }
  });

  it("an OFF spelling is a decision — floorless, and not 'malformed'", () => {
    // With a code default, running floorless takes an explicit act: emptying
    // the var or naming it off. All spellings an operator would reach for.
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
    // The fleet-outage shape: floor 1.9.0 while 1.8.2 is the newest build that
    // exists. Every client would block with nothing to upgrade to.
    const out = resolveDesktopFloor(env("1.9.0", "1.8.2"));
    expect(out.minSupported).toBeNull();
    expect(out.rejected).toBe("above-latest");
    expect(out.latest).toBe("1.8.2");
    expect(out.latestSource).toBe("env");
  });

  it("a floor EQUAL to latest is legitimate and is served", () => {
    // "Everyone must be on the newest build" is the most common real intent.
    expect(resolveDesktopFloor(env("1.8.2", "1.8.2")).minSupported).toBe("1.8.2");
    expect(resolveDesktopFloor(env("1.8.1", "1.8.2")).minSupported).toBe("1.8.1");
  });

  it("a malformed LATEST disables the clamp instead of voiding the floor", () => {
    // latest is advisory; an unreadable one must not take a good floor down
    // with it. The client-side updater guard still backstops the brick case.
    const out = resolveDesktopFloor(env("1.8.2", "v1.9.0"));
    expect(out.minSupported).toBe("1.8.2");
    expect(out.latest).toBeNull();
  });

  it("prefers the DERIVED latest over the declared one, in both directions", () => {
    // The whole point of F-125's fix. The env var is a claim about what should
    // be published; the release feed is the record of what is. When they
    // disagree the fact wins, whichever way the disagreement runs.

    // Stale-LOW env (the silent-decay case): the derivation UNSTICKS a
    // legitimate floor the hand-bumped var was refusing.
    const unstuck = resolveDesktopFloor(env("1.9.0", "1.8.2"), "1.9.0");
    expect(unstuck.minSupported).toBe("1.9.0");
    expect(unstuck.latest).toBe("1.9.0");
    expect(unstuck.latestSource).toBe("release-feed");

    // Stale-HIGH env (the brick case, and the reason release-time automation
    // that copies package.json's version was rejected): the derivation REFUSES
    // a floor the declared value would have waved through.
    const refused = resolveDesktopFloor(env("1.8.2", "1.8.2"), "1.7.24");
    expect(refused.minSupported).toBeNull();
    expect(refused.rejected).toBe("above-latest");
    expect(refused.latest).toBe("1.7.24");
    expect(refused.latestSource).toBe("release-feed");
  });

  it("falls back to the env var when nothing has been derived yet", () => {
    // A cold lambda that has not reached GitHub, or a feed that has gone away.
    const out = resolveDesktopFloor(env("1.9.0", "1.8.2"), null);
    expect(out.latest).toBe("1.8.2");
    expect(out.latestSource).toBe("env");
    expect(out.rejected).toBe("above-latest");
  });

  it("a MALFORMED derived value falls through to the env rather than voiding it", () => {
    // The parser should never hand one over, but the resolver is the last stop
    // and a garbage value must not be able to blank a working clamp.
    for (const bad of ["v1.8.2", "1.8", "latest", ""]) {
      const out = resolveDesktopFloor(env("1.9.0", "1.8.2"), bad);
      expect(out.latest).toBe("1.8.2");
      expect(out.latestSource).toBe("env");
    }
  });

  it("no latest from EITHER source disables the clamp, which is today's behavior", () => {
    // Stated so it is a decision, not a gap: with no idea what is published,
    // the clamp cannot judge, and the client's GUARD 2 is the backstop. The
    // route never lets this state persist — it schedules a refresh on the way
    // out and the next request has an answer.
    // Expressing "no latest" now takes an explicit blank (the code default
    // otherwise answers), which is itself the point: the clamp-less state has
    // become opt-in rather than the cold-start default.
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
