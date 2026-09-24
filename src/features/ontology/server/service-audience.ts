import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { personalShelfContainerIds } from "@/shared/tenancy/personal-reach";
import { isSharedRoom } from "@/shared/tenancy/shared-room";
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
 * The ontology audience ceiling — what ONE request may reach, and at what
 * rung. The ontology twin of `knowledge/server/service-audience.ts ›
 * resolveAgentAudience`, and the only fence behind the home ontology's sharing
 * model (spec §2 I6, §4 site 1).
 *
 * Every input is a DB fact (`./repository-shares.ts`, plus the ontology row's
 * own `created_by` / `agents_may_edit`) — never a header, a prompt or a tool
 * description. An agent holds its operator's credential and has Bash, so the
 * desktop's prompt framing (§4 site 9) is a COMPENSATING CONTROL, never this.
 *
 * It bounds FUTURE reads, never context already in the window (I7,
 * INVARIANTS §11).
 *
 * Two answers share the word "scope" and confusing them is the one way to
 * LEAK: {@link OntologyAudience.workspaceIds} is a READ SCOPE, deliberately
 * WIDER than the caller's container (a lent ontology lives in the LENDER's);
 * {@link levelForOntology} is the AUTHORIZATION every returned row must pass.
 */

/** The ontology facts the ceiling reads. Structural, so `OntologyRow` and
 *  `OntologyListItemRow` both satisfy it without either importing this. */
export interface AudienceOntologyFacts {
  id: string;
  /** The ONTOLOGY's container — `service-shared.ts › canSeeOntology`'s arm 1. */
  workspace_id: string;
  /** The OWNER (spec §1). `null` = a row whose author is gone; it can never
   *  match a caller, which is the fail-closed reading. */
  created_by: string | null;
  /** Samuel's solo toggle. Only ever read on the owner's own AGENT arm. */
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
       * The caller's own human level per ontology — `service-shared.ts ›
       * OntologyShareReach`, and the map its predicates take. The MEMBER-vs-GUEST
       * column choice happens ONCE here, at resolve time, because the caller's
       * class is a fact about the request rather than about a row.
       */
      readonly reach: OntologyShareReach;
      /** `owner_agents_level` per ontology — the OWNER's own agent column, which
       *  is the only cell of the matrix an agent does not simply inherit. */
      readonly ownerAgents: ReadonlyMap<string, OntologyLevel>;
      readonly source: "user" | "agent";
      /**
       * 🔒 **WHICH OF {@link OntologyAudience.workspaceIds} ARE THE CALLER'S OWN
       * PERSONAL SHELF** — the subset `personalShelfContainerIds` contributed,
       * kept rather than merged away (S29c, 2026-09-18).
       *
       * ⚠ **THE WIDENING WAS INVISIBLE AND THAT IS THE BUG.** The shelf reaches
       * into every home channel by design, so a BRAND-NEW channel lists
       * ontologies nobody put there — and with the ids folded into one read
       * scope, no reader downstream could say which those were. The KB lane
       * answers the same question with `homeScopedBaseIds` and labels its rows
       * `container-destination.ts › DESTINATION_HEADINGS.personal`; this is the
       * ontology lane's half of that pair.
       *
       * ⚠ **IT IS A LABEL, NEVER A FENCE.** Every row still has to clear
       * {@link levelForOntology}; nothing here widens or narrows what is
       * returned. Empty on every arm that resolves no shelf.
       */
      readonly personalWorkspaceIds: readonly string[];
      /** The person this request acts as, or `null` for a credential standing
       *  for nobody in particular — which owns nothing and inherits nobody. */
      readonly userId: string | null;
      /** EXACTLY ONE active member in the CALLING container —
       *  `!isSharedRoom(count)`. `false` for `0`, `null` and an unread count:
       *  unknown is not the same as one. */
      readonly solo: boolean;
    };

/**
 * One resolution per request, keyed on the context OBJECT — `./service.ts ›
 * buildOntologyContext` mints exactly one per request, so an entry can neither
 * outlive its request nor be shared between two. A `WeakMap` keeps
 * `OntologyContext` a plain data shape `../types.ts` can own.
 *
 * The promise is cached, not the value — concurrent readers would otherwise
 * race past an unset slot and resolve the ceiling once each.
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
 * workspace kind === standard       → unrestricted  (every board today — Q5, UNCHANGED)
 * workspace kind ∈ {link, personal} → resolved from the container's share rows
 * shared credential                 → resolved, reaching NOTHING (M-10, fail closed)
 * anything else (unknown kind, null)→ resolved, reaching NOTHING (F-683, fail closed)
 * ```
 *
 * The order is the query budget: the first arm is every read the product does
 * today and costs ONE probe, never touching channels, members or shares.
 *
 * **THE FALLBACK REACHES NOTHING, AND THE SAFE READING BELONGS IN THE ARM
 * RATHER THAN IN THE DEFAULT (F-683, fixed 2026-09-09).** It read
 * `if (kind !== "link" && kind !== "personal") return unrestricted`, so an
 * unknown kind — or a `null` from a workspace row that vanished mid-request —
 * answered `edit` on every ontology in scope. Same choice as the member count
 * below and as `dopl_ontology_level_rank`'s `ELSE -1`.
 */
async function computeAudience(ctx: OntologyContext): Promise<OntologyAudience> {
  const kind = await findWorkspaceKind(ctx.workspaceId);
  if (kind === "standard") {
    return { kind: "unrestricted", workspaceIds: [ctx.workspaceId] };
  }
  if (kind !== "link" && kind !== "personal") {
    // F-683's fail-closed arm. The READ SCOPE is EMPTY, not
    // `[ctx.workspaceId]`: every repository read short-circuits on an empty set,
    // and {@link levelForOntology} answers `none` for one — which is what closes
    // `./service-gates.ts › assertCanCreateOntology`, whose question is about a
    // row that does not exist yet and never came through a read.
    return {
      kind: "resolved",
      workspaceIds: [],
      reach: NO_ONTOLOGY_SHARES,
      ownerAgents: new Map(),
      source: ctx.source,
      // ⚠ NO SHELF WAS RESOLVED ON THIS ARM, so there is nothing to label —
      // which is a different statement from "the shelf is empty" only in a
      // world where this arm returned rows, and it returns none.
      personalWorkspaceIds: [],
      userId: null,
      solo: false,
    };
  }

  if (isSharedCredential(ctx)) {
    // A credential passed between humans stands for nobody: it owns no
    // ontology and reads no share THROUGH a membership it does not have
    // (`./service-shared.ts › sharedOntologyLevel`, and the SQL share arm). It
    // keeps the calling container as its read SCOPE — arm 1 still admits that
    // container's own rows, which is M-10 unchanged.
    return {
      kind: "resolved",
      workspaceIds: [ctx.workspaceId],
      reach: NO_ONTOLOGY_SHARES,
      ownerAgents: new Map(),
      source: ctx.source,
      // ⚠ A SHARED CREDENTIAL STANDS FOR NOBODY, so it has no shelf to reach
      // into and none to label (M-10, unchanged).
      personalWorkspaceIds: [],
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
    // Only the AGENT arms read this, and only on an UNSHARED own ontology; it
    // rides the same fan rather than adding a round trip for one caller.
    ctx.source === "agent"
      ? countActiveWorkspaceMembers(ctx.workspaceId)
      : Promise.resolve<number | null>(null),
  ]);

  const shareRows = await listSharesForChannels(channelIds);
  // The column is picked ONCE, by the caller's class (§1: `member`+ vs
  // `guest`); Q1 is why an agent needs no second pick — it inherits EXACTLY its
  // person's level, so it reads the same column. MAX across channels, not
  // first-wins (I5).
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
    // The lend widens the read scope and nothing else — every row it returns
    // still has to clear `levelForOntology`, which admits only the ontology the
    // share row actually names.
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
    // ⚠ THE SHELF'S OWN IDS, KEPT SEPARATE FROM THE SCOPE ABOVE — see the field.
    // The scope is a UNION and cannot be un-mixed by a later reader.
    personalWorkspaceIds: personalIds,
    userId: ctx.userId,
    // Fail closed, through the ONE predicate (F-718, 2026-09-18): `0`, `null`
    // and `undefined` are all "not one", so a roster race cannot widen an
    // agent's own-ontology arm from `view` to `edit`. The hand-spelled
    // `memberCount !== null && memberCount <= 1` it replaces answered SOLO to a
    // real `0`.
    solo: !isSharedRoom(memberCount),
  };
}

/**
 * The AGENT ceiling, and nothing else (spec §2). WHICH ontology the
 * caller may see is `./service-shared.ts › canSeeOntology` / `› canEditOntology`;
 * this asks how far a CREDENTIAL may reach inside that answer.
 *
 * ```
 * unrestricted                         → edit  (standard workspaces, unchanged)
 * the human answer                     → edit / view / none  ← service-shared.ts
 * then, for an AGENT only, NARROW it:
 *   owner's own ontology, shared here   → owner_agents_level
 *   owner's own ontology, solo room     → agents_may_edit ? edit : view
 *   owner's own ontology, shared room   → view       (Q2's solo→shared drop)
 *   anyone else's                      → unchanged  (Q1: EXACTLY its human)
 * ```
 *
 * It only ever closes: every agent arm is a {@link narrowerLevel} against
 * the human answer, so no branch here can reach an ontology the predicate
 * refused.
 *
 * The owner arm is `created_by`, not `workspace_id === ctx.workspaceId`, and
 * it restores row 2 of the truth table stated once in `./service-shared.ts`'s
 * header — read it there. `created_by === userId` is exact for a personal
 * container (its only member IS its owner) and strictly narrower everywhere else.
 *
 * Sound only because the read scope contains the row: this arm asks
 * nothing about membership, so a caller that hands `levelForOntology` a row it did
 * NOT read through {@link OntologyAudience.workspaceIds} has broken it, and no arm
 * here can tell. Pinned in `./service-audience.test.ts › the owner arm`.
 *
 * Other people's agents need no `min` (Q1): the human answer already IS it.
 */
export function levelForOntology(
  ctx: OntologyContext,
  audience: OntologyAudience,
  ontology: AudienceOntologyFacts
): OntologyLevel {
  if (audience.kind === "unrestricted") return "edit";
  // AN EMPTY READ SCOPE REACHES NOTHING, SAID ONCE HERE (F-683) — including
  // through `inOwnContainer`, which would otherwise admit the caller's own
  // container to an audience resolved BECAUSE that container's kind could not
  // be trusted.
  if (audience.workspaceIds.length === 0) return "none";

  const scope = { id: ontology.id, workspaceId: ontology.workspace_id };
  const owns =
    audience.userId !== null && ontology.created_by === audience.userId;
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

  const shared = audience.ownerAgents.get(ontology.id);
  if (shared !== undefined) return narrowerLevel(human, shared);
  // UNSHARED (I3): the solo toggle, capped to `view` once the room has a peer
  // (Q2) — until the owner states an `ownerAgentsLevel` on a share row.
  if (!audience.solo) return narrowerLevel(human, "view");
  return narrowerLevel(human, ontology.agents_may_edit ? "edit" : "view");
}

/** Does this audience clear `min` on this ontology? `min` defaults to `view`;
 *  a WRITE must pass `"edit"` explicitly, so no caller gets a write gate by
 *  forgetting an argument. */
export function audienceAdmits(
  ctx: OntologyContext,
  audience: OntologyAudience,
  ontology: AudienceOntologyFacts,
  min: OntologyLevel = "view"
): boolean {
  return meetsLevel(levelForOntology(ctx, audience, ontology), min);
}

/** The wider of two rungs, `undefined` = nothing seen yet. I5, never the
 *  first row PostgREST happened to return. */
function widerOf(
  current: OntologyLevel | undefined,
  next: OntologyLevel
): OntologyLevel {
  if (current === undefined) return next;
  return narrowerLevel(current, next) === current ? next : current;
}
