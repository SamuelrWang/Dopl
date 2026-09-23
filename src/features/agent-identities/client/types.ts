/**
 * The client's names for the feature's own types and the routes' response envelopes — never a
 * second definition. `import type` only: `../schema.ts` pulls zod, which must stay out of the SPA.
 */

import type {
  AgentIdentity,
  IdentityField,
  IdentityFieldType,
  IdentityKnowledgeBaseRef,
  IdentityKnowledgeRef,
  IdentityKnowledgeScope,
  IdentityKnowledgeScopeKind,
  IdentityShelf,
  IdentityVisibility,
} from "../types";
import type {
  AgentIdentityCreateInput,
  AgentIdentityUpdateInput,
} from "../schema";

export type {
  AgentIdentity,
  IdentityField,
  IdentityFieldType,
  IdentityKnowledgeBaseRef,
  IdentityKnowledgeRef,
  IdentityKnowledgeScope,
  IdentityKnowledgeScopeKind,
  IdentityShelf,
  IdentityVisibility,
};

/** POST body. */
export type AgentIdentityCreateBody = AgentIdentityCreateInput;

/** PATCH body: absent leaves a column alone, `null` clears it; sets are replace-sets. */
export type AgentIdentityUpdateBody = AgentIdentityUpdateInput;

/** `GET /api/agent-identities`. */
export interface AgentIdentityListResponse {
  identities: AgentIdentity[];
}

/** `POST /api/agent-identities` and `GET|PATCH /api/agent-identities/{id}`. */
export interface AgentIdentityResponse {
  identity: AgentIdentity;
}
