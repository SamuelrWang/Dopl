/**
 * Agent-identity method group (`HomeMethods` extends this one; chain in `client-base.ts`). Pure
 * delegation to `agent-identities.ts`; only `DELETE` is `sessionOnly`, and it is unbound.
 */
import { SkillMethods } from "./client-skills.js";
import type { AgentIdentity, AgentIdentityCreateInput, AgentIdentityListPayload, AgentIdentityUpdateInput, IdentityShelf } from "./agent-identity-types.js";
export declare class AgentIdentityMethods extends SkillMethods {
    listAgentIdentities(opts?: {
        shelf?: IdentityShelf;
    }): Promise<AgentIdentity[]>;
    /** The rows plus the shelf sibling key; read `homeScopedIdentityIds` as `?? []` (INVARIANTS §8). */
    listAgentIdentitiesPayload(opts?: {
        shelf?: IdentityShelf;
    }): Promise<AgentIdentityListPayload>;
    getAgentIdentity(identityId: string): Promise<AgentIdentity>;
    createAgentIdentity(input: AgentIdentityCreateInput): Promise<AgentIdentity>;
    /** `expectedVersion` is tri-state and omitting it refuses (`agent-identities.ts › updateAgentIdentity`). */
    updateAgentIdentity(identityId: string, patch: AgentIdentityUpdateInput, expectedVersion?: string | null): Promise<AgentIdentity>;
}
