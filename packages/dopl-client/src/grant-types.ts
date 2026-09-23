/**
 * `PUT /api/resource-grants` wire shape. One table, three scopes, two level vocabularies: a channel
 * grant names an AUDIENCE in the room, a container/team grant what its members may DO. Hand-mirrors
 * the two CHECKs of `20260914120000_resource_grants.sql` (as does `src/shared/grants/schema.ts`).
 */

/** `resource_grants.scope_type`'s CHECK. */
export type GrantScopeType = "channel" | "container" | "team";

/** `resource_grants.resource_type`'s CHECK. */
export type GrantResourceType =
  | "knowledge_base"
  | "agent_identity"
  | "skill"
  | "chat"
  | "chat_folder";

/** Channel scopes only (`resource_grants_level_check`'s first arm). */
export type ChannelGrantLevel = "agent_only" | "visible";

/** Container and team scopes only (that CHECK's `ELSE` arm). */
export type ContainerGrantLevel = "read" | "edit";

export type GrantLevel = ChannelGrantLevel | ContainerGrantLevel;

/** Desired end state, so a retry is idempotent; no `"none"` level — revoking is a delete. */
export interface ResourceGrantInput {
  resourceType: GrantResourceType;
  resourceId: string;
  scopeType: GrantScopeType;
  scopeId: string;
  level: GrantLevel;
}

/** The key of the row written. */
export interface ResourceGrantResult {
  scopeType: GrantScopeType;
  scopeId: string;
  resourceType: GrantResourceType;
  resourceId: string;
  level: GrantLevel;
  /** The resource's container, where the row is filed (a follow-up read needs it). */
  workspaceId: string;
}
