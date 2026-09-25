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

import type { ContainerKind } from "@dopl/contracts";
import { isLegacyHomeAddress } from "./legacy-aliases.js";
import type {
  DoplClient,
  WorkspaceKind,
  WorkspaceListItem,
  WorkspaceRole,
} from "@dopl/client";

export type { ContainerKind };

/**
 * 🔒 **THE RESERVED CONTAINER ADDRESS** (R-32, Samuel 2026-09-17). `home` is the
 * CALLER'S own `kind='home'` container, resolved per caller — so the same
 * six characters name a different row for every agent that types them, and no
 * agent ever has to be handed an id to reach its own shelf.
 *
 * ⚠ **IT IS A RESERVED WORD AND IT WINS OVER A SLUG.** A standard workspace
 * whose slug is literally `home` is reachable by its id, which is the tradeoff
 * a reserved word always makes; the reverse — a caller's own shelf being
 * shadowed by somebody's workspace name — is the one that cannot be worked
 * around, because the home space's slug is not published anywhere.
 */
export const HOME_ADDRESS = "home";

/**
 * 🔒 **A SLUG THAT NAMES TWO CONTAINERS IS REFUSED, NOT PICKED** (F-719, Samuel
 * 2026-09-17) — the shape `knowledge-shared.ts › resolveBaseRef` already carries.
 *
 * ⚠ **`workspaces.slug` HAS NO UNIQUENESS CONSTRAINT AND IS NOT GETTING ONE.**
 * `20260504000000_workspaces_public_id.sql` dropped it deliberately, because global
 * uniqueness makes one account's workspace name deny another's. R-32 then made a
 * slug an ADDRESS, so a caller can legitimately see two rows spelled the same — a
 * home channel a PEER named, against their own workspace — and `Array.find` picked
 * whichever it reached first, silently. That is F-701 one table over, so it gets
 * F-701's answer: REFUSE and NAME BOTH.
 *
 * ⚠ **AND THE TIE-BREAKS ARE ALL WRONG, WHICH IS WHY THERE IS NONE.** "The bound
 * container wins" is the rule a caller holding a peer's room slug is already
 * violating; "newest wins" acts on an identity the caller did not choose.
 *
 * ⚠ **AN ID CAN NEVER BE AMBIGUOUS** — ids are unique account-wide, which is why
 * the remedy is an id and the by-id arm is untouched.
 */
export interface AmbiguousContainerRef {
  /** Every row the ref matched, id-ordered so a re-read is stable. */
  ambiguous: WorkspaceListItem[];
}

export type ContainerRefResolution = WorkspaceListItem | AmbiguousContainerRef;

/**
 * Does this row answer to `ref`? ⚠ ONE spelling (2026-09-17) — `factory.ts`
 * re-spelled it inline for the `X-Workspace-Id` pin, a fourth copy of the same
 * predicate. A workspace slug can be shaped like a UUID, so BOTH columns are
 * matched on the first pass; id alone forces a wasteful refresh.
 */
export function matchesContainerRef(w: WorkspaceListItem, ref: string): boolean {
  return w.id === ref || w.slug === ref;
}

/** ⚠ The one narrowing. A `ContainerRefResolution` carries no `id`, so the
 *  compiler — not a convention — is what stops a caller reading the refusal as
 *  a container. */
export function isAmbiguousContainer(
  resolved: ContainerRefResolution,
): resolved is AmbiguousContainerRef {
  return "ambiguous" in resolved;
}

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
  /**
   * ⚠ **THE TYPED KIND, ON THE ONE LINE EVERY SUCCESSFUL RESPONSE CARRIES**
   * (R-32). `_dopl_status` is the agent's targeting check, and "which kind of
   * container did this land in" was the question it could not answer — which is
   * how a chat got exported into a home space nothing lists. Every single-
   * container list (`dopl_kb(op="list_bases")`, `dopl_agent(op="list")`) names
   * its container through this line rather than restating it per row.
   *
   * ⚠ OPTIONAL because a caller may construct this state from a row that
   * carried no `kind` (an older server); absent renders as nothing, never as a
   * guessed `workspace`.
   */
  kind?: ContainerKind;
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
   * 🔒 **THE `container=` ADDRESS GRAMMAR, RESOLVED** (R-32) — the reserved word
   * {@link HOME_ADDRESS}, else a slug, else an id, against every membership.
   *
   * ⚠ **`home` IS ANSWERED FROM THE DIRECTORY, NOT FROM A SECOND CONCEPT.** The
   * caller's home space is one of the rows `getWorkspaceList()` already
   * returns (B10 stopped filtering them), so the reserved word is a SELECT over
   * the list this object already holds — no loopback, no default-workspace
   * notion coming back, and a locked session resolves it only if the row it is
   * locked to IS that container.
   *
   * ⚠ **NULL FOR A CALLER WITH NO HOME SPACE, AND THAT IS A REFUSAL AND
   * NOT A FALLBACK** (§G.3 rule 4). `20260920120000` mints one per account, but
   * an estate where it has not replayed has callers without one, and answering
   * `home` with "the first workspace you happen to be in" would file a write
   * into somebody's team.
   *
   * 🔒 **AND A SLUG THAT NAMES TWO VISIBLE ROWS ANSWERS
   * {@link AmbiguousContainerRef} RATHER THAN EITHER OF THEM** (F-719) — the
   * caller renders the refusal. ⚠ **WHAT THE CALLER CAN SEE IS THE FENCE**: the
   * match runs over this directory, so a slug that is ambiguous account-wide
   * but names ONE row here resolves, and a locked session resolves against its
   * one row alone.
   */
  resolveContainerRef(ref: string): Promise<ContainerRefResolution | null>;
  /**
   * The caller's own home space, or null. ⚠ The one reader of what
   * `home` MEANS — used by the unaddressed-read default and by `dopl_map`'s
   * Home-space node, so neither restates the `kind === "home"` test.
   */
  homeContainer(): Promise<WorkspaceListItem | null>;
  /**
   * `workspaceId` → {@link ContainerKind}, over every container the caller is
   * in. ⚠ **A LOOKUP, NOT A SECOND DIRECTORY**: the account-wide channel reads
   * name a `workspaceId` per row and carry no kind of their own, and R-32 puts
   * the kind on every row that names a container. A row whose container is not
   * in the directory is ABSENT rather than guessed at — see `narrowToLock`.
   */
  containerKindIndex(): Promise<ReadonlyMap<string, ContainerKind>>;
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

/** Membership cache TTL (slug→id). Seeded at boot, refreshed on demand. */
const WORKSPACE_CACHE_TTL_MS = 60_000;

export function createWorkspaceDirectory(
  client: DoplClient,
  options: WorkspaceDirectoryOptions = {},
): WorkspaceDirectory {
  // ⚠ Seed from the boot directory, but NOT when the boot load FAILED — that
  // caches a bogus empty list for a full TTL and masks the failure. Null lets
  // the first `workspace=` / no-default path retry.
  let workspaceListCache: { workspaces: WorkspaceListItem[]; loadedAt: number } | null =
    options.directory && !options.directoryLoadFailed
      ? { workspaces: options.directory, loadedAt: Date.now() }
      : null;

  /** The cache, kind and all. ⚠ RESOLUTION reads this; LISTING never does. */
  async function getAllWorkspaces(): Promise<WorkspaceListItem[]> {
    if (
      workspaceListCache &&
      Date.now() - workspaceListCache.loadedAt < WORKSPACE_CACHE_TTL_MS
    ) {
      return workspaceListCache.workspaces;
    }
    const result = await client.listWorkspaces();
    workspaceListCache = {
      workspaces: result.workspaces,
      loadedAt: Date.now(),
    };
    return result.workspaces;
  }

  const lockedTo = options.lockedTo ?? null;

  async function getWorkspaceList(): Promise<WorkspaceListItem[]> {
    // 🔒 THE LOCK SHORT-CIRCUITS BEFORE THE CACHE IS EVEN READ. A locked session
    // sees its container and nothing else — including no evidence that anything
    // else exists.
    if (lockedTo) return [lockedTo];
    return getAllWorkspaces();
  }

  /**
   * EVERY visible row a ref names. ⚠ **ONE MATCHER, TWO READINGS** (F-719):
   * `resolveWorkspaceRef` takes the head, while `resolveContainerRef` reads the
   * whole list and refuses a tie. A second copy of the lock + refresh ordering
   * is how the two drift apart.
   *
   * ⚠ **`grant.ts` NO LONGER LEANS ON THE FIRST-WINS HEAD** (2026-09-17). It
   * did, which meant `to=<slug>` naming two containers the caller is in lent
   * into whichever came back first — silently widening an audience — and
   * `to="home"` resolved to nothing at all. It goes through
   * `resolveContainerRef` now, so first-wins has NO production caller left;
   * `resolveWorkspaceRef` stays on the interface because the container-lock and
   * workspace-kind suites pin the lock's behaviour through it.
   */
  async function matchContainerRefs(ref: string): Promise<WorkspaceListItem[]> {
    // 🔒 THE LOCK ANSWERS BEFORE ANY LOOKUP, so a ref that names another
    // workspace is refused without a cache refresh — and a refused ref is
    // indistinguishable from one that names nothing, which is the same
    // no-oracle discipline the server's own 404 ordering keeps (§4).
    if (lockedTo) {
      return ref === lockedTo.id || ref === lockedTo.slug ? [lockedTo] : [];
    }
    const list = await getAllWorkspaces();
    const matches = list.filter((w) => matchesContainerRef(w, ref));
    if (matches.length > 0) return matches;
    // Force-refresh once — covers a mid-session membership add.
    workspaceListCache = null;
    return (await getAllWorkspaces()).filter((w) => matchesContainerRef(w, ref));
  }

  async function resolveWorkspaceRef(
    ref: string,
  ): Promise<WorkspaceListItem | null> {
    return (await matchContainerRefs(ref))[0] ?? null;
  }

  /**
   * ⚠ **THE HOME SPACE IS SELECTED OFF THE LISTABLE SET, so the lock
   * narrows it for free**: a locked session sees `[lockedTo]` and finds a
   * home space there only if that is what it is locked to.
   */
  async function homeContainer(): Promise<WorkspaceListItem | null> {
    const list = await getWorkspaceList();
    return list.find((w) => containerKind(w) === "home") ?? null;
  }

  async function resolveContainerRef(
    ref: string,
  ): Promise<ContainerRefResolution | null> {
    // ⚠ THE RESERVED WORD IS TESTED FIRST AND CASE-INSENSITIVELY. An agent that
    // types `Home` means its home space; a slug is lower-case by construction
    // (`slugifyWorkspaceName`), so nothing legitimate is shadowed by the fold.
    const folded = ref.trim().toLowerCase();
    if (folded === HOME_ADDRESS || isLegacyHomeAddress(folded)) return homeContainer();
    const matches = await matchContainerRefs(ref);
    // ⚠ **AN ID ANSWERS BEFORE ANY SLUG QUESTION** — it is unique account-wide,
    // so it cannot tie, and it is the remedy the refusal below hands back.
    const byId = matches.find((w) => w.id === ref);
    if (byId) return byId;
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    // 🔒 F-719 — REFUSE AND NAME BOTH; never pick.
    return { ambiguous: [...matches].sort((a, b) => a.id.localeCompare(b.id)) };
  }

  async function containerKindIndex(): Promise<ReadonlyMap<string, ContainerKind>> {
    const list = await getWorkspaceList();
    return new Map(list.map((w) => [w.id, containerKind(w)] as const));
  }

  return {
    getWorkspaceList,
    resolveWorkspaceRef,
    resolveContainerRef,
    homeContainer,
    containerKindIndex,
    lockedWorkspaceId: () => lockedTo?.id ?? null,
  };
}

/**
 * 🔒 **WHAT KIND OF CONTAINER THIS ROW IS, ASKED POSITIVELY AND IN ONE PLACE**
 * (F-564).
 *
 * ⚠ **IT IS A `switch` ON `kind`, NOT `!isStandardWorkspace(…)`.** That
 * predicate answers "does this belong in the rail"; its NEGATION was read as
 * "therefore a home channel" at four sites in this package, which was correct
 * by accident while `standard` and `link` were the only kinds and stops being
 * correct the moment `20260920120000` mints a `home` container for every
 * user at once. A `default` arm that says "workspace" also fails safe for a
 * kind added later: an unknown container is not silently advertised as somebody
 * else's room.
 *
 * ⚠ **RENDERED, NEVER INFERRED BY THE READER.** A container and a workspace are
 * different things to the operator, and every surface that lists these rows
 * prints this label — which is what lets `getWorkspaceList()` stop hiding
 * containers (B10) without ever calling one a workspace.
 */
/**
 * How a kind is RENDERED in a directory row. The Home space is the one
 * an agent keeps mistaking for a workspace (Samuel, 2026-09-06: "Samuel's
 * Workspace" read as the home space, and the home space read as a workspace),
 * so its label says what it serves as, in words that cannot be read as a
 * second workspace: it is the caller's default, and it is not a workspace.
 *
 * ⚠ **THE VALUE AND THE LABEL SPLIT ON 2026-09-17 (R-32) AND THEY MUST STAY
 * SPLIT.** `kind` is now a typed wire value an agent may COMPARE
 * (`@dopl/contracts › ContainerKind`), so it carries no space and no
 * parenthetical; this table is the only place those words are written. A
 * `Record` keyed by the union, so the compiler proves it total — a fourth kind
 * is a build error here rather than a row that renders its own value at a
 * reader.
 */
const CONTAINER_KIND_LABELS: Record<ContainerKind, string> = {
  home: "home space (your default; not a workspace, and it holds no channels)",
  home_channel: "home channel",
  workspace: "workspace",
};

export function containerKindLabel(kind: ContainerKind): string {
  return CONTAINER_KIND_LABELS[kind];
}

/**
 * ⚠ **THE ONE MAPPING FROM THE COLUMN TO THE WIRE**, and `scripts/
 * check-role-drift.ts › checkContainerKind` holds it against the `workspaces.
 * kind` `CHECK` in both directions.
 */
export function containerKind(row: { kind?: WorkspaceKind }): ContainerKind {
  switch (row.kind ?? "standard") {
    case "link":
      return "home_channel";
    case "home":
      return "home";
    default:
      return "workspace";
  }
}

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
export function narrowToLock<T extends { workspaceId: string }>(
  rows: T[],
  directory: WorkspaceDirectory,
): T[] {
  const locked = directory.lockedWorkspaceId();
  if (!locked) return rows;
  return rows.filter((r) => r.workspaceId === locked);
}

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
export async function searchLegs(
  directory: WorkspaceDirectory,
): Promise<SearchLeg[]> {
  return (await directory.getWorkspaceList()).map((w) => {
    const kind = containerKind(w);
    return {
      id: w.id,
      label: w.name,
      kind,
      ...(kind === "workspace" ? { slug: w.slug } : {}),
    };
  });
}
