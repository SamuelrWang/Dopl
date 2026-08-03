import { describe, expect, it } from "vitest";
import { ApiError, decodeResponse, withQuery } from "./api";

/**
 * The error envelope is load-bearing: ported pages branch on `ApiError.code`,
 * and both transports feed this one decoder. These cases mirror
 * `src/shared/api/api-client.ts`'s behavior exactly.
 */
describe("decodeResponse", () => {
  it("returns undefined for a bodiless success (204)", () => {
    expect(
      decodeResponse({ status: 204, statusText: "No Content", hasBody: false })
    ).toBeUndefined();
  });

  it("throws the nested envelope's code, message and details", () => {
    const call = () =>
      decodeResponse({
        status: 409,
        statusText: "Conflict",
        hasBody: true,
        body: { error: { code: "TEAM_CONFLICT", message: "Already a member", details: { id: 7 } } },
      });

    expect(call).toThrow(ApiError);
    try {
      call();
    } catch (err) {
      const apiError = err as ApiError;
      expect(apiError.status).toBe(409);
      expect(apiError.code).toBe("TEAM_CONFLICT");
      expect(apiError.message).toBe("Already a member");
      expect(apiError.details).toEqual({ id: 7 });
    }
  });

  it("reads the flat plan-gate envelope's code from `error` and text from `message`", () => {
    try {
      decodeResponse({
        status: 402,
        statusText: "Payment Required",
        hasBody: true,
        body: { error: "PLAN_LIMIT", message: "Upgrade to add members" },
      });
      expect.unreachable();
    } catch (err) {
      const apiError = err as ApiError;
      expect(apiError.code).toBe("PLAN_LIMIT");
      expect(apiError.message).toBe("Upgrade to add members");
    }
  });

  it("never surfaces an empty message when statusText is blank (HTTP/2)", () => {
    try {
      decodeResponse({ status: 500, statusText: "", hasBody: false });
      expect.unreachable();
    } catch (err) {
      const apiError = err as ApiError;
      expect(apiError.code).toBe("INTERNAL_ERROR");
      expect(apiError.message).toBe("Request failed (500)");
    }
  });
});

describe("withQuery", () => {
  it("omits undefined values and respects an existing query string", () => {
    expect(withQuery("/api/skills", { limit: 20, cursor: undefined })).toBe(
      "/api/skills?limit=20"
    );
    expect(withQuery("/api/skills?scope=team", { limit: 20 })).toBe(
      "/api/skills?scope=team&limit=20"
    );
    expect(withQuery("/api/skills", { all: undefined })).toBe("/api/skills");
  });
});
