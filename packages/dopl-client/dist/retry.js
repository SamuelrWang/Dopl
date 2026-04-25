"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GET_RETRIES = exports.IDEMPOTENT_METHODS = exports.RETRIABLE_STATUS = void 0;
exports.sleep = sleep;
exports.computeBackoff = computeBackoff;
exports.parseRetryAfter = parseRetryAfter;
exports.waitForStatus = waitForStatus;
const BACKOFF_BASE_MS = 200;
const BACKOFF_CAP_MS = 5_000;
const RETRY_AFTER_CAP_MS = 60_000;
exports.RETRIABLE_STATUS = new Set([429, 502, 503, 504]);
exports.IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);
exports.DEFAULT_GET_RETRIES = 3;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function computeBackoff(attempt) {
    const exp = BACKOFF_BASE_MS * 2 ** attempt;
    const jitter = 0.5 + Math.random();
    return Math.min(Math.round(exp * jitter), BACKOFF_CAP_MS);
}
function parseRetryAfter(value, now = Date.now()) {
    if (!value)
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
    }
    const date = Date.parse(trimmed);
    if (Number.isNaN(date))
        return null;
    return Math.min(Math.max(0, date - now), RETRY_AFTER_CAP_MS);
}
function waitForStatus(res, attempt) {
    if (res.status === 429) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        if (retryAfter !== null)
            return retryAfter;
    }
    return computeBackoff(attempt);
}
