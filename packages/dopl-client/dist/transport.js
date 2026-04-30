"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplTransport = void 0;
const debug_1 = __importDefault(require("debug"));
const errors_js_1 = require("./errors.js");
const retry_js_1 = require("./retry.js");
const log = (0, debug_1.default)("dopl:client");
const DEFAULT_TIMEOUT_MS = 30_000;
class DoplTransport {
    baseUrl;
    apiKey;
    toolHeaderName;
    clientIdentifier;
    canvasId;
    constructor(baseUrl, apiKey, opts = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.apiKey = apiKey;
        this.toolHeaderName = opts.toolHeaderName ?? "X-MCP-Tool";
        this.clientIdentifier = opts.clientIdentifier ?? null;
        this.canvasId = opts.canvasId ?? null;
    }
    /**
     * Update the active canvas after construction (e.g. CLI flow where
     * the user runs `dopl canvas use <slug>` mid-session).
     */
    setCanvasId(canvasId) {
        this.canvasId = canvasId;
    }
    getCanvasId() {
        return this.canvasId;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    async request(path, options = {}) {
        const { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS, toolName, retries, } = options;
        const maxAttempts = 1 +
            (retries ?? (retry_js_1.IDEMPOTENT_METHODS.has(method) ? retry_js_1.DEFAULT_GET_RETRIES : 0));
        let lastError = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const started = Date.now();
            try {
                const res = await this.doFetch(path, method, body, timeoutMs, toolName);
                const duration = Date.now() - started;
                if (res.ok) {
                    log("%s %s → %d in %dms", method, path, res.status, duration);
                    return (await res.json());
                }
                const text = await res.text();
                log("%s %s → %d in %dms (attempt %d/%d)", method, path, res.status, duration, attempt + 1, maxAttempts);
                if (res.status === 401 || res.status === 403) {
                    throw new errors_js_1.DoplAuthError(res.status, text);
                }
                if (retry_js_1.RETRIABLE_STATUS.has(res.status) && attempt < maxAttempts - 1) {
                    const waitMs = (0, retry_js_1.waitForStatus)(res, attempt);
                    log("retrying after %dms", waitMs);
                    await (0, retry_js_1.sleep)(waitMs);
                    lastError = new errors_js_1.DoplApiError(res.status, text);
                    continue;
                }
                throw new errors_js_1.DoplApiError(res.status, text);
            }
            catch (error) {
                if (error instanceof errors_js_1.DoplApiError)
                    throw error;
                const networkError = wrapNetworkError(method, path, timeoutMs, error);
                log("%s %s network error: %s (attempt %d/%d)", method, path, networkError.message, attempt + 1, maxAttempts);
                if (attempt < maxAttempts - 1) {
                    const waitMs = (0, retry_js_1.computeBackoff)(attempt);
                    log("retrying after %dms", waitMs);
                    await (0, retry_js_1.sleep)(waitMs);
                    lastError = networkError;
                    continue;
                }
                throw networkError;
            }
        }
        throw lastError ?? new errors_js_1.DoplNetworkError(`Exhausted retries: ${method} ${path}`);
    }
    async requestNoContent(path, method, toolName, body) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: this.buildHeaders(toolName, body !== undefined),
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            if (!res.ok && res.status !== 204) {
                const text = await res.text();
                if (res.status === 401 || res.status === 403) {
                    throw new errors_js_1.DoplAuthError(res.status, text);
                }
                throw new errors_js_1.DoplApiError(res.status, text);
            }
        }
        finally {
            clearTimeout(timeout);
        }
    }
    buildHeaders(toolName, withJsonBody = true) {
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
        };
        if (withJsonBody)
            headers["Content-Type"] = "application/json";
        if (toolName)
            headers[this.toolHeaderName] = toolName;
        if (this.clientIdentifier)
            headers["X-Dopl-Client"] = this.clientIdentifier;
        if (this.canvasId)
            headers["X-Canvas-Id"] = this.canvasId;
        return headers;
    }
    async doFetch(path, method, body, timeoutMs, toolName) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: this.buildHeaders(toolName),
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.DoplTransport = DoplTransport;
function wrapNetworkError(method, path, timeoutMs, error) {
    if (error instanceof DOMException && error.name === "AbortError") {
        return new errors_js_1.DoplTimeoutError(method, path, timeoutMs);
    }
    return new errors_js_1.DoplNetworkError(error instanceof Error ? error.message : String(error), error);
}
