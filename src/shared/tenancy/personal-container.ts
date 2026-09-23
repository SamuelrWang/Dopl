import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";
import {
  resolvePersonalReach,
  type PersonalReachRefusal,
} from "./personal-reach";

/**
 * The personal container: one `kind='personal'` workspace per user, and the one place a personal
 * row's address is decided. Its id resolves its own container (`resolve-resource.ts`); sharing is a grant.
 * No fallback: a personal create with no container refuses ({@link PersonalContainerMissingError})
 * rather than landing where the personal shelf never lists it.
 * Not a visibility gate: who may read a row is still `canSeeBase` / `canSeeIdentity` + RLS twins.
 */

/** Structurally identical to `KbShelf` and `IdentityShelf`, which assign here. */
export type PersonalShelf = "home" | "workspace";

/**
 * The personal-shelf refusal: 403, refuse never downgrade (no silent create on the other shelf).
 * Extends `HttpError`, so `shared/api/http-error-response.ts` passes it through at every boundary.
 */
export class PersonalContainerMissingError extends HttpError {
  constructor(reason: string) {
    super(
      403,
      "PERSONAL_CONTAINER_MISSING",
      `This cannot be created on your personal shelf — ${reason}.`
    );
    this.name = "PersonalContainerMissingError";
  }
}

/**
 * One refusal sentence per reason, shared by {@link personalWriteWorkspaceId} and the knowledge and
 * agent-identity write gates so the copies cannot drift. Write paths only, shown only to the owner: on a
 * read, an unreachable shelf must answer what an empty one answers, or reach becomes an oracle.
 */
export function personalShelfRefusal(
  refusal: PersonalReachRefusal
): PersonalContainerMissingError {
  switch (refusal) {
    case "shared_credential":
      return new PersonalContainerMissingError(
        "a shared credential has no personal shelf"
      );
    case "no_container":
      return new PersonalContainerMissingError(
        "your personal container has not been created yet"
      );
    case "unarmed_room":
      return new PersonalContainerMissingError(
        "this channel is not armed for your personal shelf. Arming it is a " +
          "human-only act, taken by its owner in the channel's Personal section"
      );
  }
}

/**
 * The user's personal container id, or `null` if none exists yet. Service role on purpose: it answers
 * "where is my shelf" for an already-proven user id; `workspaces_personal_owner_uidx` makes it one row.
 * Uncached on purpose: a cache would outlive a rollback that deletes the containers.
 */
export async function findPersonalContainerId(
  userId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .eq("kind", "personal")
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * The current request's personal container, read off `caller-scope.ts`'s AsyncLocalStorage because
 * the repositories take no context. Outside a request (cron, script) there is no scope: `null`.
 */
async function callerPersonalContainerId(
  callingWorkspaceId: string
): Promise<string | null> {
  const scope = getCallerScope();
  if (scope === null || scope.sharedCredential) return null;
  // `personal-reach.ts` is the one fence both shelf reads ask.
  const reach = await resolvePersonalReach({
    userId: scope.userId,
    credentialSubjectUserId: scope.userId,
    // The room is the lock where there is one; an unlocked session stands in the container it named.
    workspaceId: scope.credentialWorkspaceId ?? callingWorkspaceId,
    source: scope.source,
  });
  return reach.kind === "open" ? reach.containerId : null;
}

/** Where a shelf-scoped read looks, resolved once per query. */
export interface ShelfScope {
  /** Applied with `.in()`. Empty is the fail-safe read: no personal container, no personal rows. */
  workspaceIds: string[];
}

/** Where `shelf` lives for this caller: `workspace` = the calling container, `home` = the caller's
 *  personal container, absent = both. */
export async function resolveShelfScope(
  workspaceId: string,
  shelf: PersonalShelf | undefined
): Promise<ShelfScope> {
  if (shelf === "workspace") return { workspaceIds: [workspaceId] };
  const containerId = await callerPersonalContainerId(workspaceId);
  if (shelf === "home") {
    // Empty, never `[workspaceId]`: that would answer the personal shelf with shared rows. Also the
    // answer when the shelf is out of reach — no rows, never a refusal, so reach is not an oracle.
    return { workspaceIds: containerId === null ? [] : [containerId] };
  }
  // Unfiltered reads see both shelves, so a personal row is findable from any room it resolves in.
  // Not a default-workspace fallback: the caller's own container is added by owner, nothing guessed.
  // `knowledge/server/repository-bases.ts › listHomeScopedBaseIds` asks this too: label = list.
  return containerId === null || containerId === workspaceId
    ? { workspaceIds: [workspaceId] }
    : { workspaceIds: [workspaceId, containerId] };
}

/** The insert fields this decision reads; both features' insert args already carry them. */
export interface ShelfBoundInsert {
  workspaceId: string;
  /** A routing flag, not a column: `true` = the author's personal container, else `workspaceId`. */
  homeScoped?: boolean;
  createdBy: string | null;
}

/**
 * Where an insert lands; refuses rather than guessing. Keyed on the row's author, not the ambient
 * caller, so seeds and scripts land rows where a request would.
 */
export async function personalWriteWorkspaceId(
  args: ShelfBoundInsert
): Promise<string> {
  if (args.homeScoped !== true) return args.workspaceId;
  // A null author is a shared-credential write: nobody's shelf.
  if (args.createdBy === null) {
    throw personalShelfRefusal("shared_credential");
  }
  const containerId = await findPersonalContainerId(args.createdBy);
  if (containerId === null) {
    throw personalShelfRefusal("no_container");
  }
  return containerId;
}
