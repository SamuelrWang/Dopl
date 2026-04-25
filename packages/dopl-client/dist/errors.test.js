"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const errors_js_1 = require("./errors.js");
(0, vitest_1.describe)("parseApiErrorBody", () => {
    (0, vitest_1.it)("extracts code + message + details from canonical shape", () => {
        const parsed = (0, errors_js_1.parseApiErrorBody)(JSON.stringify({
            error: {
                code: "RATE_LIMITED",
                message: "Too many requests",
                details: { retryAfter: 5 },
            },
        }));
        (0, vitest_1.expect)(parsed).toEqual({
            code: "RATE_LIMITED",
            apiMessage: "Too many requests",
            details: { retryAfter: 5 },
        });
    });
    (0, vitest_1.it)("returns nulls for empty body", () => {
        (0, vitest_1.expect)((0, errors_js_1.parseApiErrorBody)("")).toEqual({
            code: null,
            apiMessage: null,
            details: undefined,
        });
    });
    (0, vitest_1.it)("returns nulls for malformed JSON", () => {
        (0, vitest_1.expect)((0, errors_js_1.parseApiErrorBody)("not json {{")).toEqual({
            code: null,
            apiMessage: null,
            details: undefined,
        });
    });
    (0, vitest_1.it)("returns nulls for HTML body", () => {
        const html = "<!DOCTYPE html><html><body>500</body></html>";
        (0, vitest_1.expect)((0, errors_js_1.parseApiErrorBody)(html)).toEqual({
            code: null,
            apiMessage: null,
            details: undefined,
        });
    });
    (0, vitest_1.it)("returns nulls when error field is missing", () => {
        (0, vitest_1.expect)((0, errors_js_1.parseApiErrorBody)(JSON.stringify({ foo: "bar" }))).toEqual({
            code: null,
            apiMessage: null,
            details: undefined,
        });
    });
    (0, vitest_1.it)("handles partial shape (message only)", () => {
        const parsed = (0, errors_js_1.parseApiErrorBody)(JSON.stringify({ error: { message: "nope" } }));
        (0, vitest_1.expect)(parsed.code).toBeNull();
        (0, vitest_1.expect)(parsed.apiMessage).toBe("nope");
    });
    (0, vitest_1.it)("ignores non-string code/message fields", () => {
        const parsed = (0, errors_js_1.parseApiErrorBody)(JSON.stringify({ error: { code: 42, message: null } }));
        (0, vitest_1.expect)(parsed.code).toBeNull();
        (0, vitest_1.expect)(parsed.apiMessage).toBeNull();
    });
});
(0, vitest_1.describe)("DoplApiError", () => {
    (0, vitest_1.it)("builds readable message from structured body", () => {
        const err = new errors_js_1.DoplApiError(429, JSON.stringify({
            error: { code: "RATE_LIMITED", message: "Slow down" },
        }));
        (0, vitest_1.expect)(err.status).toBe(429);
        (0, vitest_1.expect)(err.code).toBe("RATE_LIMITED");
        (0, vitest_1.expect)(err.apiMessage).toBe("Slow down");
        (0, vitest_1.expect)(err.message).toBe("RATE_LIMITED: Slow down");
    });
    (0, vitest_1.it)("falls back to HTTP status + truncated body for unstructured", () => {
        const html = "<!DOCTYPE html>".padEnd(500, "x");
        const err = new errors_js_1.DoplApiError(500, html);
        (0, vitest_1.expect)(err.code).toBeNull();
        (0, vitest_1.expect)(err.apiMessage).toBeNull();
        (0, vitest_1.expect)(err.message.startsWith("HTTP 500:")).toBe(true);
        (0, vitest_1.expect)(err.message.length).toBeLessThan(240);
    });
    (0, vitest_1.it)("preserves raw body on responseBody", () => {
        const err = new errors_js_1.DoplApiError(400, "raw text");
        (0, vitest_1.expect)(err.responseBody).toBe("raw text");
    });
    (0, vitest_1.it)("uses apiMessage alone when code absent", () => {
        const err = new errors_js_1.DoplApiError(500, JSON.stringify({ error: { message: "bare message" } }));
        (0, vitest_1.expect)(err.message).toBe("bare message");
    });
});
(0, vitest_1.describe)("DoplAuthError", () => {
    (0, vitest_1.it)("inherits DoplApiError behavior with auth name", () => {
        const err = new errors_js_1.DoplAuthError(401, JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Bad key" } }));
        (0, vitest_1.expect)(err).toBeInstanceOf(errors_js_1.DoplApiError);
        (0, vitest_1.expect)(err.name).toBe("DoplAuthError");
        (0, vitest_1.expect)(err.code).toBe("UNAUTHENTICATED");
    });
});
(0, vitest_1.describe)("DoplNetworkError / DoplTimeoutError", () => {
    (0, vitest_1.it)("DoplNetworkError carries cause", () => {
        const cause = new Error("socket hang up");
        const err = new errors_js_1.DoplNetworkError("network down", cause);
        (0, vitest_1.expect)(err.cause).toBe(cause);
    });
    (0, vitest_1.it)("DoplTimeoutError extends DoplNetworkError with a helpful message", () => {
        const err = new errors_js_1.DoplTimeoutError("GET", "/api/foo", 30_000);
        (0, vitest_1.expect)(err).toBeInstanceOf(errors_js_1.DoplNetworkError);
        (0, vitest_1.expect)(err.message).toContain("30000ms");
        (0, vitest_1.expect)(err.message).toContain("/api/foo");
    });
});
