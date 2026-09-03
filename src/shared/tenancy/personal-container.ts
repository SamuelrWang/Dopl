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
 * | yes    | any  | `W` **or** `C`, + `home_scoped` | off → `W`; on → `C`       |
 *
 * 🔒 **THE READ DOES NOT BRANCH ON THE FLAG AT ALL, AND THAT IS THE FIX FOR
 * F-590.** It used to: flag ON read `C` ALONE. The migration and the flag move
 * independently, so **there is a window — containers minted, flag still off — in
 * which every new personal row lands in `W`**, and the one-time move in
 * `20260920120000` §5 has already run and never runs again. Flipping the flag ON
 * then HID every row written in that window: no error, no log, a shelf that
 * silently lost the last N days of work, and no reader anywhere that could
 * notice.
 *
 * ⚠ **THE UNION IS CORRECT IN EVERY CELL, WHICH IS WHY THE BRANCH WENT RATHER
 * THAN GAINING A THIRD ARM.** `home_scoped` is not cleared by the move — the
 * migration says so in as many words (*"the column still carries the truth"*)
 * and the write path never touches it — so **every personal row carries
 * `home_scoped = true` wherever it lives**, and one predicate finds all of them.
 * The alternative was re-running the move at flip time, which is a migration
 * that has to be scheduled against a flag flip; this is a `WHERE … IN (…)` with
 * one extra element.
 *
 * ⚠ **IT DOES NOT WIDEN.** Both arms keep `home_scoped`, `C` has exactly one
 * member at every moment, and a `home_scoped` row of ANOTHER member sitting in
 * `W` is still refused by `canSeeBase` / `canSeeTemplate` — this module answers
 * WHERE, never WHO.
 *
 * ⚠ **SO THE FLAG NOW MOVES WRITES ONLY** ({@link personalContainerWritesEnabled}),
 * and the rollback property it was named for is unchanged and now symmetric:
 * what ON writes, OFF reads, and what OFF writes, ON reads.
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

/**
 * Does a personal WRITE land in the container?
 *
 * ⚠ Read PER CALL, never captured at module load — flipping the flag must need
 * no redeploy.
 * ⚠ **NAMED FOR WRITES SINCE 2026-09-02 (F-590)**, because that is now the only
 * thing it decides: the personal READ is the union under both flag states, so a
 * row written in the migrated-but-flag-off window is not stranded by the flip.
 * The ENV VAR is unchanged — it is a deploy contract.
 */
export function personalContainerWritesEnabled(
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

  // ⚠ THE FLAG IS NOT ASKED HERE (F-590) — see the module header's table. Both
  // places a personal row can be carry `home_scoped = true`, so one predicate
  // over both containers finds every one of them under either flag state.
  const containerId = await callerPersonalContainerId();
  if (containerId === null) return { workspaceIds: [workspaceId], homeScoped: true };
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
  if (args.createdBy === null || !personalContainerWritesEnabled()) {
    return args.workspaceId;
  }
  return (await findPersonalContainerId(args.createdBy)) ?? args.workspaceId;
}
