import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { personalShelfContainerIds } from "@/shared/tenancy/personal-reach";
import {
  meetsLevel,
  narrowerLevel,
  type OntologyContext,
  type OntologyLevel,
} from "../types";
import {
  canEditOntology,
  canSeeOntology,
  NO_ONTOLOGY_SHARES,
  type OntologyShareReach,
} from "./service-shared";
import {
  countActiveWorkspaceMembers,
  findWorkspaceKind,
  listChannelIdsForWorkspace,
  listSharesForChannels,
} from "./repository-shares";

/**
 * 🔒 THE ONTOLOGY AUDIENCE CEILING — what ONE request may reach, and at what
 * rung. The ontology twin of `knowledge/server/service-audience.ts ›
 * resolveAgentAudience`, arm for arm, and the ONLY fence behind the home
 * ontology's sharing model (spec §2 I6, §4 site 1).
 *
 * 🔒 IT IS A FENCE BECAUSE EVERY INPUT IS A DB FACT. `repository-shares.ts`
 * re-reads the container's kind, its active member count, its channel ids and
 * its share rows; the cluster's own `created_by` / `agents_may_edit` come off
 * the row. Nothing here is decided by a header, a prompt or a tool description
 * — an agent holds its operator's credential and has Bash, so a hidden control
 * is not a fence and the desktop's prompt framing (§4 site 9) is a
 * COMPENSATING CONTROL, never this.
 *
 * ⚠ IT BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW (I7,
 * INVARIANTS §11). A solo channel that gains a peer tightens at the next tool
 * call; it cannot un-read what a running session already holds.
 *
 * ⚠ TWO DIFFERENT ANSWERS SHARE THE WORD "SCOPE" HERE AND CONFUSING THEM IS THE
 * ONE WAY TO LEAK:
 *   - {@link OntologyAudience.workspaceIds} is a READ SCOPE — which containers a
 *     query may name. It is deliberately WIDER than the caller's own container,
 *     because a lent ontology lives in the LENDER's container.
 *   - {@link levelForCluster} is the AUTHORIZATION. Every row a widened read
 *     returns must pass it. A read that widens the scope and forgets the filter
 *     hands the caller the lender's whole shelf.
 */

/** The cluster facts the ceiling reads. Structural, so `OntologyClusterRow` and
 *  `OntologyClusterSummaryRow` both satisfy it without either importing this. */
export interface AudienceClusterFacts {
  id: string;
  /** The ONTOLOGY's container — `service-shared.ts › canSeeOntology`'s arm 1. */
  workspace_id: string;
  /** The OWNER (spec §1). `null` = a row whose author is gone; it can never
   *  match a caller, which is the fail-closed reading. */
  created_by: string | null;
  /** Samuel's solo toggle. ⚠ Only ever read on the owner's own AGENT arm. */
  agents_may_edit: boolean;
}

/**
 * What this request reaches.
 *
 * `unrestricted` is the pre-ceiling behaviour VERBATIM and carries no share map
 * — a separate SHAPE rather than a boolean beside a map, so no caller can read
 * an empty map as "unrestricted" or an unrestricted answer as "reaches
 * nothing". Those two mistakes are opposite and both are silent.
 */
export type OntologyAudience =
  | { readonly kind: "unrestricted"; readonly workspaceIds: readonly string[] }
  | {
      readonly kind: "resolved";
      readonly workspaceIds: readonly string[];
      /**
       * 🔒 THE CALLER'S OWN HUMAN LEVEL PER CLUSTER — `service-shared.ts ›
       * OntologyShareReach`, and the map its predicates take. The MEMBER-vs-GUEST
       * column choice happens ONCE here, at resolve time, because the caller's
       * class is a fact about the request rather than about a row.
       */
      readonly reach: OntologyShareReach;
      /** `owner_agents_level` per cluster — the OWNER's own agent column, which
       *  is the only cell of the matrix an agent does not simply inherit. */
      readonly ownerAgents: ReadonlyMap<string, OntologyLevel>;
      readonly source: "user" | "agent";
      /** The person this request acts as, or `null` for a credential standing
       *  for nobody in particular — which owns nothing and inherits nobody. */
      readonly userId: string | null;
      /** ONE active member in the CALLING container. ⚠ `false` when the count
       *  could not be read: unknown is not the same as one. */
      readonly solo: boolean;
    };

/**
 * ⚠ ONE RESOLUTION PER REQUEST. Keyed on the context OBJECT — `service.ts ›
 * buildOntologyContext` mints exactly one per request, so an entry cannot
 * outlive its request and cannot be shared between two. A `WeakMap` rather
 * than a field on the context keeps `OntologyContext` a plain data shape that
 * `types.ts` can own without importing this server module.
 *
 * ⚠ THE PROMISE IS CACHED, NOT THE VALUE: `getSnapshot` fans four reads out
 * with `Promise.all`, and caching the settled value would let all four race
 * past an unset slot and resolve the ceiling four times.
 */
const AUDIENCE_CACHE = new WeakMap<OntologyContext, Promise<OntologyAudience>>();

export function resolveOntologyAudience(
  ctx: OntologyContext
): Promise<OntologyAudience> {
  const hit = AUDIENCE_CACHE.get(ctx);
  if (hit) return hit;
  const pending = computeAudience(ctx);
  AUDIENCE_CACHE.set(ctx, pending);
  return pending;
}

/**
 * ```
 * workspace kind ∉ {link, personal} → unrestricted  (standard workspaces UNCHANGED — Q5)
 * shared credential                 → resolved, reaching NOTHING (M-10, fail closed)
 * else                              → resolved from the container's share rows
 * ```
 *
 * ⚠ THE ORDER IS THE QUERY BUDGET, and the first arm is the hot one: the
 * standard-workspace ontology page — every read the product does today — costs
 * exactly ONE extra probe and never touches channels, members or shares. Only a
 * caller standing in a home container pays the fan.
 *
 * ⚠ A MISSING WORKSPACE ROW ANSWERS `unrestricted`, and that is not a hole:
 * `withWorkspaceAuth` already proved an active membership before this runs, so
 * `null` means the row vanished mid-request and every read underneath is about
 * to answer nothing anyway.
 */
async function computeAudience(ctx: OntologyContext): Promise<OntologyAudience> {
  const kind = await findWorkspaceKind(ctx.workspaceId);
  if (kind !== "link" && kind !== "personal") {
    return { kind: "unrestricted", workspaceIds: [ctx.workspaceId] };
  }

  if (isSharedCredential(ctx)) {
    // 🔒 A credential that may be passed between humans stands for nobody, so it
    // owns no ontology and reads no share THROUGH a membership it does not have
    // — the refusal `service-shared.ts › sharedOntologyLevel` states and
    // `dopl_ontology_readable`'s share arm states in SQL. It keeps the calling
    // container as its read SCOPE; arm 1 of the predicate still admits that
    // container's own rows, which is M-10 unchanged.
    return {
      kind: "resolved",
      workspaceIds: [ctx.workspaceId],
      reach: NO_ONTOLOGY_SHARES,
      ownerAgents: new Map(),
      source: ctx.source,
      userId: null,
      solo: false,
    };
  }

  const [channelIds, personalIds, memberCount] = await Promise.all([
    listChannelIdsForWorkspace(ctx.workspaceId),
    personalShelfContainerIds({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      credentialSubjectUserId: ctx.credentialSubjectUserId,
      source: ctx.source,
    }),
    // ⚠ Only the AGENT arms read this, and only on an UNSHARED own cluster —
    // but it rides the same fan rather than adding a fifth round trip to the
    // one caller that needs it.
    ctx.source === "agent"
      ? countActiveWorkspaceMembers(ctx.workspaceId)
      : Promise.resolve<number | null>(null),
  ]);

  const shareRows = await listSharesForChannels(channelIds);
  // ⚠ THE COLUMN IS PICKED ONCE, BY THE CALLER'S CLASS (§1: `member`+ vs
  // `guest`), and Q1 is why an agent needs no second pick — a member's or
  // guest's agent inherits EXACTLY that person's level, so it reads the same
  // column. ⚠ MAX across channels, not first-wins: the same ontology lent into
  // two rooms the caller is in gives them the wider of the two (I5).
  const reach = new Map<string, OntologyLevel>();
  const ownerAgents = new Map<string, OntologyLevel>();
  for (const row of shareRows) {
    const level = ctx.role === "guest" ? row.guests_level : row.members_level;
    reach.set(row.ontology_id, widerOf(reach.get(row.ontology_id), level));
    ownerAgents.set(
      row.ontology_id,
      widerOf(ownerAgents.get(row.ontology_id), row.owner_agents_level)
    );
  }

  return {
    kind: "resolved",
    // ⚠ THE LEND WIDENS THE READ SCOPE AND NOTHING ELSE. A share row is filed
    // under the ONTOLOGY's container, so reaching it means naming that
    // container in the query — and every row it returns still has to clear
    // `levelForCluster`, which admits only the cluster the row actually names.
    workspaceIds: [
      ...new Set([
        ctx.workspaceId,
        ...personalIds,
        ...shareRows.map((r) => r.workspace_id),
      ]),
    ],
    reach,
    ownerAgents,
    source: ctx.source,
    userId: ctx.userId,
    // ⚠ FAIL CLOSED. `null` (PostgREST answered without a count) is read as NOT
    // solo: unknown is not the same as one, and the safe reading of "I could
    // not count the people in this room" is that there is somebody in it.
    solo: memberCount !== null && memberCount <= 1,
  };
}

/**
 * 🔒 **THE AGENT CEILING, AND NOTHING ELSE (spec §2).** WHICH ontology the
 * caller may see is `service-shared.ts › canSeeOntology` / `› canEditOntology`
 * — the TypeScript twin of `dopl_ontology_readable` / `dopl_ontology_writable`,
 * with an RLS policy and a redteam suite holding it in place. This function
 * asks the SECOND question: **how far may this CREDENTIAL reach inside that
 * answer.** Two layers, two questions, exactly as that module's header says.
 *
 * ```
 * unrestricted                         → edit  (standard workspaces, unchanged)
 * the human answer                     → edit / view / none  ← service-shared.ts
 * then, for an AGENT only, NARROW it:
 *   owner's own cluster, shared here   → owner_agents_level
 *   owner's own cluster, solo room     → agents_may_edit ? edit : view
 *   owner's own cluster, shared room   → view       (Q2's solo→shared drop)
 *   anyone else's                      → unchanged  (Q1: EXACTLY its human)
 * ```
 *
 * 🔒 **IT ONLY EVER CLOSES**, the property `knowledge › resolveAgentAudience`
 * states about itself: every agent arm is a {@link narrowerLevel} against the
 * human answer, so no branch here can make an ontology reachable that the
 * predicate refused. A ceiling that could widen is not a ceiling.
 *
 * ⚠ **THE OWNER ARM IS `created_by`, NOT `workspace_id === ctx.workspaceId`,
 * AND IT EXISTS TO RESTORE ROW 2 OF ONE TRUTH TABLE.** That table is stated
 * ONCE, in `service-shared.ts`'s header — read it there, it is not restated
 * here. Short form: arm 1 (`inOwnContainer`) is STRICTLY NARROWER than its SQL
 * twin because {@link OntologyAudience.workspaceIds} reads wider than the ONE
 * container `withWorkspaceAuth` proved, and the caller's own personal shelf is
 * the case that matters — a personal container's only member IS its owner, so
 * `created_by === userId` is `is_current_workspace_member(c.workspace_id,
 * 'viewer')` for it, and is strictly narrower everywhere else.
 *
 * 🔒 **AND IT IS SOUND ONLY BECAUSE THE READ SCOPE CONTAINS IT.** This arm asks
 * nothing about membership, so a row from a container the caller was REMOVED
 * from would answer `edit` — it never arrives, because such a container is in
 * neither {@link OntologyAudience.workspaceIds} nor any query this service makes.
 * **A caller that hands `levelForCluster` a row it did not read through
 * {@link OntologyAudience.workspaceIds} has broken that**, and no arm here can
 * tell. Pinned in `./service-audience.test.ts › the owner arm`.
 *
 * ⚠ I1 NEEDS NO `min` FOR OTHER PEOPLE'S AGENTS AND THAT IS Q1, NOT AN
 * OMISSION: an agent inherits EXACTLY its operator's level, so the human answer
 * already IS the `min`. The one place the two diverge is the OWNER, who has
 * controls of their own.
 */
export function levelForCluster(
  ctx: OntologyContext,
  audience: OntologyAudience,
  cluster: AudienceClusterFacts
): OntologyLevel {
  if (audience.kind === "unrestricted") return "edit";

  const scope = { id: cluster.id, workspaceId: cluster.workspace_id };
  const owns =
    audience.userId !== null && cluster.created_by === audience.userId;
  // "A share never narrows the owner" (§2) — and see the docblock for why this
  // arm is not simply `inOwnContainer`.
  const human = owns
    ? "edit"
    : canEditOntology(ctx, scope, audience.reach)
      ? "edit"
      : canSeeOntology(ctx, scope, audience.reach)
        ? "view"
        : "none";

  if (audience.source !== "agent" || !owns) return human;

  const shared = audience.ownerAgents.get(cluster.id);
  if (shared !== undefined) return narrowerLevel(human, shared);
  // UNSHARED (I3): the solo toggle, capped to `view` once the room has a peer
  // (Q2) — until the owner states an `ownerAgentsLevel` on a share row.
  if (!audience.solo) return narrowerLevel(human, "view");
  return narrowerLevel(human, cluster.agents_may_edit ? "edit" : "view");
}

/** Does this audience clear `min` on this cluster? ⚠ `min` defaults to `view`
 *  because every READ asks the same question; a WRITE must pass `"edit"`
 *  explicitly, so a caller cannot get a write gate by forgetting an argument. */
export function audienceAdmits(
  ctx: OntologyContext,
  audience: OntologyAudience,
  cluster: AudienceClusterFacts,
  min: OntologyLevel = "view"
): boolean {
  return meetsLevel(levelForCluster(ctx, audience, cluster), min);
}

/** The wider of two rungs, `undefined` meaning "nothing seen yet". ⚠ I5: the
 *  same ontology lent into two rooms the caller is in answers with the wider,
 *  never the first row PostgREST happened to return. */
function widerOf(
  current: OntologyLevel | undefined,
  next: OntologyLevel
): OntologyLevel {
  if (current === undefined) return next;
  return narrowerLevel(current, next) === current ? next : current;
}
