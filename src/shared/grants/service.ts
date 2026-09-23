import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole } from "@/features/workspaces/types";
import { findMembership } from "@/features/workspaces/server/repository";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";
import {
  resolveResource,
  type ResourceCaller,
} from "@/shared/tenancy/resolve-resource";
import { assertChannelScopeAllowedInContainer } from "@/shared/tenancy/channel-scope";
import type { ResourceGrantWrite } from "./schema";

/**
 * The grant write (`dopl_kb` / `dopl_agent` `op="grant"`, the /home share control). Fences, in order:
 *  1. the route's `withWorkspaceAuth` — authenticated, but not the fence for either side of a grant;
 *  2. the resource resolves and the caller created it ({@link assertGrantableResource}): reading a
 *     row is not lending it;
 *  3. the caller reaches the scope ({@link assertGrantableScope}): active `member` of its container, a
 *     visible channel, and a channel must be a home channel (`shared/tenancy/channel-scope.ts`);
 *  4. `enforce_resource_grant()` in the database — defense in depth, its RAISEs mapped to one 400.
 * 404-never-403 on both sides: a foreign resource or unreachable scope answers as a missing one.
 * Lend only, no revoke; `PUT /api/knowledge/bases/{id}/channel-grants` owns the channel×KB write.
 */

/** Keyed as `resolve-resource.ts` keys them. `chat_folder` is a legal grant type with no resolver, so
 *  it is refused here instead of 404ing as not-owned. */
const RESOLVABLE = new Set([
  "knowledge_base",
  "agent_identity",
  "skill",
  "chat",
]);

/** Fence 2. Returns the container the grant is filed under: the resource's, never the scope's. */
async function assertGrantableResource(
  caller: ResourceCaller,
  input: ResourceGrantWrite
): Promise<string> {
  if (!RESOLVABLE.has(input.resourceType)) {
    throw HttpError.badRequest(
      `resourceType "${input.resourceType}" cannot be granted from this door yet.`
    );
  }
  const resolved = await resolveResource(
    caller,
    input.resourceType as "knowledge_base" | "agent_identity" | "skill" | "chat",
    input.resourceId
  );
  // One answer for "no such row", "not yours to lend" and "outside your lock".
  if (resolved === null || !resolved.ownedByCaller) {
    throw HttpError.notFound("Resource not found");
  }
  return resolved.containerId;
}

/** The scope's container by the same `CASE` as `enforce_resource_grant()`, so a miss is a 404 at the
 *  door, not a trigger `P0001`. `service.test.ts` checks the arms still match the trigger's. */
async function scopeContainerId(
  scopeType: ResourceGrantWrite["scopeType"],
  scopeId: string
): Promise<string | null> {
  const db = supabaseAdmin();
  const from = scopeType === "container" ? "workspaces" : scopeType === "channel" ? "channels" : "teams";
  const column = scopeType === "container" ? "id" : "workspace_id";
  const { data, error } = await db
    .from(from)
    .select(column)
    .eq("id", scopeId)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, string> | null)?.[column] ?? null;
}

/** Fence 3. */
async function assertGrantableScope(
  caller: { userId: string },
  input: ResourceGrantWrite
): Promise<void> {
  const scopeWorkspaceId = await scopeContainerId(input.scopeType, input.scopeId);
  if (scopeWorkspaceId === null) throw HttpError.notFound("Scope not found");
  const membership = await findMembership(scopeWorkspaceId, caller.userId);
  // `member`, not `viewer`: lending changes other people's reach. `guest` and revoked rows fail too.
  if (membership === null || !meetsMinRole(membership.role, "member")) {
    throw HttpError.notFound("Scope not found");
  }
  if (input.scopeType !== "channel") return;
  if (!(await isChannelVisibleTo(scopeWorkspaceId, caller.userId, input.scopeId))) {
    throw HttpError.notFound("Scope not found");
  }
  // Fence 3b, after visibility: the caller can already see the channel, so a 400 naming the rule
  // (`SCOPE_NOT_ALLOWED_IN_WORKSPACE`) tells them nothing new.
  await assertChannelScopeAllowedInContainer(scopeWorkspaceId);
}

/**
 * Did `enforce_resource_grant()` or a `CHECK` beside it refuse this write? The `resource_grants:`
 * prefix is checked, not just `P0001`, so an unrelated trigger's RAISE is not relabelled; `23514`
 * (level CHECK) and `23503` (container vanished after fence 3) count too.
 */
export function isGrantValidityViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: string; message?: string };
  if (code === "23503" || code === "23514") return true;
  return code === "P0001" && (message ?? "").includes("resource_grants:");
}

export interface GrantedResource extends ResourceGrantWrite {
  workspaceId: string;
}

/** Lend one resource to one scope. Upserts on the primary key, so a retry changes nothing. */
export async function grantResource(
  caller: ResourceCaller,
  input: ResourceGrantWrite
): Promise<GrantedResource> {
  const workspaceId = await assertGrantableResource(caller, input);
  await assertGrantableScope(caller, input);
  const { error } = await supabaseAdmin()
    .from("resource_grants")
    .upsert(
      {
        scope_type: input.scopeType,
        scope_id: input.scopeId,
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        workspace_id: workspaceId,
        level: input.level,
        // `enforce_resource_grant()` reads the grantor for its cross-container arm.
        created_by: caller.userId,
      },
      { onConflict: "scope_type,scope_id,resource_type,resource_id" }
    );
  if (error) {
    if (isGrantValidityViolation(error)) {
      throw HttpError.badRequest("That grant was refused.");
    }
    throw error;
  }
  return { ...input, workspaceId };
}
