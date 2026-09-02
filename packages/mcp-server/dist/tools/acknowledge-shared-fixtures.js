"use strict";
/**
 * SHARED FIXTURES for the G16 / A11 confirm-and-acknowledge suites.
 *
 * ⚠ **ITS OWN FILE BECAUSE THERE ARE TWO SUITES NOW** (2026-09-02) — the
 * knowledge/agent one and the skills one, split at the §1 500-line cap. A copy of
 * `sharedContainer` in each is two definitions of "the only room this class fires
 * in", and the day they drift one suite is measuring a predicate the server does
 * not run.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.textOf = exports.sharedContainer = exports.ME = void 0;
exports.workspaceStub = workspaceStub;
exports.apiError = apiError;
exports.tokenIn = tokenIn;
const vitest_1 = require("vitest");
exports.ME = "user-1";
/** A workspace directory answer, as `resolveConfirmTarget` reads it. */
function workspaceStub(kind, memberCount) {
    return {
        getWorkspaceId: vitest_1.vi.fn(() => "ws-1"),
        listWorkspaces: vitest_1.vi.fn(async () => ({
            workspaces: [
                { id: "ws-1", slug: "acme", name: "Acme", kind, role: "owner", memberCount },
            ],
        })),
    };
}
/** A `kind='link'` container with a PEER in it — the only room the class fires in. */
const sharedContainer = () => workspaceStub("link", 2);
exports.sharedContainer = sharedContainer;
const textOf = (res) => res.content.map((c) => c.text).join("\n");
exports.textOf = textOf;
/** A `DoplApiError`-shaped rejection, duck-typed the way the tools read it. */
function apiError(status, code) {
    return Object.assign(new Error(`HTTP ${status}`), {
        name: "DoplApiError",
        status,
        code,
    });
}
/** The one-time token out of a preview, or a failed expectation naming the text. */
function tokenIn(text) {
    const m = /confirm_token="([^"]+)"/.exec(text);
    (0, vitest_1.expect)(m, `no confirm_token in:\n${text}`).not.toBeNull();
    return m[1];
}
