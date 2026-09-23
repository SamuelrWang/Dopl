/** Split out of `resolve-resource.ts` (2026-09-14, 500-line cap): the per-resource TABLE REGISTRY the fence reads — which table, which columns, which "shared with the container" arm, and the membership floor — re-exported from `resolve-resource.ts`, so no importer moved. */
import "server-only";
import type { Role } from "@/features/workspaces/types";

/**
 * The resources whose ids resolve. ⚠ **A12 SHIPPED ONE ENTRY AS A PILOT; B2
 * COMPLETED THE SET** (2026-09-02). Everything an id can name on a read is a row
 * in {@link RESOURCE_TABLES} — adding a fifth is a row and a read path, never a
 * second resolver.
 */
export type ResourceType =
  | "agent_identity"
  | "knowledge_base"
  | "skill"
  | "chat";

/**
 * What each resource's table calls the columns the fence reads. ⚠ **EVERY FIELD
 * IS A CONSTANT WRITTEN HERE**; none of it is ever caller-supplied, which is
 * what makes {@link ResourceTable.sharedArm} safe to interpolate raw.
 *
 * ⚠ `nameColumn` — `chats` calls it `title`. The select ALIASES it back to
 * `name` so one row shape serves every type.
 * ⚠ `sharedArm` is a POSTGREST FILTER FRAGMENT, not a value, and that is the
 * reason it is a fragment: "visible to every member of the container" is ONE
 * column on `agent_identities` (`visibility = 'workspace'`) and TWO everywhere
 * else — a `public` base/skill/chat in `access_mode = 'teams'` is visible to the
 * GRANTED TEAMS and not to the container, so naming it here would widen clause 4
 * into the existence oracle the clause exists to close.
 * ⚠ `deletedColumn` is `null` where a delete is a `DELETE`. A soft-deleted row
 * is not listable by anyone, so it must not be nameable either — otherwise an id
 * resolves a container for a row every read path skips.
 */
export interface ResourceTable {
  table: string;
  ownerColumn: string;
  nameColumn: string;
  sharedArm: string;
  deletedColumn: string | null;
}

/** The "every member of the container may read it" arm for the three tables
 *  that carry `access_mode`. ⚠ BOTH halves are required — see
 *  {@link ResourceTable.sharedArm}. */
export const SHARED_WITH_CONTAINER =
  "and(visibility.eq.public,access_mode.eq.workspace)";

export const RESOURCE_TABLES: Record<ResourceType, ResourceTable> = {
  agent_identity: {
    table: "agent_identities",
    ownerColumn: "created_by",
    nameColumn: "name",
    // ⚠ `agent_identities` has no `access_mode`: its third value IS `team`, so
    // the team scope is already outside this arm rather than hidden inside it.
    sharedArm: "visibility.eq.workspace",
    // ⚠ No soft delete — `20260822200000_agent_templates.sql`: "A delete is a
    // `DELETE`, and both junctions go with it".
    deletedColumn: null,
  },
  knowledge_base: {
    table: "knowledge_bases",
    ownerColumn: "created_by",
    nameColumn: "name",
    sharedArm: SHARED_WITH_CONTAINER,
    deletedColumn: "deleted_at",
  },
  skill: {
    table: "skills",
    ownerColumn: "created_by",
    nameColumn: "name",
    sharedArm: SHARED_WITH_CONTAINER,
    deletedColumn: "deleted_at",
  },
  chat: {
    table: "chats",
    ownerColumn: "owner_id",
    // ⚠ A chat's label is its `title`; there is no `name` column to fall back
    // on, so the alias in {@link selectList} is load-bearing rather than tidy.
    nameColumn: "title",
    sharedArm: SHARED_WITH_CONTAINER,
    deletedColumn: "deleted_at",
  },
};

/**
 * 🔒 The membership floor a container must clear before its rows are nameable.
 *
 * ⚠ `guest` RANKS BELOW IT AND THAT IS THE POINT. Every resource route in the
 * product sits at `withWorkspaceAuth`'s `viewer` floor, so a guest cannot read
 * these rows in their own container — resolving ids there would be a door under
 * that floor rather than an extra fact.
 */
export const CONTAINER_READ_FLOOR: Role = "viewer";

