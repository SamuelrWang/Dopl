/**
 * Agent-identity methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-agent-identities.ts`.
 *
 * ⚠ FOUR VERBS AND THE OMISSION IS THE POINT. `DELETE /api/agent-identities/
 * {id}` is `sessionOnly` AND app-only by standing policy (Samuel's ruling Q9,
 * 2026-08-28), so binding it here would publish a method every MCP tool holds
 * and no MCP caller may ever use.
 *
 * ⚠ IDENTITIES ARE ADDRESSED BY UUID, never by slug — the route param validator
 * (`shared/api/agent-identity-route.ts › requireIdentityId`) 400s anything
 * else. Name→id resolution is the MCP layer's job
 * (`packages/mcp-server/src/tools/agent-shared.ts`), over the already
 * visibility-filtered list this module returns.
 */
import type { DoplTransport } from "./transport.js";
import type { AgentIdentity, AgentIdentityCreateInput, AgentIdentityListPayload, AgentIdentityUpdateInput, IdentityShelf } from "./agent-identity-types.js";
/**
 * The identities this caller may SEE, optionally narrowed to one shelf.
 *
 * ⚠ `shelf` ABSENT = BOTH shelves, and that is the pre-existing contract every
 * caller rides. An unrecognised value never reaches here — the MCP arg is an
 * enum and the route answers 400 — so this function never has to decide what a
 * misspelling means.
 */
export declare function listAgentIdentitiesPayload(t: DoplTransport, opts?: {
    shelf?: IdentityShelf;
}): Promise<AgentIdentityListPayload>;
/** The rows alone. ⚠ DELEGATES to {@link listAgentIdentitiesPayload} — one HTTP
 *  call either way, and one place that knows the URL. */
export declare function listAgentIdentities(t: DoplTransport, opts?: {
    shelf?: IdentityShelf;
}): Promise<AgentIdentity[]>;
export declare function getAgentIdentity(t: DoplTransport, identityId: string): Promise<AgentIdentity>;
export declare function createAgentIdentity(t: DoplTransport, input: AgentIdentityCreateInput): Promise<AgentIdentity>;
export declare function updateAgentIdentity(t: DoplTransport, identityId: string, patch: AgentIdentityUpdateInput, expectedVersion?: string | null): Promise<AgentIdentity>;
