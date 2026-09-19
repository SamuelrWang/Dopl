"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const client_js_1 = require("./client.js");
const errors_js_1 = require("./errors.js");
function installFetchMock(responders) {
    const calls = [];
    const original = global.fetch;
    let i = 0;
    global.fetch = (async (...args) => {
        const [input, init] = args;
        calls.push({ url: String(input), init: init ?? {} });
        const responder = responders[Math.min(i++, responders.length - 1)];
        return responder();
    });
    return {
        calls,
        restore: () => {
            global.fetch = original;
        },
    };
}
function jsonResponse(status, body, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}
function textResponse(status, body = "", headers = {}) {
    return new Response(body, { status, headers });
}
const BASE = "https://api.example.test";
(0, vitest_1.describe)("DoplClient headers", () => {
    let mock;
    (0, vitest_1.beforeEach)(() => {
        mock = installFetchMock([() => jsonResponse(200, { workspaces: [] })]);
    });
    (0, vitest_1.afterEach)(() => mock.restore());
    (0, vitest_1.it)("sends Authorization bearer", async () => {
        const client = new client_js_1.DoplClient(BASE, "sk-dopl-abc");
        await client.listWorkspaces();
        const headers = mock.calls[0].init.headers;
        (0, vitest_1.expect)(headers.Authorization).toBe("Bearer sk-dopl-abc");
    });
    (0, vitest_1.it)("omits X-Dopl-Client when identifier not provided", async () => {
        const client = new client_js_1.DoplClient(BASE, "k");
        await client.listWorkspaces();
        const headers = mock.calls[0].init.headers;
        (0, vitest_1.expect)(headers["X-Dopl-Client"]).toBeUndefined();
    });
    (0, vitest_1.it)("includes X-Dopl-Client when identifier provided", async () => {
        const client = new client_js_1.DoplClient(BASE, "k", {
            clientIdentifier: "@dopl/cli@1.2.3",
        });
        await client.listWorkspaces();
        const headers = mock.calls[0].init.headers;
        (0, vitest_1.expect)(headers["X-Dopl-Client"]).toBe("@dopl/cli@1.2.3");
    });
    (0, vitest_1.it)("sets the tool header name with the called tool", async () => {
        const client = new client_js_1.DoplClient(BASE, "k");
        await client.listWorkspaces();
        const headers = mock.calls[0].init.headers;
        (0, vitest_1.expect)(headers["X-MCP-Tool"]).toBe("dopl_workspaces");
    });
    (0, vitest_1.it)("uses a custom tool header name", async () => {
        const client = new client_js_1.DoplClient(BASE, "k", { toolHeaderName: "X-Dopl-Cli" });
        await client.listWorkspaces();
        const headers = mock.calls[0].init.headers;
        (0, vitest_1.expect)(headers["X-Dopl-Cli"]).toBe("dopl_workspaces");
        (0, vitest_1.expect)(headers["X-MCP-Tool"]).toBeUndefined();
    });
});
(0, vitest_1.describe)("DoplClient retries", () => {
    let mock;
    (0, vitest_1.afterEach)(() => {
        if (mock)
            mock.restore();
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.it)("retries 503 then succeeds on 200 (GET)", async () => {
        mock = installFetchMock([
            () => textResponse(503, ""),
            () => textResponse(503, ""),
            () => jsonResponse(200, { workspaces: [{ id: "a" }] }),
        ]);
        const client = new client_js_1.DoplClient(BASE, "k");
        const { workspaces } = await client.listWorkspaces();
        (0, vitest_1.expect)(workspaces).toEqual([{ id: "a" }]);
        (0, vitest_1.expect)(mock.calls).toHaveLength(3);
    });
    (0, vitest_1.it)("does NOT retry on POST (non-idempotent)", async () => {
        mock = installFetchMock([() => textResponse(503, "")]);
        const client = new client_js_1.DoplClient(BASE, "k");
        await (0, vitest_1.expect)(client.createOntologyCluster({ name: "x" })).rejects.toBeInstanceOf(errors_js_1.DoplApiError);
        (0, vitest_1.expect)(mock.calls).toHaveLength(1);
    });
    (0, vitest_1.it)("honors Retry-After seconds on 429", async () => {
        const spy = vitest_1.vi.spyOn(global, "setTimeout");
        mock = installFetchMock([
            () => textResponse(429, "", { "retry-after": "2" }),
            () => jsonResponse(200, { workspaces: [] }),
        ]);
        const client = new client_js_1.DoplClient(BASE, "k");
        await client.listWorkspaces();
        const delays = spy.mock.calls.map((call) => Number(call[1]));
        (0, vitest_1.expect)(delays.some((ms) => ms === 2000)).toBe(true);
        spy.mockRestore();
    });
    (0, vitest_1.it)("does NOT retry on 4xx other than 429", async () => {
        mock = installFetchMock([() => textResponse(404, "")]);
        const client = new client_js_1.DoplClient(BASE, "k");
        await (0, vitest_1.expect)(client.listWorkspaces()).rejects.toBeInstanceOf(errors_js_1.DoplApiError);
        (0, vitest_1.expect)(mock.calls).toHaveLength(1);
    });
    (0, vitest_1.it)("retries on network errors then eventually fails", async () => {
        mock = installFetchMock([
            () => {
                throw new TypeError("fetch failed");
            },
            () => {
                throw new TypeError("fetch failed");
            },
            () => {
                throw new TypeError("fetch failed");
            },
            () => {
                throw new TypeError("fetch failed");
            },
        ]);
        const client = new client_js_1.DoplClient(BASE, "k");
        await (0, vitest_1.expect)(client.listWorkspaces()).rejects.toBeInstanceOf(errors_js_1.DoplNetworkError);
        (0, vitest_1.expect)(mock.calls).toHaveLength(4);
    });
    (0, vitest_1.it)("wraps AbortError into DoplTimeoutError", async () => {
        mock = installFetchMock([
            () => {
                const err = new DOMException("aborted", "AbortError");
                throw err;
            },
        ]);
        const client = new client_js_1.DoplClient(BASE, "k");
        const err = await client
            .createOntologyCluster({ name: "x" })
            .catch((e) => e);
        (0, vitest_1.expect)(err).toBeInstanceOf(errors_js_1.DoplTimeoutError);
    });
});
(0, vitest_1.describe)("DoplClient error mapping", () => {
    let mock;
    (0, vitest_1.afterEach)(() => mock?.restore());
    (0, vitest_1.it)("401 → DoplAuthError without retry", async () => {
        mock = installFetchMock([() => textResponse(401, "")]);
        const client = new client_js_1.DoplClient(BASE, "k");
        await (0, vitest_1.expect)(client.listWorkspaces()).rejects.toBeInstanceOf(errors_js_1.DoplAuthError);
        (0, vitest_1.expect)(mock.calls).toHaveLength(1);
    });
    (0, vitest_1.it)("parses structured error body into code/apiMessage", async () => {
        mock = installFetchMock([
            () => jsonResponse(400, { error: { code: "BAD_REQUEST", message: "Missing field" } }),
        ]);
        const client = new client_js_1.DoplClient(BASE, "k");
        const err = (await client.listWorkspaces().catch((e) => e));
        (0, vitest_1.expect)(err.code).toBe("BAD_REQUEST");
        (0, vitest_1.expect)(err.apiMessage).toBe("Missing field");
    });
});
(0, vitest_1.describe)("parseRetryAfter", () => {
    (0, vitest_1.it)("returns null for null/empty", () => {
        (0, vitest_1.expect)((0, client_js_1.parseRetryAfter)(null)).toBeNull();
        (0, vitest_1.expect)((0, client_js_1.parseRetryAfter)("")).toBeNull();
        (0, vitest_1.expect)((0, client_js_1.parseRetryAfter)("   ")).toBeNull();
    });
    (0, vitest_1.it)("parses integer seconds", () => {
        (0, vitest_1.expect)((0, client_js_1.parseRetryAfter)("5")).toBe(5000);
    });
    (0, vitest_1.it)("parses HTTP-date relative to now", () => {
        const now = Date.now();
        const future = new Date(now + 10_000).toUTCString();
        const ms = (0, client_js_1.parseRetryAfter)(future, now);
        (0, vitest_1.expect)(ms).toBeGreaterThanOrEqual(8_000);
        (0, vitest_1.expect)(ms).toBeLessThanOrEqual(11_000);
    });
    (0, vitest_1.it)("caps at 60 seconds", () => {
        (0, vitest_1.expect)((0, client_js_1.parseRetryAfter)("120")).toBe(60_000);
    });
    (0, vitest_1.it)("returns null for junk", () => {
        (0, vitest_1.expect)((0, client_js_1.parseRetryAfter)("not-a-date")).toBeNull();
    });
    (0, vitest_1.it)("clamps past dates to 0", () => {
        const now = Date.now();
        const past = new Date(now - 60_000).toUTCString();
        (0, vitest_1.expect)((0, client_js_1.parseRetryAfter)(past, now)).toBe(0);
    });
});
/**
 * `updateAgentTemplate`'s TRI-STATE (F-739, 2026-09-18).
 *
 * ⚠ **THE STRICT ARM IS CLIENT-SIDE ON PURPOSE**, exactly as
 * `knowledge.ts › writeKbFileByPath`'s is: the route still accepts an absent
 * header, so a desktop in the field whose bundled client predates this argument
 * keeps last-writer-wins instead of losing the op to a 412 it cannot satisfy.
 * ⚠ AND IT NEEDS NO EXISTENCE PROBE where the KB one does — a template update
 * always overwrites, so there is no create arm to distinguish.
 */
(0, vitest_1.describe)("updateAgentTemplate — optimistic concurrency", () => {
    let mock;
    const TPL = "11111111-1111-4111-8111-111111111111";
    const VERSION = "2026-01-01T00:00:00Z";
    (0, vitest_1.beforeEach)(() => {
        mock = installFetchMock([
            () => jsonResponse(200, { template: { id: TPL, updatedAt: VERSION } }),
        ]);
    });
    (0, vitest_1.afterEach)(() => mock.restore());
    const client = () => new client_js_1.DoplClient(BASE, "k");
    (0, vitest_1.it)("a version rides as `X-Updated-At`", async () => {
        await client().updateAgentTemplate(TPL, { name: "Renamed" }, VERSION);
        const headers = new Headers(mock.calls[0].init.headers);
        (0, vitest_1.expect)(headers.get("x-updated-at")).toBe(VERSION);
    });
    (0, vitest_1.it)("`null` is FORCE — the request goes, with no precondition on it", async () => {
        await client().updateAgentTemplate(TPL, { name: "Renamed" }, null);
        const headers = new Headers(mock.calls[0].init.headers);
        (0, vitest_1.expect)(headers.get("x-updated-at")).toBeNull();
        (0, vitest_1.expect)(mock.calls).toHaveLength(1);
    });
    (0, vitest_1.it)("OMITTING it is refused BEFORE the wire, naming what to pass", async () => {
        await (0, vitest_1.expect)(client().updateAgentTemplate(TPL, { name: "Renamed" })).rejects.toBeInstanceOf(errors_js_1.DoplApiError);
        // ⚠ NOTHING WAS SENT. A refusal that still made the PATCH would be the
        // silent overwrite this whole contract exists to remove.
        (0, vitest_1.expect)(mock.calls).toHaveLength(0);
    });
    (0, vitest_1.it)("…and the refusal carries the code the MCP layer maps on", async () => {
        const failed = client().updateAgentTemplate(TPL, { name: "Renamed" });
        await (0, vitest_1.expect)(failed).rejects.toMatchObject({
            status: 412,
            code: "EXPECTED_VERSION_REQUIRED",
        });
    });
});
