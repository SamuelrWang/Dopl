"use strict";
/**
 * Billing methods for `DoplClient` — today exactly one, the MCP credit spend.
 * Free functions over `DoplTransport`; the class-side method group is
 * `client-billing.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeCredits = consumeCredits;
/**
 * Charge ONE MCP tool call to a workspace (`POST /api/mcp/credits/consume`).
 *
 * ⚠ `workspaceId` is an explicit per-request override, NOT the
 * AsyncLocalStorage scope: the registrar calls this OUTSIDE the handler's
 * workspace scope on one of its two terminal paths, and charging the wrong
 * workspace is the one failure this method must not have.
 *
 * POST is outside `IDEMPOTENT_METHODS`, so the transport never retries it — a
 * retried spend is a double charge.
 */
async function consumeCredits(t, workspaceId) {
    return t.request("/api/mcp/credits/consume", {
        method: "POST",
        toolName: "_mcp_credits_consume",
        body: {},
        workspaceIdOverride: workspaceId,
    });
}
