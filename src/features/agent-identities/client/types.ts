/**
 * AGENT IDENTITIES — the wire shapes this client reads and writes.
 *
 * ⚠ NOT A SECOND DEFINITION. The domain types are the FEATURE's
 * (`../types.ts`) and the request bodies are the SCHEMA's inferred types
 * (`../schema.ts`) — this module only names them for the client half and adds
 * the two response envelopes the routes actually return. A hand-written mirror
 * here is the two-readers-one-fact defect with a SHARING SCOPE as the thing that
 * drifts, which is exactly the field where a drift stops being cosmetic.
 *
 * ⚠ `import type` THROUGHOUT — `../schema.ts` pulls zod, and the desktop SPA
 * bundles this file. A value import would drag the validator into the renderer.
 *
 * ⚠ `visibility: "workspace"` IS THE VALUE; **"Public" is the LABEL** the UI
 * shows for it. `../lib/visibility.ts` owns that mapping and is the only place
 * the two vocabularies meet — never render `"workspace"` to an operator.
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

/** POST body. `visibility` omitted → the service defaults to `private`. */
export type AgentIdentityCreateBody = AgentIdentityCreateInput;

/**
 * PATCH body.
 *
 * ⚠ `null` AND ABSENT DIFFER, AND BOTH ARE MEANINGFUL (`../schema.ts`): absent
 * leaves the column alone, `null` CLEARS it. `fields`, `teamIds` and
 * `knowledgeBaseIds` are REPLACE-SET — absent = untouched, `[]` = emptied.
 */
export type AgentIdentityUpdateBody = AgentIdentityUpdateInput;

/** `GET /api/agent-identities`. */
export interface AgentIdentityListResponse {
  identities: AgentIdentity[];
}

/** `POST /api/agent-identities` and `GET|PATCH /api/agent-identities/{id}`. */
export interface AgentIdentityResponse {
  identity: AgentIdentity;
}
