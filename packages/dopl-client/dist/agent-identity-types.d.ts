/**
 * Agent identity types — a role of the user that outlives any session launched from it. Hand-mirrors
 * `src/features/agent-identities/types.ts` with no drift gate: move both halves in one change.
 */
import type { IdentityVisibility } from "@dopl/contracts";
export type { IdentityVisibility };
/** How a field's value is typed in the editor; absent = `text`. */
export type IdentityFieldType = "text" | "number" | "date" | "boolean" | "url";
/** One custom field; both halves are short labels spliced into the launch payload. */
export interface IdentityField {
    key: string;
    value: string;
    /** Absent = `text`. An MCP update copies it from the stored row when omitted (P8-01). */
    type?: IdentityFieldType;
}
/** A knowledge base attached to an identity — a REFERENCE, never a copy. */
export interface IdentityKnowledgeBaseRef {
    id: string;
    name: string;
}
/** How much of a base an attachment names; a folder means its live subtree. An attachment, not a
 *  permission — the read ceiling stays base-keyed. */
export type IdentityKnowledgeScopeKind = "base" | "folder" | "entry";
/** The write shape: ids only (a path on the wire is a name a rename falsifies). */
export type IdentityKnowledgeScope = {
    baseId: string;
    scope: "base";
} | {
    baseId: string;
    scope: "folder";
    folderId: string;
} | {
    baseId: string;
    scope: "entry";
    entryId: string;
};
/** The read shape, resolved under the reading caller's visibility. `path` is display
 *  (`Base / Folder / Entry`); `toolPath` is what a `dopl_kb` call takes — never interchangeable. */
export interface IdentityKnowledgeRef {
    baseId: string;
    baseName: string;
    scope: IdentityKnowledgeScopeKind;
    folderId?: string;
    folderName?: string;
    entryId?: string;
    entryTitle?: string;
    path: string;
    toolPath?: string;
}
/** Which surface LISTS an identity (the wire's `?shelf=`), not who may read it. Absent = no filter. */
export type IdentityShelf = "home" | "workspace";
export interface AgentIdentity {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    instructions: string | null;
    /** Passed through at spawn; null = the runtime's own default (no roster here). */
    model: string | null;
    /** The runtime `model` belongs to; null = no preference. Absent on an older server. */
    runtime?: string | null;
    fields: IdentityField[];
    visibility: IdentityVisibility;
    /** Populated only for `team` visibility and only for the creator / admins (composition leaks). */
    teamIds: string[];
    /** Viewer-filtered, base-level scopes only (the older-server fallback for `knowledge`). */
    knowledgeBases: IdentityKnowledgeBaseRef[];
    /** Every attached scope (base, folder, entry). Optional per §8: a cached older payload lacks it. */
    knowledge?: IdentityKnowledgeRef[];
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
}
/** `GET /api/agent-identities`: rows plus a sibling key (not a row field), read as `?? []` (§8). */
export interface AgentIdentityListPayload {
    identities: AgentIdentity[];
    /** Ids of the listed identities on the caller's PERSONAL (/home) shelf. */
    homeScopedIdentityIds?: string[];
}
export interface AgentIdentityCreateInput {
    name: string;
    description?: string | null;
    instructions?: string | null;
    model?: string | null;
    runtime?: string | null;
    fields?: IdentityField[];
    visibility?: IdentityVisibility;
    /** Requires `visibility: 'team'`; the server refuses the pair otherwise. */
    teamIds?: string[];
    /** Whole bases, REPLACE-SET; each must be visible to the caller. Mutually exclusive with `knowledge`. */
    knowledgeBaseIds?: string[];
    /** Scoped attachments, REPLACE-SET; mutually exclusive with `knowledgeBaseIds`. */
    knowledge?: IdentityKnowledgeScope[];
    /** Route the new row to the caller's home space (`home-space.ts ›
     *  homeSpaceWriteWorkspaceId` 403s rather than downgrading). Omitted = the container of the call. */
    homeScoped?: boolean;
    /** Required only when publishing at shared visibility into a home-channel container with 2+
     *  active members (400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`); MCP sets it only from a spent token. */
    acknowledgeShared?: boolean;
}
/** Absent leaves a column alone, `null` clears it; `fields`, `knowledgeBaseIds`, `teamIds` are
 *  REPLACE-SET. No `homeScoped`: the shelf is set at create only (F-342). */
export interface AgentIdentityUpdateInput {
    name?: string;
    description?: string | null;
    instructions?: string | null;
    model?: string | null;
    runtime?: string | null;
    fields?: IdentityField[];
    visibility?: IdentityVisibility;
    teamIds?: string[];
    knowledgeBaseIds?: string[];
    /** Scoped attachments, REPLACE-SET; mutually exclusive with `knowledgeBaseIds`. */
    knowledge?: IdentityKnowledgeScope[];
    /** Required only when publishing at shared visibility into a home-channel container with 2+
     *  active members (400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`); MCP sets it only from a spent token. */
    acknowledgeShared?: boolean;
}
