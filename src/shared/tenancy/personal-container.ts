import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";
import {
  resolvePersonalReach,
  type PersonalReachRefusal,
} from "./personal-reach";

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
 * 🔒 **ONE REFUSAL SENTENCE PER REASON, AND ONE PLACE IT IS WRITTEN** — the
 * argument `service-base-gates.ts › personalShelfUnreachableInRoom` makes for
 * its own message, applied to the reason half: *two copies of a refusal is two
 * refusals that stop agreeing about the remedy.*
 *
 * ⚠ **IT EXISTS BECAUSE THERE ARE THREE CALLERS NOW, NOT TWO.** The router
 * below throws two of these inline, `knowledge/server/service-base-gates.ts ›
 * resolveCreateDestination` mapped all three by hand, and the AGENT-TEMPLATES
 * twin (`agent-templates/server/service-write-gates.ts`) is the third. Three
 * hand-mirrored copies of a tenancy sentence is the shape that produced the
 * divergent shelf fence this module's header retires by name.
 *
 * ⚠ **DIAGNOSTIC-TO-THE-OWNER ONLY, AND ONLY ON A WRITE.** `unarmed_room` names
 * the remedy, which is safe here for the reason `resolveCreateDestination`
 * states: a WRITE has no silent form, and the only person who learns anything is
 * the OWNER, about their OWN shelf in their OWN room. ⚠ It must never be
 * rendered on a READ path — there, an unarmed room answers what an empty one
 * answers, or arming state becomes the oracle `personal-reach.ts` closes.
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
async function callerPersonalContainerId(
  callingWorkspaceId: string
): Promise<string | null> {
  const scope = getCallerScope();
  if (scope === null || scope.sharedCredential) return null;
  // 🔒 TASK 11: THE SHELF IS NOW REACHABLE OR NOT, AND THIS IS WHERE BOTH SHELF
  // READS ASK. `personal-reach.ts` is the one fence (#1077 clause (a), approved
  // #1080): a person always reaches their own shelf, an agent in a shared room
  // reaches it only once that room is armed.
  //
  // ⚠ **THE PROXY IS GONE (task 11 continuation).** This read used to infer
  // "agent" from the credential being CONTAINER-LOCKED, because `CallerScope`
  // carried no `source` — true only while `issueContainerToken` was the sole
  // minter of a lock, and a fact about the LOCK axis standing in for a fact
  // about the ASKER (the F-336 shape). `with-auth-scope.ts` now states it beside
  // `sharedCredential`, off the credential FAMILY the wrapper already
  // discriminated, so this reads the fact rather than deriving it.
  const reach = await resolvePersonalReach({
    userId: scope.userId,
    credentialSubjectUserId: scope.userId,
    // ⚠ THE ROOM IS THE LOCK WHERE THERE IS ONE. An agent credential is fenced
    // to the container it acts in, and that DB fact is the room half of
    // (room, owner); an unlocked session is standing in the container it named.
    workspaceId: scope.credentialWorkspaceId ?? callingWorkspaceId,
    source: scope.source,
  });
  return reach.kind === "open" ? reach.containerId : null;
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
  if (shelf === "workspace") return { workspaceIds: [workspaceId] };
  const containerId = await callerPersonalContainerId(workspaceId);
  if (shelf === "home") {
    // ⚠ EMPTY, NOT `[workspaceId]`. Falling back to the calling workspace would
    // answer a request for the personal shelf with the SHARED one's rows, which
    // is the widening direction — and it is what the `home_scoped` filter used
    // to stop from happening by accident. ⚠ It is also the answer when the
    // shelf is OUT OF REACH (an unarmed shared room): no rows, never a refusal,
    // so arming state is not an oracle.
    return { workspaceIds: containerId === null ? [] : [containerId] };
  }
  // 🔒 **GAP 1 OF #1077 — AN UNFILTERED READ NOW SEES BOTH SHELVES.**
  // Enumeration was container-scoped while RESOLUTION already crossed
  // containers, so an operator could read a personal base from another room if
  // they knew its id and could not FIND it from there. That is the "my builder
  // agent's KB is invisible everywhere else" report, and it was a LISTING
  // failure, not a permission one. Every enumerating surface asks through this
  // function, so adding the caller's own container here is the whole fix — the
  // rows are labelled personal by `listHomeScopedBaseIds`, which asks this same
  // function for the same set, so the label cannot disagree with the list.
  //
  // ⚠ **NOT A RE-GROWN DEFAULT-WORKSPACE FALLBACK** (MCP-2, invariant 1 of
  // #1077). Nothing is guessed and no call lands somewhere it did not name: the
  // calling container is read as it always was, and the caller's OWN container
  // is read IN ADDITION, by owner. Deleting this as a fallback would restore the
  // defect it repairs.
  return containerId === null || containerId === workspaceId
    ? { workspaceIds: [workspaceId] }
    : { workspaceIds: [workspaceId, containerId] };
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
  // ⚠ THE SAME TWO SENTENCES THE GATES THROW, from the one place they are
  // written ({@link personalShelfRefusal}) — a caller that hits the ROUTER's
  // copy of a refusal must not read differently from one the gate turned away.
  if (args.createdBy === null) {
    throw personalShelfRefusal("shared_credential");
  }
  const containerId = await findPersonalContainerId(args.createdBy);
  if (containerId === null) {
    throw personalShelfRefusal("no_container");
  }
  return containerId;
}
