/**
 * RESOURCE GRANTS — the wire shape of `PUT /api/resource-grants`.
 *
 * ⚠ **ONE TABLE, THREE SCOPES, AND TWO LEVEL VOCABULARIES** (Wave B ruling B4,
 * `supabase/migrations/20260914120000_resource_grants.sql`). A CHANNEL grant
 * says which AUDIENCE inside the room may see the row (`agent_only` names no
 * human at all); a CONTAINER or TEAM grant says what the people who already
 * belong to that scope may DO with it. They are not a high/low pair, which is
 * why one column carries both and the DB `CHECK` knows which is which.
 *
 * ⚠ **DECLARED HERE, MIRRORED IN `src/shared/grants/schema.ts`'s zod.** Both are
 * hand-mirrors of the migration's two `CHECK` constraints, which is the only
 * authority — a value legal in one and not the others fails at the statement.
 */
/** Where a resource is lent. ⚠ Mirrors `resource_grants.scope_type`'s CHECK. */
export type GrantScopeType = "channel" | "container" | "team";
/** What may be lent. ⚠ Mirrors `resource_grants.resource_type`'s CHECK. */
export type GrantResourceType = "knowledge_base" | "agent_template" | "skill" | "chat" | "chat_folder";
/** ⚠ CHANNEL scopes only — `resource_grants_level_check`'s first arm. */
export type ChannelGrantLevel = "agent_only" | "visible";
/** ⚠ CONTAINER and TEAM scopes only — that CHECK's `ELSE` arm. */
export type ContainerGrantLevel = "read" | "edit";
export type GrantLevel = ChannelGrantLevel | ContainerGrantLevel;
/**
 * The write. ⚠ It states the desired END STATE, so a retry after an ambiguous
 * failure is idempotent — the same contract
 * `PUT /api/knowledge/bases/{id}/channel-grants` keeps, and the reason `level`
 * has no `"none"`: REVOKING is a DELETE of the row, and this slice ships only
 * the lend (B15 replaces the copy ops, which had no un-copy either).
 */
export interface ResourceGrantInput {
    resourceType: GrantResourceType;
    resourceId: string;
    scopeType: GrantScopeType;
    scopeId: string;
    level: GrantLevel;
}
/** What the route answers with — the key of the row it wrote, and nothing the
 *  caller did not already state. */
export interface ResourceGrantResult {
    scopeType: GrantScopeType;
    scopeId: string;
    resourceType: GrantResourceType;
    resourceId: string;
    level: GrantLevel;
    /** The RESOURCE's container, which is where the row is filed (rule 3 of the
     *  migration header). The caller cannot compute it and a follow-up read needs
     *  it. */
    workspaceId: string;
}
