/** The table registry `resolve-resource.ts` fences over: table, columns, container-shared arm, membership floor. */
import "server-only";
import type { Role } from "@/features/workspaces/types";

/** Everything an id can name on a read; a new type is a row in {@link RESOURCE_TABLES} plus a read
 *  path, never a second resolver. */
export type ResourceType =
  | "agent_identity"
  | "knowledge_base"
  | "skill"
  | "chat";

/** The columns the fence reads, per table. Every value is a constant written here, never caller input. */
export interface ResourceTable {
  table: string;
  ownerColumn: string;
  nameColumn: string;
  /** A constant PostgREST filter fragment, so safe to interpolate into `.or()`. A fragment because
   *  "shared with the whole container" is one column on `agent_identities` and two elsewhere. */
  sharedArm: string;
  /** `null` where a delete is a hard `DELETE`; a soft-deleted row must not be nameable. */
  deletedColumn: string | null;
}

/** Both halves required: a `public` row in `access_mode='teams'` is visible to its granted teams, not
 *  the container — naming it would make clause 4 an existence oracle. */
export const SHARED_WITH_CONTAINER =
  "and(visibility.eq.public,access_mode.eq.workspace)";

export const RESOURCE_TABLES: Record<ResourceType, ResourceTable> = {
  agent_identity: {
    table: "agent_identities",
    ownerColumn: "created_by",
    nameColumn: "name",
    // No `access_mode`: `visibility='team'` is its own value, already outside this arm.
    sharedArm: "visibility.eq.workspace",
    // `agent_identities` has no soft delete: a delete is a `DELETE`.
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
    // No `name` column, so the alias in `resolve-resource.ts › selectList` is load-bearing.
    nameColumn: "title",
    sharedArm: SHARED_WITH_CONTAINER,
    deletedColumn: "deleted_at",
  },
};

/** Membership floor for nameable rows. `guest` ranks below it on purpose: resource routes sit at
 *  `withWorkspaceAuth`'s `viewer` floor, so resolving for a guest would be a door under that floor. */
export const CONTAINER_READ_FLOOR: Role = "viewer";

