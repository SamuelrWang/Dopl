/**
 * Billing methods for `DoplClient` — today exactly one, the MCP credit spend.
 * Free functions over `DoplTransport`; the class-side method group is
 * `client-billing.ts`.
 */
import type { DoplTransport } from "./transport.js";
import type { CreditConsumeResponse, McpCallTally } from "./types.js";
/**
 * Charge ONE MCP tool call to a workspace (`POST /api/mcp/credits/consume`).
 *
 * ⚠ `workspaceId` is the ADDRESSED CONTAINER, and the server derives the wallet
 * from it (home space → the owner's personal wallet; standard workspace → the
 * caller's seat) — it is not a pooled workspace balance.
 *
 * ⚠ It is an explicit per-request override, NOT the AsyncLocalStorage scope:
 * the registrar calls this OUTSIDE the handler's workspace scope on one of its
 * two terminal paths, and charging the wrong container is the one failure this
 * method must not have.
 *
 * POST is outside `IDEMPOTENT_METHODS`, so the transport never retries it — a
 * retried spend is a double charge. `call` rides the body for the route's tally; a fan-out's
 * extra legs omit it, being charges for a call already tallied.
 */
export declare function consumeCredits(t: DoplTransport, workspaceId: string, call?: McpCallTally): Promise<CreditConsumeResponse>;
