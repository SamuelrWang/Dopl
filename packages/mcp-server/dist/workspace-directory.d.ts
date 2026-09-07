/**
 * workspace-directory.ts — the session's view of WHICH containers exist and
 * which one a call lands in: membership caching, slug→id resolution, the
 * container lock, and the search fan-out's leg list.
 *
 * ⚠ **THERE IS NO DEFAULT WORKSPACE HERE ANY MORE** (B10/B13). It held the
 * "you belong to N workspaces, name one" refusal and the sole-membership
 * auto-target; both are gone, and the server resolves the caller's own
 * container when a call names none. A blank `workspace=` is still rejected by
 * the caller in `registrar.ts` — fail-closed on an argument that was PASSED is
 * a different question from guessing one that was not.
 *
 * ⚠ A FAILED boot directory load does not seed the cache, so the first
 * resolution retries instead of serving a bogus empty list for a full TTL.
 */
import type { DoplClient, WorkspaceKind, WorkspaceListItem, WorkspaceRole } from "@dopl/client";
/**
 * The container this CONNECTION is bound to, resolved once at boot from
 * `X-Workspace-Id`. Read by `appendDoplStatus`. ⚠ Null is ORDINARY and is not a
 * refusal: an unbound connection names no container and the server answers with
 * the caller's own.
 */
export interface ActiveWorkspaceState {
    id: string;
    slug: string;
    name: string;
    role: WorkspaceRole;
}
/**
 * How the container a call hit was chosen — surfaced verbatim in the
 * `_dopl_status` footer so the agent can confirm targeting.
 *
 * ⚠ **TWO LABELS SINCE B13, AND BOTH ARE EXPLICIT ADDRESSING.** `sole
 * membership` (the auto-target) and `session pin` (`current_workspace(op=
 * "set")`) are deleted: neither was a thing the caller said on this call, and
 * B10 removes the default-workspace concept they both implemented. A footer
 * that cannot say WHO chose the target is a footer an agent cannot debug from.
 */
export type WorkspaceSource = "per-call arg" | "header pin";
export interface EffectiveWorkspace extends ActiveWorkspaceState {
    source: WorkspaceSource;
}
/** The boot-resolved directory state this module is constructed from. */
export interface WorkspaceDirectoryOptions {
    /**
     * Caller's full active-membership directory from the boot `listWorkspaces()`.
     * Seeds the cache so per-call `workspace=` needs no extra loopback.
     */
    directory?: WorkspaceListItem[];
    /**
     * ⚠ True when the boot `listWorkspaces()` FAILED, as opposed to a genuine
     * empty directory: steers the copy to "couldn't load — retry", and suppresses
     * seeding a bogus empty cache so a later resolution retries.
     */
    directoryLoadFailed?: boolean;
    /**
     * 🔒 THE CONTAINER LOCK (plan §4.4 B3). When set, this session may see and
     * address exactly ONE workspace: this one. `getWorkspaceList()` answers
     * `[lockedTo]` and `resolveWorkspaceRef` answers `null` for every other ref,
     * whatever the cache holds.
     *
     * Set by `factory.ts › bootServer` when the session's pin resolves to a
     * `kind='link'` container with MORE THAN ONE active member — i.e. an agent
     * working in a room a PEER is also in. Its operator's other workspaces are
     * not that peer's business, and neither is their existence.
     *
     * ⚠ IT IS A TRIPWIRE, NOT A FENCE, AND THE DIFFERENCE MUST NOT BE DRESSED
     * AWAY. It narrows what THIS MCP connection will do. A `full`-profile session
     * has Bash and the operator's 90-day device token is on disk, so the same
     * agent can open a SECOND MCP connection with no pin, or issue the loopback
     * HTTP itself, and this object will never see either. What actually refuses
     * those is the credential lock (the token is workspace-scoped, so
     * `with-workspace-auth.ts` 403s a contradicting target) and the audience
     * ceiling in `knowledge/server/service-audience.ts`, both of which live in the
     * server that owns the rows. This lock exists so a WELL-BEHAVED agent is never
     * even shown the door — which is worth having, and is not the same as the door
     * being locked.
     */
    lockedTo?: WorkspaceListItem | null;
}
export interface WorkspaceDirectory {
    /**
     * Every container the caller is an active member of, cached for
     * {@link WORKSPACE_CACHE_TTL_MS}.
     *
     * ⚠ **IT NO LONGER FILTERS THROUGH `isStandardWorkspace`** (B10). "All
     * workspaces are just normal workspaces": a home-channel container is one
     * more container the caller is in, and hiding it here is what made it
     * unaddressable without a second tool. The KIND is RENDERED by every surface
     * that lists these rows — a container is still never called a workspace.
     */
    getWorkspaceList(): Promise<WorkspaceListItem[]>;
    /** A slug-or-UUID `workspace=` ref resolved against every membership. */
    resolveWorkspaceRef(ref: string): Promise<WorkspaceListItem | null>;
    /**
     * 🔒 THE LOCK, READABLE — the container id this session is narrowed to, or
     * null when it is not locked.
     *
     * ⚠ EXPOSED BECAUSE THE LOCK NOW HAS A CONSUMER THIS OBJECT CANNOT SERVE
     * (2026-08-28). `getWorkspaceList` narrows the CONTAINER directory; the
     * account-wide CHANNEL reads narrow rows that come from
     * `/api/channels/account/**` and never pass through here. Without this, each
     * would restate the rule — and a restated fence is the one that
     * drifts. ⚠ There is exactly ONE reader, {@link narrowToLock} below; add a
     * second only by routing it through that.
     */
    lockedWorkspaceId(): string | null;
}
export declare function createWorkspaceDirectory(client: DoplClient, options?: WorkspaceDirectoryOptions): WorkspaceDirectory;
/**
 * 🔒 **WHAT KIND OF CONTAINER THIS ROW IS, ASKED POSITIVELY AND IN ONE PLACE**
 * (F-564).
 *
 * ⚠ **IT IS A `switch` ON `kind`, NOT `!isStandardWorkspace(…)`.** That
 * predicate answers "does this belong in the rail"; its NEGATION was read as
 * "therefore a home channel" at four sites in this package, which was correct
 * by accident while `standard` and `link` were the only kinds and stops being
 * correct the moment `20260920120000` mints a `personal` container for every
 * user at once. A `default` arm that says "workspace" also fails safe for a
 * kind added later: an unknown container is not silently advertised as somebody
 * else's room.
 *
 * ⚠ **RENDERED, NEVER INFERRED BY THE READER.** A container and a workspace are
 * different things to the operator, and every surface that lists these rows
 * prints this label — which is what lets `getWorkspaceList()` stop hiding
 * containers (B10) without ever calling one a workspace.
 */
export type ContainerKind = "workspace" | "home channel" | "personal";
/**
 * How a kind is RENDERED in a directory row. The personal container is the one
 * an agent keeps mistaking for a workspace (Samuel, 2026-09-06: "Samuel's
 * Workspace" read as the home space, and the home space read as a workspace),
 * so its label says what it serves as, in words that cannot be read as a
 * second workspace: it is the caller's default, and it is not a workspace.
 */
export declare function containerKindLabel(kind: ContainerKind): string;
export declare function containerKind(row: {
    kind?: WorkspaceKind;
}): ContainerKind;
/**
 * 🔒 THE LOCK, APPLIED — and the ONLY reader of
 * {@link WorkspaceDirectory.lockedWorkspaceId} outside this module.
 *
 * ⚠ **GENERIC OVER ANYTHING CARRYING A `workspaceId`, ON PURPOSE.** The
 * account-wide channel reads (T20/T21/T22) need exactly this narrowing over a
 * different row: `GET /api/channels/account/**` is `withUserAuth` and answers
 * the WHOLE ACCOUNT, so the route cannot narrow and the directory those rows
 * never pass through cannot either. The alternative was a second reader of the
 * lock, and a second reader IS the enumeration oracle B3 exists to deny.
 * **Widening the parameter is how a second caller routes THROUGH this instead
 * of around it.**
 *
 * ⚠ It narrows on the SAME id `getWorkspaceList` answers with — one lock, one
 * identity, no second notion of "which room am I in". Unlocked ⇒ unchanged.
 *
 * ⚠ AND IT IS A TRIPWIRE, NOT A FENCE. Bash can open a second unpinned MCP
 * connection, or issue the loopback HTTP directly, and neither passes through
 * this module. What refuses cross-container reads is the container-locked
 * credential and the audience ceiling in
 * `src/features/knowledge/server/service-audience.ts`.
 */
export declare function narrowToLock<T extends {
    workspaceId: string;
}>(rows: T[], directory: WorkspaceDirectory): T[];
/**
 * ONE SCOPE the `dopl_search(scope="everywhere")` fan-out searches.
 *
 * ⚠ `kind` IS RENDERED, NOT INFERRED BY THE READER — see {@link containerKind}.
 */
export interface SearchLeg {
    /** The workspace id every per-leg request runs against. */
    id: string;
    /** Neutralized display name — a VALUE, spliced into a heading we wrote. */
    label: string;
    kind: ContainerKind;
    /** Slug, for a standard workspace only — a container's is not advertised. */
    slug?: string;
}
/**
 * THE LEG LIST: every container the caller is in.
 *
 * 🔒 **ONE NARROWED SOURCE, AND SINCE B10 IT IS THE ONLY ONE.** It used to be
 * two — the standard-workspace directory plus a second `GET /api/home/channels`
 * read, de-duped by id, with its own failure mode and its own "your home
 * channels could not be read" footnote. `getWorkspaceList()` answers for both
 * halves now that containers are no longer filtered out of it, so a locked
 * session searches exactly one scope, nothing can be searched twice, and there
 * is no second read to fail.
 */
export declare function searchLegs(directory: WorkspaceDirectory): Promise<SearchLeg[]>;
