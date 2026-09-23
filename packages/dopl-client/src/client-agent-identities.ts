/**
 * Agent-identity method group (`HomeMethods` extends this one; chain in `client-base.ts`). Pure
 * delegation to `agent-identities.ts`; only `DELETE` is `sessionOnly`, and it is unbound.
 */

import { SkillMethods } from "./client-skills.js";
import * as identities from "./agent-identities.js";
import type {
  AgentIdentity,
  AgentIdentityCreateInput,
  AgentIdentityListPayload,
  AgentIdentityUpdateInput,
  IdentityShelf,
} from "./agent-identity-types.js";

export class AgentIdentityMethods extends SkillMethods {
  listAgentIdentities(
    opts: { shelf?: IdentityShelf } = {}
  ): Promise<AgentIdentity[]> {
    return identities.listAgentIdentities(this.transport, opts);
  }

  /** The rows plus the shelf sibling key; read `homeScopedIdentityIds` as `?? []` (INVARIANTS §8). */
  listAgentIdentitiesPayload(
    opts: { shelf?: IdentityShelf } = {}
  ): Promise<AgentIdentityListPayload> {
    return identities.listAgentIdentitiesPayload(this.transport, opts);
  }

  getAgentIdentity(identityId: string): Promise<AgentIdentity> {
    return identities.getAgentIdentity(this.transport, identityId);
  }

  createAgentIdentity(input: AgentIdentityCreateInput): Promise<AgentIdentity> {
    return identities.createAgentIdentity(this.transport, input);
  }

  /** `expectedVersion` is tri-state and omitting it refuses (`agent-identities.ts › updateAgentIdentity`). */
  updateAgentIdentity(
    identityId: string,
    patch: AgentIdentityUpdateInput,
    expectedVersion?: string | null
  ): Promise<AgentIdentity> {
    return identities.updateAgentIdentity(
      this.transport,
      identityId,
      patch,
      expectedVersion
    );
  }
}
