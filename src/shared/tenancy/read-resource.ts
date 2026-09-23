import "server-only";
import type { Role } from "@/features/workspaces/types";
import {
  resolveResource,
  type ResourceCaller,
  type ResourceType,
} from "./resolve-resource";

/**
 * Follows a resolved address: read in the caller's container, and only on a miss re-run the caller's
 * own read in the container `resolve-resource.ts` names. Written once so no feature hand-copies it (F-278).
 * Not a fence and reads nothing itself: the resolver decides what may be named, `load` what may be
 * seen — and `load` must be the same read in both containers.
 * Writes follow the address too (INVARIANTS §5A): the edit gate runs in the row's own container, and
 * every workspace-keyed call after it must use the returned {@link ContainerRead} context — gating in
 * one container and writing in another is worse than refusing. A write gate not given that context
 * keeps its workspace-keyed lookup and refuses.
 */

/** The fence's inputs plus the container being read and the caller's role there; structural, so
 *  feature contexts satisfy it without a shared base type. */
export interface ContainerScopedCaller extends ResourceCaller {
  workspaceId: string;
  role: Role | null;
}

/** A row and the context it was actually read in. Its children (entries, messages, references) are
 *  workspace-keyed, so they must be read with this `ctx`, not the original. */
export interface ContainerRead<Ctx, T> {
  ctx: Ctx;
  value: T;
}

/** Read one row by id wherever the caller may name it. `null` = the single 404: missing, not visible,
 *  or out of reach. Extra reads happen only on a miss in the caller's container. */
export async function readResourceById<Ctx extends ContainerScopedCaller, T>(
  ctx: Ctx,
  type: ResourceType,
  id: string,
  load: (ctx: Ctx, id: string) => Promise<T | null>
): Promise<ContainerRead<Ctx, T> | null> {
  const here = await load(ctx, id);
  if (here) return { ctx, value: here };
  const resolved = await resolveResource(ctx, type, id);
  // Resolving back to the container that just missed means the caller's own matrix refused it.
  if (!resolved || resolved.containerId === ctx.workspaceId) return null;
  const there: Ctx = {
    ...ctx,
    workspaceId: resolved.containerId,
    // The caller's real role there, never a guess: `null` would drop rows that role can see.
    role: resolved.containerRole,
  };
  const value = await load(there, id);
  return value ? { ctx: there, value } : null;
}
