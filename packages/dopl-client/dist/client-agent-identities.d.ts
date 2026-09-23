/**
 * Agent-identity method group — link 9 of the chain in `client-base.ts`
 * (`BillingMethods` extends this one). Pure delegation to `agent-identities.ts`;
 * no HTTP here.
 *
 * `GET`/`POST /api/agent-identities` and `GET`/`PATCH .../{id}` are all
 * agent-token reachable by design (the route docblocks carry the argument);
 * only `DELETE` is `sessionOnly`, and it is deliberately unbound.
 */
import { SkillMethods } from "./client-skills.js";
import type { AgentIdentity, AgentIdentityCreateInput, AgentIdentityListPayload, AgentIdentityUpdateInput, IdentityShelf } from "./agent-identity-types.js";
export declare class AgentIdentityMethods extends SkillMethods {
    listAgentIdentities(opts?: {
        shelf?: IdentityShelf;
    }): Promise<AgentIdentity[]>;
    /** The rows PLUS the shelf sibling key. ⚠ Same single request; read
     *  `homeScopedIdentityIds` as `?? []` (INVARIANTS §8). */
    listAgentIdentitiesPayload(opts?: {
        shelf?: IdentityShelf;
    }): Promise<AgentIdentityListPayload>;
    getAgentIdentity(identityId: string): Promise<AgentIdentity>;
    createAgentIdentity(input: AgentIdentityCreateInput): Promise<AgentIdentity>;
    /** ⚠ `expectedVersion` is TRI-STATE and OMITTING IT REFUSES — see
     *  `agent-identities.ts › updateAgentIdentity`. Same three arms as
     *  `knowledge.ts › writeKbFileByPath`. */
    updateAgentIdentity(identityId: string, patch: AgentIdentityUpdateInput, expectedVersion?: string | null): Promise<AgentIdentity>;
}
