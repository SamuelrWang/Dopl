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
import type { ResourceGrantWrite } from "./schema";

/**
 * 🔒 **THE GRANT WRITE — the door that REPLACED the two copy ops** (Wave B slice
 * B15, Samuel's ruling B11: *grants replace copies*; F-419 disposed by
 * deletion). `dopl_kb(op="grant")`, `dopl_agent(op="grant")` and the /home
 * "Share into this channel" control all land here.
 *
 * ── 🔒 THE FOUR FENCES, IN ORDER, AND WHY THERE ARE FOUR ────────────────────
 *
 *  1. **THE ROUTE'S `withWorkspaceAuth`** — the caller is an authenticated
 *     member of *some* workspace. It resolves ONE workspace and is deliberately
 *     NOT the fence for either side of a grant: a grant names two containers.
 *  2. **THE RESOURCE RESOLVES *AND* IS THE CALLER'S OWN**
 *     ({@link assertGrantableResource}). `resolveResource` answers `null` for
 *     "no such row", "somebody else's private row" and "outside your lock" as
 *     ONE answer, and this then narrows that answer to rows the caller CREATED.
 *     ⚠ **THAT SECOND HALF IS R2, CARRIED OVER FROM THE COPY OPS RATHER THAN
 *     INVENTED** (`copy-target.ts › notOwnedRefusal`, deleted with them): being
 *     able to READ a row is not being able to LEND it, and a grant widens an
 *     audience in exactly the direction a copy did.
 *  3. **THE SCOPE IS ONE THE CALLER REACHES** ({@link assertGrantableScope}).
 *     The scope resolves to its container by the SAME `CASE` the trigger uses,
 *     the caller must be an active `member` of that container, and a CHANNEL
 *     must additionally be visible to them — the `?channelId=` precedent, 404 on
 *     a miss so the write is never a room oracle.
 *  4. **`enforce_resource_grant()`** — the database's own "the grantor may share
 *     this" (`20260914120000`). It is defense in depth here rather than the only
 *     fence, and its eight RAISE branches are translated to ONE 400: refused,
 *     not broken.
 *
 * ⚠ **404-NEVER-403 ON BOTH SIDES.** A foreign resource and an unreachable
 * scope answer exactly what a nonexistent one answers. The difference between
 * the codes would be an existence oracle over other people's private rows and
 * over rooms the caller is not in.
 *
 * ⚠ **THIS SLICE SHIPS THE LEND, NOT THE REVOKE.** There is no `level: "none"`:
 * the copy ops it replaces had no un-copy either, and a delete surface is a
 * separate decision about who may take something back. `PUT
 * /api/knowledge/bases/{id}/channel-grants` still owns the three-state
 * channel×KB write the app's own sharing panel drives.
 */

/** The rows this write may touch, keyed the way `resolve-resource.ts` keys
 *  them. ⚠ `chat_folder` is a legal `resource_grants` value with no resolver, so
 *  it is refused HERE rather than reaching a `null` resolution and 404ing with a
 *  sentence about ownership. */
const RESOLVABLE = new Set([
  "knowledge_base",
  "agent_template",
  "skill",
  "chat",
]);

/** Fence 2 — resolves the resource and returns the container the grant is FILED
 *  under (rule 3 of the migration header: the RESOURCE's container, never the
 *  scope's). */
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
    input.resourceType as "knowledge_base" | "agent_template" | "skill" | "chat",
    input.resourceId
  );
  // ⚠ ONE ANSWER for "no such row", "not yours to lend" and "outside your lock".
  if (resolved === null || !resolved.ownedByCaller) {
    throw HttpError.notFound("Resource not found");
  }
  return resolved.containerId;
}

/** The container a scope belongs to — the SAME `CASE` `enforce_resource_grant()`
 *  runs, restated in TypeScript so the refusal is a 404 at the door instead of a
 *  `P0001` from a trigger. ⚠ If the trigger's arms change, this changes with
 *  them; `resource-grants.test.ts` drives both. */
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

/** Fence 3 — the caller reaches the scope. */
async function assertGrantableScope(
  caller: { userId: string },
  input: ResourceGrantWrite
): Promise<void> {
  const scopeWorkspaceId = await scopeContainerId(input.scopeType, input.scopeId);
  if (scopeWorkspaceId === null) throw HttpError.notFound("Scope not found");
  const membership = await findMembership(scopeWorkspaceId, caller.userId);
  // ⚠ `member`, not `viewer`: lending is a WRITE about other people's reach, and
  // a viewer administers nothing. `guest` and a revoked row fail the same way.
  if (membership === null || !meetsMinRole(membership.role, "member")) {
    throw HttpError.notFound("Scope not found");
  }
  if (
    input.scopeType === "channel" &&
    !(await isChannelVisibleTo(scopeWorkspaceId, caller.userId, input.scopeId))
  ) {
    throw HttpError.notFound("Scope not found");
  }
}

/**
 * Did `enforce_resource_grant()` (or one of the `CHECK`s it stands beside)
 * refuse this write?
 *
 * ⚠ **THE PREFIX IS CHECKED, NOT ONLY THE CODE.** `RAISE EXCEPTION` with no
 * `ERRCODE` is `P0001`, which is also what any other `plpgsql` RAISE in the
 * write path would be, so a bare code match would relabel an unrelated trigger's
 * failure as a refused grant and hand the caller a confident wrong explanation.
 * `23514` (the per-scope `level` CHECK) and `23503` (the container row vanishing
 * between fence 3 and this statement) ride along: same class of answer.
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

/**
 * Lend one resource to one scope. ⚠ **UPSERT ON THE PRIMARY KEY**
 * `(scope_type, scope_id, resource_type, resource_id)`, so the write states an
 * END STATE and a retry after an ambiguous failure changes nothing — the same
 * contract the channel-grants PUT keeps, and the property an agent lane needs
 * more than a browser does.
 */
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
        // 🔒 THE GRANTOR IS NAMED. `enforce_resource_grant()` reads it for the
        // cross-container arm — an unattributed row falls back to the narrower
        // same-container equality — and this door always has a person.
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
