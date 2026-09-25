import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";
import {
  resolveHomeSpaceReach,
  type HomeSpaceReachRefusal,
} from "./home-space-reach";

/**
 * The home space: one `kind='home'` workspace per user, and the one place a personal
 * row's address is decided. Its id resolves its own container (`resolve-resource.ts`); sharing is a grant.
 * No fallback: a personal create with no container refuses ({@link HomeSpaceMissingError})
 * rather than landing where the home shelf never lists it.
 * Not a visibility gate: who may read a row is still `canSeeBase` / `canSeeIdentity` + RLS twins.
 */

/** Structurally identical to `KbShelf` and `IdentityShelf`, which assign here. */
export type HomeSpaceShelf = "home" | "workspace";

/**
 * The home-shelf refusal: 403, refuse never downgrade (no silent create on the other shelf).
 * Extends `HttpError`, so `shared/api/http-error-response.ts` passes it through at every boundary.
 */
export class HomeSpaceMissingError extends HttpError {
  constructor(reason: string) {
    super(
      403,
      "HOME_SPACE_MISSING",
      `This cannot be created on your home shelf — ${reason}.`
    );
    this.name = "HomeSpaceMissingError";
  }
}

/**
 * One refusal sentence per reason, shared by {@link homeSpaceWriteWorkspaceId} and the knowledge and
 * agent-identity write gates so the copies cannot drift. Write paths only, shown only to the owner: on a
 * read, an unreachable shelf must answer what an empty one answers, or reach becomes an oracle.
 */
export function homeSpaceShelfRefusal(
  refusal: HomeSpaceReachRefusal
): HomeSpaceMissingError {
  switch (refusal) {
    case "shared_credential":
      return new HomeSpaceMissingError(
        "a shared credential has no home shelf"
      );
    case "no_container":
      return new HomeSpaceMissingError(
        "your home space has not been created yet"
      );
    case "unarmed_room":
      return new HomeSpaceMissingError(
        "this channel is not armed for your home shelf. Arming it is a " +
          "human-only act, taken by its owner in the channel's Personal section"
      );
  }
}

/**
 * The user's home space id, or `null` if none exists yet. Service role on purpose: it answers
 * "where is my shelf" for an already-proven user id; `workspaces_home_owner_uidx` makes it one row.
 * Uncached on purpose: a cache would outlive a rollback that deletes the containers.
 */
export async function findHomeSpaceId(
  userId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .eq("kind", "home")
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * The current request's home space, read off `caller-scope.ts`'s AsyncLocalStorage because
 * the repositories take no context. Outside a request (cron, script) there is no scope: `null`.
 */
async function callerHomeSpaceId(
  callingWorkspaceId: string
): Promise<string | null> {
  const scope = getCallerScope();
  if (scope === null || scope.sharedCredential) return null;
  // `home-space-reach.ts` is the one fence both shelf reads ask.
  const reach = await resolveHomeSpaceReach({
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
  /** Applied with `.in()`. Empty is the fail-safe read: no home space, no personal rows. */
  workspaceIds: string[];
}

/** Where `shelf` lives for this caller: `workspace` = the calling container, `home` = the caller's
 *  home space, absent = both. */
export async function resolveShelfScope(
  workspaceId: string,
  shelf: HomeSpaceShelf | undefined
): Promise<ShelfScope> {
  if (shelf === "workspace") return { workspaceIds: [workspaceId] };
  const containerId = await callerHomeSpaceId(workspaceId);
  if (shelf === "home") {
    // Empty, never `[workspaceId]`: that would answer the home shelf with shared rows. Also the
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
  /** A routing flag, not a column: `true` = the author's home space, else `workspaceId`. */
  homeScoped?: boolean;
  createdBy: string | null;
}

/**
 * Where an insert lands; refuses rather than guessing. Keyed on the row's author, not the ambient
 * caller, so seeds and scripts land rows where a request would.
 */
export async function homeSpaceWriteWorkspaceId(
  args: ShelfBoundInsert
): Promise<string> {
  if (args.homeScoped !== true) return args.workspaceId;
  // A null author is a shared-credential write: nobody's shelf.
  if (args.createdBy === null) {
    throw homeSpaceShelfRefusal("shared_credential");
  }
  const containerId = await findHomeSpaceId(args.createdBy);
  if (containerId === null) {
    throw homeSpaceShelfRefusal("no_container");
  }
  return containerId;
}
