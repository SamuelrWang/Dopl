/**
 * `requireVersionId` guards the `[versionId]` skill-version param. ⚠ The uuid
 * shape check is the same ruling `channel-route.ts › requireConsentId` carries:
 * the id lands in a `uuid =` filter, so an unvalidated non-UUID reaches Postgres
 * as a 22P02 cast failure (generic 500 + a `system_events` row per call).
 *
 * This suite is also the READ-SITE PIN for `@/shared/lib/id/uuid › isUuid`,
 * which this module now shares instead of carrying its own copy of the regex:
 * dropping or widening that export must go red here, not degrade silently.
 */

import { describe, it, expect } from "vitest";
import { HttpError } from "@/shared/lib/http-error";
import { requireVersionId } from "./skill-route";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function thrownBy(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    return err as HttpError;
  }
  throw new Error("expected a throw");
}

describe("requireVersionId", () => {
  it("returns a well-formed uuid, in either case", () => {
    expect(requireVersionId({ versionId: UUID })).toBe(UUID);
    expect(requireVersionId({ versionId: UUID.toUpperCase() })).toBe(
      UUID.toUpperCase()
    );
  });

  it("400s anything that is not 8-4-4-4-12 hex", () => {
    const bad = [
      "nope",
      "123",
      `${UUID}x`, // trailing character
      UUID.slice(0, -1), // one short
      UUID.replace(/-/g, ""), // no dashes
      `${UUID} `, // trailing space
      ` ${UUID}`,
      "550e8400-e29b-41d4-a716-44665544000g", // non-hex digit
      "' OR 1=1--",
    ];
    for (const value of bad) {
      const err = thrownBy(() => requireVersionId({ versionId: value }));
      expect(err, value).toBeInstanceOf(HttpError);
      expect(err.status, value).toBe(400);
    }
  });

  it("400s a missing param", () => {
    expect(thrownBy(() => requireVersionId(undefined)).status).toBe(400);
    expect(thrownBy(() => requireVersionId({})).status).toBe(400);
    expect(thrownBy(() => requireVersionId({ versionId: "" })).status).toBe(400);
  });
});
