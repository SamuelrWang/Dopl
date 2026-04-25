"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplTimeoutError = exports.DoplNetworkError = exports.DoplAuthError = exports.DoplApiError = void 0;
exports.parseApiErrorBody = parseApiErrorBody;
function parseApiErrorBody(body) {
    if (!body)
        return { code: null, apiMessage: null, details: undefined };
    try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== "object") {
            return { code: null, apiMessage: null, details: undefined };
        }
        const error = parsed.error;
        if (!error || typeof error !== "object") {
            return { code: null, apiMessage: null, details: undefined };
        }
        const record = error;
        return {
            code: typeof record.code === "string" ? record.code : null,
            apiMessage: typeof record.message === "string" ? record.message : null,
            details: "details" in record ? record.details : undefined,
        };
    }
    catch {
        return { code: null, apiMessage: null, details: undefined };
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
    responseBody;
    constructor(status, responseBody) {
        const parsed = parseApiErrorBody(responseBody);
        const message = parsed.code && parsed.apiMessage
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
