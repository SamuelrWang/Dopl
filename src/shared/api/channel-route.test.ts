/**
 * Route-param extractors for the channels API.
 *
 * The consent-id guard is the load-bearing one: `id` lands in a `uuid =`
 * filter, so an unvalidated non-UUID reaches Postgres as a 22P02 cast failure
 * — a generic 500 plus a `system_events` error row per call. It must fail as
 * the same 404 a missing / foreign id gets, so ids still can't be probed.
 */

import { describe, it, expect } from "vitest";
import { HttpError } from "@/shared/lib/http-error";
import { requireChannelId, requireConsentId } from "./channel-route";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function thrownBy(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    return err as HttpError;
  }
  throw new Error("expected a throw");
}

describe("requireConsentId", () => {
  it("returns a well-formed uuid (any case)", () => {
    expect(requireConsentId({ id: UUID })).toBe(UUID);
    expect(requireConsentId({ id: UUID.toUpperCase() })).toBe(UUID.toUpperCase());
  });

  it("404s a non-uuid instead of letting it hit the uuid column (L-2)", () => {
    for (const bad of ["nope", "123", `${UUID}x`, "' OR 1=1--"]) {
      const err = thrownBy(() => requireConsentId({ id: bad }));
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(404);
      expect(err.code).toBe("CONSENT_NOT_FOUND");
    }
  });

  it("400s a missing param", () => {
    expect(thrownBy(() => requireConsentId(undefined)).status).toBe(400);
    expect(thrownBy(() => requireConsentId({})).status).toBe(400);
  });
});

describe("requireChannelId", () => {
  it("accepts a slug as well as an id (channel refs are id-or-slug)", () => {
    expect(requireChannelId({ channelId: "general" })).toBe("general");
    expect(requireChannelId({ channelId: UUID })).toBe(UUID);
  });

  it("400s a missing param", () => {
    expect(thrownBy(() => requireChannelId(undefined)).status).toBe(400);
  });
});
