"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplAbortError = exports.DoplTimeoutError = exports.DoplNetworkError = exports.DoplAuthError = exports.DoplApiError = void 0;
exports.parseApiErrorBody = parseApiErrorBody;
const EMPTY = {
    code: null,
    apiMessage: null,
    details: undefined,
    upgradeUrl: null,
};
function parseApiErrorBody(body) {
    if (!body)
        return EMPTY;
    try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== "object")
            return EMPTY;
        const record = parsed;
        const error = record.error;
        // Canonical envelope: { error: { code, message, details } }.
        if (error && typeof error === "object") {
            const inner = error;
            return {
                code: typeof inner.code === "string" ? inner.code : null,
                apiMessage: typeof inner.message === "string" ? inner.message : null,
                details: "details" in inner ? inner.details : undefined,
                upgradeUrl: null,
            };
        }
        // Flat entitlement-denial envelope, e.g. the ontology free-plan object
        // cap: { error: "over_free_cap", message, upgrade_url }. Distinct shape by
        // design — surface message + upgrade link, not a raw "HTTP 403" dump.
        if (typeof error === "string") {
            return {
                code: error,
                apiMessage: typeof record.message === "string" ? record.message : null,
                details: undefined,
                upgradeUrl: typeof record.upgrade_url === "string" ? record.upgrade_url : null,
            };
        }
        return EMPTY;
    }
    catch {
        return EMPTY;
    }
}
function truncate(text, max) {
    return text.length <= max ? text : text.slice(0, max) + "…";
}
class DoplApiError extends Error {
    status;
    code;
    apiMessage;
    details;
    /** Upgrade link from an entitlement-denial body (else null). */
    upgradeUrl;
    responseBody;
    constructor(status, responseBody) {
        const parsed = parseApiErrorBody(responseBody);
        const message = parsed.apiMessage && parsed.upgradeUrl
            ? `${parsed.apiMessage} Upgrade: ${parsed.upgradeUrl}`
            : parsed.code && parsed.apiMessage
                ? `${parsed.code}: ${parsed.apiMessage}`
                : parsed.apiMessage
                    ? parsed.apiMessage
                    : `HTTP ${status}: ${truncate(responseBody, 200)}`;
        super(message);
        this.name = "DoplApiError";
        this.status = status;
        this.code = parsed.code;
        this.apiMessage = parsed.apiMessage;
        this.details = parsed.details;
        this.upgradeUrl = parsed.upgradeUrl;
        this.responseBody = responseBody;
    }
}
exports.DoplApiError = DoplApiError;
class DoplAuthError extends DoplApiError {
    constructor(status, responseBody) {
        super(status, responseBody);
        this.name = "DoplAuthError";
    }
}
exports.DoplAuthError = DoplAuthError;
class DoplNetworkError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.name = "DoplNetworkError";
        this.cause = cause;
    }
}
exports.DoplNetworkError = DoplNetworkError;
class DoplTimeoutError extends DoplNetworkError {
    constructor(method, path, timeoutMs) {
        super(`Dopl API request timed out after ${timeoutMs}ms: ${method} ${path}`);
        this.name = "DoplTimeoutError";
    }
}
exports.DoplTimeoutError = DoplTimeoutError;
/**
 * The CALLER went away (Q14) — an external `AbortSignal` on the transport
 * fired; cancelled from our side, not timed out on the server's.
 *
 * ⚠ Distinct from {@link DoplTimeoutError} on purpose: both arrive from `fetch`
 * as an `AbortError`, and logging a client disconnect as "timed out after
 * 55000ms" sends the next reader hunting a slow route that was never slow.
 * Still a `DoplNetworkError`, so existing `catch`es keep working.
 */
class DoplAbortError extends DoplNetworkError {
    constructor(method, path) {
        super(`Dopl API request aborted by the caller: ${method} ${path}`);
        this.name = "DoplAbortError";
    }
}
exports.DoplAbortError = DoplAbortError;
