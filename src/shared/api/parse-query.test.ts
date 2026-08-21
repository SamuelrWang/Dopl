/**
 * `parseQuery` — the `?a=b` twin of `parseJson`, and the one rule that made it
 * worth extracting.
 *
 * ⚠ FOUR ROUTES HAND-WROTE THIS BLOCK AND TWO OF THEM DISAGREED (2026-08-20).
 * `/api/channels/sessions` read `params.get("channelId") || undefined`;
 * `/api/channels/consent` read `?? undefined`. Against the same `?channelId=`
 * those answer differently, and the difference is not cosmetic:
 *
 *   - `||` turns an empty string into `undefined`, so the FILTER DISAPPEARS and
 *     the route answers with every session in the workspace.
 *   - `??` lets `""` reach the schema, which rejects it — a 400.
 *
 * "No filter" is the direction that returns rows the caller never asked for, so
 * the rule is `??`: an empty string is a value the caller SENT, and only the
 * schema decides whether it is acceptable. These cases exist so a future
 * "let's be forgiving" edit has to delete an assertion that says why not.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";
import { parseQuery } from "./parse-json";

const Schema = z.object({
  channelId: z.string().uuid().optional(),
  status: z.enum(["pending", "allowed"]).optional(),
});

const CHANNEL = "11111111-2222-4333-8444-555555555555";

function query(qs: string) {
  return new URLSearchParams(qs);
}

describe("an ABSENT param is undefined — that is what .optional() is for", () => {
  it("omits keys the caller did not send", () => {
    expect(parseQuery(query(""), Schema, ["channelId", "status"])).toEqual({});
  });

  it("reads the values the caller did send", () => {
    expect(
      parseQuery(query(`channelId=${CHANNEL}&status=pending`), Schema, [
        "channelId",
        "status",
      ])
    ).toEqual({ channelId: CHANNEL, status: "pending" });
  });

  // Only the named keys are read — an unlisted param cannot smuggle a field into
  // the parsed object, whatever the schema would have done with it.
  it("ignores params the caller sent that the route did not ask for", () => {
    const out = parseQuery(query(`channelId=${CHANNEL}&role=owner`), Schema, [
      "channelId",
    ]);
    expect(out).toEqual({ channelId: CHANNEL });
  });
});

describe("an EMPTY STRING is a value, and it goes to the schema", () => {
  // ⚠ THE CASE THE HELPER EXISTS FOR. Under the old `|| undefined` this returned
  // `{}` — "no filter" — and the sessions route answered workspace-wide.
  it("rejects ?channelId= rather than silently dropping the filter", () => {
    expect(() => parseQuery(query("channelId="), Schema, ["channelId"])).toThrow(
      HttpError
    );
  });

  it("throws a 400 VALIDATION_FAILED carrying the zod issues", () => {
    try {
      parseQuery(query("channelId="), Schema, ["channelId"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const http = err as HttpError;
      expect(http.status).toBe(400);
      expect(http.code).toBe("VALIDATION_FAILED");
      expect(Array.isArray(http.details)).toBe(true);
    }
  });

  it("rejects an empty enum param the same way", () => {
    expect(() => parseQuery(query("status="), Schema, ["status"])).toThrow(HttpError);
  });

  // The distinction the whole rule rests on: these two requests are NOT the same
  // request, and the helper must not collapse them.
  it("answers ?channelId= and an absent channelId DIFFERENTLY", () => {
    expect(parseQuery(query(""), Schema, ["channelId"])).toEqual({});
    expect(() => parseQuery(query("channelId="), Schema, ["channelId"])).toThrow();
  });
});

describe("a malformed value is a 400, not a dropped filter", () => {
  it("rejects a non-uuid channelId", () => {
    expect(() => parseQuery(query("channelId=nope"), Schema, ["channelId"])).toThrow(
      HttpError
    );
  });

  it("rejects a value outside the enum", () => {
    expect(() => parseQuery(query("status=maybe"), Schema, ["status"])).toThrow(
      HttpError
    );
  });
});
