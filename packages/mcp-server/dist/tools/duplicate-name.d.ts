/**
 * 🔒 **THE DUPLICATE-NAME WARNING, WORDED ONCE FOR ALL THREE CREATE LANES**
 * (Samuel's ruling 2026-09-18, fix-list Q3): *"we should recommend to the agent
 * to change to prevent confusion, or if it's a resource that has a description
 * option, then it should clarify in description."*
 *
 * ── WHY IT WARNS AND DOES NOT REFUSE ────────────────────────────────────────
 *
 * The same name in your home space and in a channel is a reasonable thing to
 * want, so a refusal would break a shape the operator already uses. What is NOT
 * reasonable is learning about the collision from a LATER read: a duplicate
 * knowledge-base name mints a duplicate slug, and `dopl-development` answered
 * "0 folders, 0 entries" from an empty shell for ten days while the real base
 * filled up elsewhere (`KB-LOSS-TRACE.md`, F-701). A template collision refuses
 * every name-addressed `get`/`update` from then on
 * (`agent-shared.ts › ambiguousTemplate`).
 *
 * ── THREE RULES THIS FOLLOWS ────────────────────────────────────────────────
 *
 * ⚠ **THE CONTAINER IS NAMED BY ID, NEVER LOOKED UP** — `knowledge-shared.ts ›
 * ambiguousBase`'s rule, for its reason: resolving container NAMES means
 * `client.listWorkspaces()`, which walks straight past the session lock in
 * `workspace-directory.ts › getWorkspaceList`, and a locked session must not
 * learn that other containers exist. The id is also the `container=` handle, so
 * it is the more useful half anyway.
 *
 * ⚠ **IT DISCLOSES NOTHING A LIST WOULD NOT.** Every row it reads came back
 * from this caller's own list call, already filtered server-side — the same
 * argument `ambiguousTemplate` and `ambiguousBase` both make.
 *
 * ⚠ **IT RUNS AFTER THE CREATE AND IT NEVER FAILS ONE.** The row exists; this
 * is a note about it. A list that throws, a client that has no such accessor,
 * and a name that collides with nothing all produce the same empty string — a
 * warning is not worth turning a successful create into an error.
 */
/** The smallest shape all three row types satisfy. */
export interface NamedRow {
    id: string;
    name: string;
    workspaceId: string;
}
/**
 * The warning line, or `""`.
 *
 * ⚠ **CASE-INSENSITIVE, BECAUSE THE RESOLVERS ARE.** `resolveTemplateRef`
 * matches names case-insensitively and a base's slug is folded from its name, so
 * "Notes" and "notes" collide in exactly the way this warns about.
 *
 * @param created   the row this call just made — excluded by id, and its own
 *                  container is what "elsewhere" is measured against.
 * @param all       every row of that kind this caller can see, created included.
 * @param noun      what to call the thing, e.g. `knowledge base`.
 * @param canDescribe whether the resource takes a description the agent could
 *                  use to tell the two apart (Samuel's "or" branch).
 */
export declare function duplicateNameNote(created: NamedRow, all: readonly NamedRow[], noun: string, canDescribe: boolean): string;
/**
 * `duplicateNameNote` over a list call that may throw or may not exist.
 * ⚠ Swallows everything for the reason in this file's header.
 */
export declare function duplicateNameNoteFor(created: NamedRow, list: () => Promise<readonly NamedRow[]>, noun: string, canDescribe: boolean): Promise<string>;
