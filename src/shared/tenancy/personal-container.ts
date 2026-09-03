import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";

/**
 * THE PERSONAL CONTAINER — one `kind='personal'` workspace per user, and the
 * one place the personal shelf's ADDRESS is decided (Samuel's rulings B10 + #18,
 * `supabase/migrations/20260920120000_workspace_kind_personal.sql`).
 *
 * 🔒 **THE SHELF IS A TENANCY NOW, AND THE `WHERE` IS GONE (2026-09-02, slice
 * B15).** Until `20260923120000_drop_home_scoped.sql` a personal row was
 * `home_scoped = true` inside whichever standard workspace a lookup called "the
 * default"; the column is dropped and it is an ordinary row in a container the
 * user owns and is the only member of. That is what lets a personal template or
 * KB be used from ANY container the user is in — the id resolves its own
 * container (`resolve-resource.ts`) and sharing it is a GRANT, not a copy.
 *
 * ── ⚠ WHAT THIS MODULE LOST, AND WHY THE LOSS IS THE POINT ────────────────
 *
 * It carried a 2x2 over (containers minted?) x (`TENANCY_PERSONAL_CONTAINER`
 * on?) and a UNION read that had to find personal rows in EITHER place, because
 * the migration and the deploy moved independently. **`home_scoped` was what
 * made the union possible and also what made it necessary**: every personal row
 * carried the boolean wherever it lived, so one predicate found all of them.
 * With the column dropped there is exactly one place a personal row can be, so
 * the union, the flag and the fallback all go — and the flag's absence is a
 * PRECONDITION on the migration, not a simplification of it:
 *
 * > 🔒 **`20260923120000` MAY ONLY BE APPLIED AFTER `TENANCY_PERSONAL_CONTAINER`
 * > HAS BEEN ON FOR A FULL RELEASE**, so that every personal row written since
 * > `20260920120000`'s one-time move already sits in a container. The migration's
 * > header states this and its `DO $$` block RAISEs rather than trusting it.
 *
 * ⚠ **THE FALLBACK IS GONE IN BOTH DIRECTIONS, DELIBERATELY.** The old write
 * path fell back to the given `workspaceId` whenever anything was missing — the
 * flag off, the author unknown, the container not minted. Every one of those
 * fallbacks now writes a row that NOTHING can find: there is no marker left to
 * distinguish it from a workspace-shelf row, so a personal create with no
 * container REFUSES ({@link PersonalContainerMissingError}) rather than landing
 * somewhere the surface that asked for it will never list.
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
 * 🔒 **THE PERSONAL-SHELF FENCE, AND IT IS THE ONLY ONE LEFT.**
 *
 * ⚠ **IT REPLACES `resolveHomeScope` AND `resolveTemplateHomeScope`, BOTH
 * DELETED (2026-09-02, slice B15).** Those were two hand-mirrored copies of one
 * three-condition fence — a PERSON's credential, a PRIVATE row, and the caller's
 * own DEFAULT STANDARD WORKSPACE — and each condition died for its own reason:
 *
 *   1. **A PERSON asked** — kept, and it is the whole of this error's first
 *      cause. A credential that may be passed between humans stands for nobody
 *      in particular, so there is no "my container" to point it at.
 *   2. **PRIVATE** — moot. It existed because a `public` row on a shelf inside a
 *      SHARED workspace was readable by every member on a surface no member
 *      navigates to. A personal container has exactly one member, so its
 *      audience is the same either way.
 *   3. **THE CALLER'S OWN DEFAULT STANDARD WORKSPACE** — gone with the concept
 *      (ruling B10). The container is the caller's by construction: it is looked
 *      up BY OWNER, so there is no second workspace to confuse it with and no
 *      derived-default lookup to keep in step with `POST /api/boot`. ⚠ The old
 *      condition NAMED that lookup; this docblock may not, because the case
 *      below bans the name from this module in either half of the file.
 *
 * ⚠ **REFUSE, NEVER DOWNGRADE** — unchanged: both features answered 403 and
 * neither silently created on the other shelf.
 *
 * ⚠ **ONE CLASS, ONE WIRE CODE, WHERE THERE WERE TWO.**
 * `HomeScopeForbiddenError` / `TEMPLATE_HOME_SCOPE_FORBIDDEN` were a pair of
 * hand-mirrors over a pair of hand-mirrored fences, and both are deleted with
 * them. It extends `HttpError`, so `shared/api/http-error-response.ts`'s
 * pass-through carries it at EVERY boundary with no per-feature mapping arm —
 * which is the whole reason there is nothing left to keep in step.
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
 * ⚠ Reads the caller off `caller-scope.ts`'s AsyncLocalStorage for the same
 * reason `readClient()` does: the repositories take no context argument, and
 * threading one would be a 406-site edit. A read OUTSIDE a request (cron,
 * ingestion, a script) finds no scope and gets `null`, which is the correct
 * answer for a system path — it has no personal shelf either.
 */
async function callerPersonalContainerId(): Promise<string | null> {
  const scope = getCallerScope();
  if (scope === null || scope.sharedCredential) return null;
  return findPersonalContainerId(scope.userId);
}

/** Where a shelf-scoped read looks, resolved once per query. */
export interface ShelfScope {
  /** ⚠ STILL AN `IN` LIST, though every case now has exactly one element (or
   *  none): the repositories apply it with `.in()` and a shape change here would
   *  be a two-feature edit for no gain. An EMPTY list is the fail-safe read — a
   *  caller with no personal container has no personal rows. */
  workspaceIds: string[];
}

/**
 * WHERE `shelf` lives for this caller.
 *
 * ⚠ **THE `homeScoped` HALF OF THIS ANSWER IS GONE (slice B15)** along with the
 * column it named, so `shelf="workspace"` and an ABSENT shelf are now the SAME
 * scope — the container the call is in. They stay two spellings because they are
 * two questions: absent means "no filter was asked for" and `workspace` means
 * "the shared shelf, explicitly", and a caller that has to be told they are the
 * same answer has learned something that will stop being true if a third shelf
 * ever exists.
 */
export async function resolveShelfScope(
  workspaceId: string,
  shelf: PersonalShelf | undefined
): Promise<ShelfScope> {
  if (shelf !== "home") return { workspaceIds: [workspaceId] };
  const containerId = await callerPersonalContainerId();
  // ⚠ EMPTY, NOT `[workspaceId]`. Falling back to the calling workspace would
  // answer a request for the personal shelf with the SHARED one's rows, which is
  // the widening direction — and it is what the `home_scoped` filter used to
  // stop from happening by accident.
  return { workspaceIds: containerId === null ? [] : [containerId] };
}

/** The two fields of an insert this decision reads. ⚠ Both features' insert
 *  args already have exactly these, which is why one call serves both. */
export interface ShelfBoundInsert {
  workspaceId: string;
  /** `false`/absent = the workspace shelf — the container the call is in. */
  homeScoped?: boolean;
  createdBy: string | null;
}

/**
 * 🔒 WHERE AN INSERT LANDS, and the fence that refuses rather than guessing.
 *
 * ⚠ **`homeScoped` IS A ROUTING FLAG NOW, NOT A COLUMN.** It used to be written
 * onto the row beside a `workspace_id` the flag might or might not have moved;
 * it decides the `workspace_id` and nothing else, and nothing stores it.
 *
 * ⚠ KEYED ON THE ROW'S AUTHOR, NOT ON THE AMBIENT CALLER. Taking the author
 * makes the write path independent of the request store, so a seed, a script or
 * a test writes the same row a request does — and for a personal write the two
 * are the same person by construction, because only a person can ask for one.
 */
export async function personalWriteWorkspaceId(
  args: ShelfBoundInsert
): Promise<string> {
  if (args.homeScoped !== true) return args.workspaceId;
  if (args.createdBy === null) {
    throw new PersonalContainerMissingError(
      "a shared credential has no personal shelf"
    );
  }
  const containerId = await findPersonalContainerId(args.createdBy);
  if (containerId === null) {
    throw new PersonalContainerMissingError(
      "your personal container has not been created yet"
    );
  }
  return containerId;
}
