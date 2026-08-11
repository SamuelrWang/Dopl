"use strict";
/**
 * Billing methods for `DoplClient` — today, exactly one: the MCP credit
 * spend. Free functions over `DoplTransport`; the class-side method group is
 * `client-billing.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeCredits = consumeCredits;
/**
 * Charge ONE MCP tool call to a workspace (`POST /api/mcp/credits/consume`).
 *
 * `workspaceId` is passed as an explicit per-request override rather than
 * relying on the AsyncLocalStorage scope, because the registrar calls this
 * OUTSIDE the handler's workspace scope on one of its two terminal paths —
 * charging the wrong workspace is the one failure this method must not have.
 *
 * POST is not in `IDEMPOTENT_METHODS`, so the transport does not retry it: a
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
