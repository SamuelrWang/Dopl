import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";

/**
 * THE PERSONAL CONTAINER — one `kind='personal'` workspace per user, and the
 * one place the personal shelf's ADDRESS is decided (Samuel's ruling B10 + #18,
 * `supabase/migrations/20260920120000_workspace_kind_personal.sql`).
 *
 * 🔒 **THE SHELF STOPS BEING A `WHERE` AND BECOMES A TENANCY.** Today a personal
 * row is `home_scoped = true` inside whichever standard workspace a lookup
 * called "the default"; after B11 it is an ordinary row in a container the user
 * owns and is the only member of. That is what lets a personal template or KB be
 * used from ANY container the user is in — the id resolves its own container
 * (`resolve-resource.ts`) and sharing it is a GRANT, not a copy.
 *
 * ── ⚠ THE 2x2 THIS MODULE EXISTS TO MAKE SAFE ─────────────────────────────
 *
 * The migration and the deploy move independently, so all four combinations of
 * (containers minted?) x ({@link TENANCY_PERSONAL_CONTAINER_ENV} on?) happen for
 * real, and **each one must read back every row the others wrote**:
 *
 * | minted | flag | personal shelf reads            | a personal write lands in |
 * |--------|------|---------------------------------|---------------------------|
 * | no     | any  | `W` + `home_scoped`             | `W` (today, unchanged)    |
 * | yes    | off  | `W` **or** `C`, + `home_scoped` | `W` (today, unchanged)    |
 * | yes    | on   | `C`                             | `C`                       |
 *
 * ⚠ **THE FLAG-OFF READ IS THE DUAL ONE, AND THAT ASYMMETRY IS THE ROLLBACK.**
 * Flipping the flag ON is safe because the migration already moved the existing
 * rows into `C`; flipping it back OFF is safe because the off read still looks
 * in `C`. A row written during the ON window is therefore never stranded — which
 * is what "rollback fails CLOSED, never open" means here. It never widens
 * either: both off arms keep `home_scoped`, and `C` has exactly one member at
 * every moment in both directions.
 *
 * ⚠ **THE WORKSPACE SHELF DOES NOT MOVE IN THIS SLICE.** `shelf="workspace"`
 * keeps its `home_scoped = false` filter under both flag states, and an ABSENT
 * shelf keeps meaning "everything in `W`, no filter". A row that has not been
 * migrated yet must not surface on the shared shelf just because the flag went
 * on, and the redundant-once-migrated predicate costs one indexed boolean.
 *
 * ⚠ **NOT A VISIBILITY GATE.** This module answers WHERE a row lives. Who may
 * read it is still `canSeeBase` / `canSeeTemplate` and their RLS twins, applied
 * by the service layer exactly as before — the same separation
 * `service-shelf.test.ts › does NOT become a visibility gate` pins.
 */

/** The two shelves, structurally identical to `KbShelf` and `TemplateShelf` —
 *  each feature keeps its own spelling (INVARIANTS §10) and both assign here. */
export type PersonalShelf = "home" | "workspace";

/**
 * ⚠ OPT-IN, AND THE ABSENT VALUE IS THE SAFE ONE — the same shape as
 * `caller-client.ts › RLS_CALLER_SCOPED_READS_ENV`, deliberately, because a
 * second spelling of "is this flag on" is how two flags come to disagree.
 */
export const TENANCY_PERSONAL_CONTAINER_ENV = "TENANCY_PERSONAL_CONTAINER";

const ON_VALUES = new Set(["1", "true", "on"]);

/** ⚠ Read PER CALL, never captured at module load — flipping the flag must need
 *  no redeploy. */
export function personalContainerReadsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[TENANCY_PERSONAL_CONTAINER_ENV];
  if (typeof raw !== "string") return false;
  return ON_VALUES.has(raw.trim().toLowerCase());
}

/**
 * The user's personal container, or `null` when the migration has not run.
 *
 * ⚠ SYSTEM READ, service role on purpose, and NOT a leak: it answers "where is
 * MY shelf" for a user id the caller has already been proven to be, and returns
 * an id the caller owns. One indexed lookup —
 * `workspaces_personal_owner_uidx` is unique on `(owner_id) WHERE
 * kind='personal'` — so `maybeSingle()` is the query, not a `.limit(1)` over an
 * ordered scan.
 *
 * ⚠ DELIBERATELY UNCACHED. The id is immutable once minted, so a cache would be
 * correct and it would also outlive a rollback that deletes the containers,
 * pointing every personal read at a row that is gone. One index probe on the
 * paths that name a shelf is the cheaper mistake.
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
 * The CURRENT request's personal container.
 *
 * 🔒 **A SHARED CREDENTIAL HAS NO PERSONAL SHELF** — arm 1 of both
 * `resolveHomeScope` fences, restated rather than re-decided. A credential that
 * may be passed between humans stands for nobody in particular, so there is no
 * "my container" for it to be pointed at.
 *
 * ⚠ Reads the caller off `caller-scope.ts`'s AsyncLocalStorage for the same
 * reason `readClient()` does: the repositories take no context argument, and
 * threading one would be a 406-site edit landing in the same change as the first
 * moved row. A read OUTSIDE a request (cron, ingestion, a script) finds no scope
 * and gets `null`, which is today's behaviour — the correct answer for a system
 * path, which has no personal shelf either.
 */
async function callerPersonalContainerId(): Promise<string | null> {
  const scope = getCallerScope();
  if (scope === null || scope.sharedCredential) return null;
  return findPersonalContainerId(scope.userId);
}

/** Where a shelf-scoped read looks, resolved once per query. */
export interface ShelfScope {
  /** ⚠ ALWAYS an `IN` list, never an `eq`: the flag-off personal read spans two
   *  containers and every other case is the same shape with one element. */
  workspaceIds: string[];
  /** `home_scoped` to require, or `undefined` to apply no shelf filter. */
  homeScoped: boolean | undefined;
}

/**
 * WHERE `shelf` lives for this caller — the whole of the 2x2 in the module
 * header, decided once and applied by each query in two lines (a PostgREST
 * builder is generic over its table, so the DECISION is shared and the
 * application is not).
 */
export async function resolveShelfScope(
  workspaceId: string,
  shelf: PersonalShelf | undefined
): Promise<ShelfScope> {
  if (shelf === undefined) return { workspaceIds: [workspaceId], homeScoped: undefined };
  if (shelf === "workspace") return { workspaceIds: [workspaceId], homeScoped: false };

  const containerId = await callerPersonalContainerId();
  if (containerId === null) return { workspaceIds: [workspaceId], homeScoped: true };
  if (personalContainerReadsEnabled()) {
    return { workspaceIds: [containerId], homeScoped: undefined };
  }
  return { workspaceIds: [workspaceId, containerId], homeScoped: true };
}

/** The three fields of an insert this decision reads. ⚠ Both features' insert
 *  args already have exactly these, which is why one call serves both. */
export interface ShelfBoundInsert {
  workspaceId: string;
  /** `false`/absent = the workspace shelf, matching both DB column defaults. */
  homeScoped?: boolean;
  createdBy: string | null;
}

/**
 * WHERE an INSERT lands — the dual-write's other half. The row still carries
 * `home_scoped` exactly as it does today; what the flag moves is the
 * `workspace_id` beside it, and only for a personal one.
 *
 * ⚠ KEYED ON THE ROW'S AUTHOR, NOT ON THE AMBIENT CALLER, and the two are the
 * same person by construction: a personal write only reaches here through
 * `resolveHomeScope`, whose first condition is that a PERSON asked. Taking the
 * author makes the write path independent of the request store, so a seed, a
 * script or a test writes the same row a request does.
 *
 * ⚠ FALLS BACK TO THE GIVEN `workspaceId` whenever anything is missing — the
 * flag is off, the row is not personal, the author is unknown, or the container
 * is not minted yet — so a deploy landing ahead of the migration writes exactly
 * what it writes today.
 */
export async function personalWriteWorkspaceId(
  args: ShelfBoundInsert
): Promise<string> {
  if (args.homeScoped !== true) return args.workspaceId;
  if (args.createdBy === null || !personalContainerReadsEnabled()) {
    return args.workspaceId;
  }
  return (await findPersonalContainerId(args.createdBy)) ?? args.workspaceId;
}
