import { describe, expect, it } from "vitest";

import {
  DoplApiError,
  DoplAuthError,
  DoplNetworkError,
  DoplTimeoutError,
  parseApiErrorBody,
} from "./errors.js";

describe("parseApiErrorBody", () => {
  it("extracts code + message + details from canonical shape", () => {
    const parsed = parseApiErrorBody(
      JSON.stringify({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
          details: { retryAfter: 5 },
        },
      })
    );
    expect(parsed).toEqual({
      code: "RATE_LIMITED",
      apiMessage: "Too many requests",
      details: { retryAfter: 5 },
    });
  });

  it("returns nulls for empty body", () => {
    expect(parseApiErrorBody("")).toEqual({
      code: null,
      apiMessage: null,
      details: undefined,
    });
  });

  it("returns nulls for malformed JSON", () => {
    expect(parseApiErrorBody("not json {{")).toEqual({
      code: null,
      apiMessage: null,
      details: undefined,
    });
  });

  it("returns nulls for HTML body", () => {
    const html = "<!DOCTYPE html><html><body>500</body></html>";
    expect(parseApiErrorBody(html)).toEqual({
      code: null,
      apiMessage: null,
      details: undefined,
    });
  });

  it("returns nulls when error field is missing", () => {
    expect(parseApiErrorBody(JSON.stringify({ foo: "bar" }))).toEqual({
      code: null,
      apiMessage: null,
      details: undefined,
    });
  });

  it("handles partial shape (message only)", () => {
    const parsed = parseApiErrorBody(
      JSON.stringify({ error: { message: "nope" } })
    );
    expect(parsed.code).toBeNull();
    expect(parsed.apiMessage).toBe("nope");
  });

  it("ignores non-string code/message fields", () => {
    const parsed = parseApiErrorBody(
      JSON.stringify({ error: { code: 42, message: null } })
    );
    expect(parsed.code).toBeNull();
    expect(parsed.apiMessage).toBeNull();
  });
});

describe("DoplApiError", () => {
  it("builds readable message from structured body", () => {
    const err = new DoplApiError(
      429,
      JSON.stringify({
        error: { code: "RATE_LIMITED", message: "Slow down" },
      })
    );
    expect(err.status).toBe(429);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.apiMessage).toBe("Slow down");
    expect(err.message).toBe("RATE_LIMITED: Slow down");
  });

  it("falls back to HTTP status + truncated body for unstructured", () => {
    const html = "<!DOCTYPE html>".padEnd(500, "x");
    const err = new DoplApiError(500, html);
    expect(err.code).toBeNull();
    expect(err.apiMessage).toBeNull();
    expect(err.message.startsWith("HTTP 500:")).toBe(true);
    expect(err.message.length).toBeLessThan(240);
  });

  it("preserves raw body on responseBody", () => {
    const err = new DoplApiError(400, "raw text");
    expect(err.responseBody).toBe("raw text");
  });

  it("uses apiMessage alone when code absent", () => {
    const err = new DoplApiError(
      500,
      JSON.stringify({ error: { message: "bare message" } })
    );
    expect(err.message).toBe("bare message");
  });
});

describe("DoplAuthError", () => {
  it("inherits DoplApiError behavior with auth name", () => {
    const err = new DoplAuthError(
      401,
      JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Bad key" } })
    );
    expect(err).toBeInstanceOf(DoplApiError);
    expect(err.name).toBe("DoplAuthError");
    expect(err.code).toBe("UNAUTHENTICATED");
  });
});

describe("DoplNetworkError / DoplTimeoutError", () => {
  it("DoplNetworkError carries cause", () => {
    const cause = new Error("socket hang up");
    const err = new DoplNetworkError("network down", cause);
    expect(err.cause).toBe(cause);
  });

  it("DoplTimeoutError extends DoplNetworkError with a helpful message", () => {
    const err = new DoplTimeoutError("GET", "/api/foo", 30_000);
    expect(err).toBeInstanceOf(DoplNetworkError);
    expect(err.message).toContain("30000ms");
    expect(err.message).toContain("/api/foo");
  });
});
