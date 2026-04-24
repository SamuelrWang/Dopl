"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplTimeoutError = exports.DoplNetworkError = exports.DoplAuthError = exports.DoplApiError = void 0;
class DoplApiError extends Error {
    status;
    responseBody;
    constructor(status, responseBody, message) {
        super(message ?? `Dopl API error ${status}: ${responseBody}`);
        this.name = "DoplApiError";
        this.status = status;
        this.responseBody = responseBody;
    }
}
exports.DoplApiError = DoplApiError;
class DoplAuthError extends DoplApiError {
    constructor(status, responseBody) {
        super(status, responseBody, `Dopl auth failed (${status}): ${responseBody}`);
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
