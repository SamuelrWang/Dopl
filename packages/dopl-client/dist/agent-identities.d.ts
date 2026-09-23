/**
 * Agent-identity methods (class side: `client-agent-identities.ts`). `DELETE` is app-only and
 * deliberately unbound. Identities are addressed by UUID (the route 400s anything else); name→id
 * resolution is the MCP layer's (`packages/mcp-server/src/tools/agent-shared.ts`).
 */
import type { DoplTransport } from "./transport.js";
import type { AgentIdentity, AgentIdentityCreateInput, AgentIdentityListPayload, AgentIdentityUpdateInput, IdentityShelf } from "./agent-identity-types.js";
/** The identities this caller may see; `shelf` absent = both shelves. */
export declare function listAgentIdentitiesPayload(t: DoplTransport, opts?: {
    shelf?: IdentityShelf;
}): Promise<AgentIdentityListPayload>;
/** The rows alone (same single request as {@link listAgentIdentitiesPayload}). */
export declare function listAgentIdentities(t: DoplTransport, opts?: {
    shelf?: IdentityShelf;
}): Promise<AgentIdentity[]>;
export declare function getAgentIdentity(t: DoplTransport, identityId: string): Promise<AgentIdentity>;
export declare function createAgentIdentity(t: DoplTransport, input: AgentIdentityCreateInput): Promise<AgentIdentity>;
export declare function updateAgentIdentity(t: DoplTransport, identityId: string, patch: AgentIdentityUpdateInput, expectedVersion?: string | null): Promise<AgentIdentity>;
