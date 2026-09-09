import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { meetsMinRole } from "@/features/workspaces/types";
// 🔒 G16 — the ONE statement of the publish-into-a-peer's-room precondition,
// shared with `agent-templates/server/service-writes.ts`. Two copies of a
// tenancy predicate is how the shelf fence ended up divergent (findings §6 #3).
import { assertSharedPublishAcknowledged } from "@/features/workspaces/server/shared-publish";
import { listTeamIdsForUser } from "@/features/teams/server/repository";
import { personalShelfRefusal } from "@/shared/tenancy/personal-container";
import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
import type { KnowledgeContext } from "../types";
import type { KnowledgeBaseCreateInput } from "../schema";
import {
  AgentWriteDisabledError,
  TeamScopeForbiddenError,
  WorkspaceKeyPrivateVisibilityError,
} from "./errors";
import { resolveAgentAudience } from "./service-audience";

/**
 * 🔒 THE GATE A KNOWLEDGE-BASE **CREATE** PASSES, and nothing else.
 *
 * ⚠ **THE SEAM, AND WHY IT IS NOT ARBITRARY** (split out of
 * `service-base-writes.ts` at §1's cap, 2026-09-02 and again 2026-09-09, both
 * times on this line): what lives here answers a question about the CALLER
 * before any row exists — may this person write to their shelf, will they read
 * back what is about to be written — while `service-base-writes.ts` composes a
 * row and persists it. A gate beside the insert is a gate a later edit reorders
 * past it.
 *
 * ⚠ NOT EXPORTED ANY FURTHER THAN THAT MODULE. This is not a general "knowledge
 * gate" surface: what is here is meaningful only before an insert that has not
 * happened yet.
 *
 * ⚠ RETIRED NAMES THE DOCS STILL CITE: `resolveHomeScope` (the three-condition
 * home-shelf fence, deleted 2026-09-02 with the `home_scoped` column — replaced
 * by `shared/tenancy/personal-container.ts › personalWriteWorkspaceId`, which
 * fences ONE condition) and `assertCreatorCanReadItBack` (deleted 2026-09-06,
 * absorbed by {@link resolveCreateDestination}).
 */

/**
 * 🔒 **A CREATE MUST NOT PRODUCE A ROW ITS OWN CREATOR CANNOT READ BACK** —
 * F-323's authoring half, said by both refusing arms of
 * {@link resolveCreateDestination} (the create that names the ROOM, and the one
 * whose personal reach comes back CLOSED). ONE message for both: two copies of a
 * refusal stop agreeing about the remedy. ⚠ The third throw there — the shelf
 * asked for BY NAME — is `personal-container.ts › personalShelfRefusal`, whose
 * wording belongs to the router.
 *
 * THE BUG IT CLOSES. `resolveAgentAudience` answers `granted` for an agent in a
 * `kind='link'` container with a PEER in it — reachable bases are only those
 * carrying a channel GRANT — and every READ composes that filter while
 * `createBase` composed nothing. A new base has no grant by construction, so the
 * insert succeeded, the tool reported success, and the row was invisible to its
 * creator from the very next call. An agent that cannot see the failure retries:
 * the observed report was two successes and two orphaned rows.
 *
 * ⚠ **REFUSAL IS THE ONLY AVAILABLE ANSWER.** The alternative repair — granting
 * the new base into the container's channel — is human-only
 * (`service-channel-grants.ts › setChannelKnowledgeGrant`, 2026-08-27), so the
 * create-and-share path already always refuses here. This makes the plain create
 * behave the same way, one call earlier and without writing a row first.
 *
 * ⚠ **IT NARROWS NOBODY WHOSE WRITE WORKED**: a human, a standard workspace and
 * a solo container are `resolveAgentAudience`'s `unrestricted` branches. It is
 * deliberately NOT keyed on `ctx.source === "agent"` alone — an agent in the
 * operator's own workspace reads its bases back perfectly well.
 *
 * ⚠ The message names the ROOM and the REMEDY: "forbidden" with no cause is what
 * sends an agent to grep the repo.
 */
function personalShelfUnreachableInRoom(): AgentWriteDisabledError {
  return new AgentWriteDisabledError(
    "(new)",
    "An agent cannot create a knowledge base inside a shared home channel. " +
      "In a container with another member in it, an agent reaches only the bases " +
      "the operator has SHARED into one of that channel's knowledge grants — and a " +
      "base you just created carries no grant, so it would be invisible to you from " +
      "your very next call. Sharing one into a channel is a human-only setting. " +
      "Ask your operator to create the base here and share it into the channel, to " +
      "arm this channel for their personal shelf so your creates land there, or " +
      "create it in a workspace of your own instead.",
  );
}

/**
 * 🔒 **WHERE A CREATE LANDS — gap 2 of #1077:** *"a create with no valid
 * container in a shared room should go to the caller's own personal container,
 * not refuse — personal-visibility creates resolve their container by OWNER,
 * never by call site."*
 *
 * ── The seam, in the order it decides ───────────────────────────────────────
 * ```
 * asked for the shelf (homeScoped)  → the fence answers; open lands personal,
 *                                     closed REFUSES (never downgrades)
 * audience unrestricted             → the calling container, exactly as today
 * audience restricted + reachable   → the caller's own personal container
 * audience restricted + closed      → the refusal above, with the new remedy
 * ```
 *
 * ⚠ **IT CHANGES NOTHING THAT WORKS TODAY** — the only creates it re-routes are
 * the ones already refused outright, so no row that lands in the calling
 * container today lands anywhere else tomorrow.
 *
 * 🔒 **IT HALF-OPENS NOTHING, AND A4 INHERITS THIS.** The personal destination
 * needs `personal-reach.ts` to answer OPEN, which in a shared room means the
 * owner armed it; an unarmed room still refuses. The fence is ASKED here rather
 * than re-implemented, so an adopting caller gets the same answer, not a second
 * opinion.
 * ⚠ **THE READ-BACK QUESTION IS ANSWERED AT THE DESTINATION** — not at
 * `ctx.workspaceId`, where a personal row does not land. The caller's own
 * container is `unrestricted` by construction (one member, no grant filter), so
 * an OPEN fence IS the read-back guarantee.
 * ⚠ **REFUSING LOUDLY IS NOT THE ORACLE THE FENCE FORBIDS** — that rule is about
 * READS. A write has no silent form ("refuse, never downgrade"), and the only
 * person who learns anything is the OWNER, about their own shelf and room.
 * ⚠ **NOTHING HERE GUESSES A CONTAINER** (invariant 1 of #1077;
 * `workspaces/b10-no-derived-default.test.ts` scans this file's prose): the
 * destination is resolved by owner and is the ONLY container a personal row can
 * live in. A create that cannot land there is refused, never widened.
 * ⚠ **`shareToChannelId` AND TEAM GRANTS ARE NEVER RE-ROUTED** — both name the
 * calling container, so a create carrying either keeps the refusal rather than
 * landing its row where its grant cannot follow.
 */
export interface CreateDestination {
  /** ⚠ THE ROUTING FLAG, PASSED STRAIGHT TO THE REPOSITORY — the router is what
   *  resolves the container, so this function and `personalWriteWorkspaceId`
   *  cannot disagree about the id: both ask `findPersonalContainerId` for the
   *  same owner. */
  homeScoped: boolean;
  /** WHERE the row lands, for the callers that must know before the insert —
   *  the slug read and the rollback. Equal to `ctx.workspaceId` unless the row
   *  is personal. */
  workspaceId: string;
}

export async function resolveCreateDestination(
  ctx: KnowledgeContext,
  input: {
    homeScoped?: boolean;
    shareToChannelId?: string;
    wantsTeams?: boolean;
  },
): Promise<CreateDestination> {
  const room: CreateDestination = {
    homeScoped: false,
    workspaceId: ctx.workspaceId,
  };
  if (input.homeScoped === true) {
    const reach = await resolvePersonalReach(ctx);
    if (reach.kind === "open") {
      return { homeScoped: true, workspaceId: reach.containerId };
    }
    // ⚠ REFUSE, NEVER DOWNGRADE — the caller asked for their shelf by name and
    // the workspace shelf is a different audience, not a lesser one.
    // ⚠ THE SENTENCE IS `personal-container.ts`'s, not this file's: the router
    // and the agent-templates twin throw the same three, and a hand-mirrored
    // copy is how two refusals stop agreeing about the remedy.
    throw personalShelfRefusal(reach.refusal);
  }

  const audience = await resolveAgentAudience(ctx);
  if (audience.kind === "unrestricted") return room;
  // The population the read-back gate refuses. A create that names the ROOM
  // keeps that refusal; anything else may follow its owner.
  if (input.shareToChannelId !== undefined || input.wantsTeams === true) {
    throw personalShelfUnreachableInRoom();
  }
  const reach = await resolvePersonalReach(ctx);
  if (reach.kind === "closed") throw personalShelfUnreachableInRoom();
  return { homeScoped: true, workspaceId: reach.containerId };
}

// ─── The CREATE's whole pre-write gate chain ────────────────────────────────
//
// ⚠ Moved here from `service-base-writes.ts` on 2026-09-09 (§1's cap; see this
// module's header for the seam). That file RE-EXPORTS both names, so the route,
// the barrel and `service-create-audience.test.ts` are unchanged.

/** What {@link assertCreateBaseAllowed} decided, and {@link createBase} then
 *  writes with. ⚠ Every field is a DECISION, not an echo of the input: the
 *  destination is resolved by owner, and the visibility is the value the row
 *  LANDS at after the teams branch has had its say. */
export interface CreateBasePreconditions {
  destination: CreateDestination;
  visibility: "public" | "private";
  teamGrants: NonNullable<KnowledgeBaseCreateInput["teamGrants"]>;
}

/**
 * 🔒 **EVERY PRE-WRITE GATE OF {@link createBase}, AS ONE FUNCTION — SO A DRY
 * RUN CAN RUN THE GATE THE CONFIRMED CALL RUNS.**
 *
 * ⚠ **THE PIN IT EXISTS FOR: A PREVIEW MUST NEVER MINT A TOKEN FOR A CREATE THE
 * CONFIRMED CALL WOULD REFUSE.** `packages/mcp-server/src/tools/confirm-token.ts`
 * previews in a DIFFERENT PROCESS from the gates, so a public `create_base` in
 * an unarmed shared home channel previewed happily, issued a token, and was then
 * refused by {@link resolveCreateDestination}.
 * ⚠ **PARITY IS STRUCTURAL:** the dry run CALLS this function rather than
 * re-implementing the chain, so a gate added below is inherited by the preview
 * on the same commit.
 *
 * ⚠ **IT STOPS EXACTLY WHERE THE WRITES BEGIN.** Everything here touches no row,
 * so running it twice costs reads and changes nothing. The slug read stays BELOW
 * the line: a dry run must not report a collision against a base nobody may see.
 * ⚠ **A DRY RUN MUST SEND THE BODY THE CONFIRMED CALL WILL SEND**, including
 * `acknowledgeShared` — previewing without it refuses on the missing
 * acknowledgement, which is the very thing the preview exists to obtain.
 */
export async function assertCreateBaseAllowed(
  ctx: KnowledgeContext,
  input: KnowledgeBaseCreateInput,
): Promise<CreateBasePreconditions> {
  // 🔒 THE AUDIENCE CEILING, ASKED BEFORE THE INSERT rather than only by the
  // reads afterwards (F-323's authoring half), and the SAME call that decides
  // WHERE THE ROW LANDS (#1077 gap 2 — {@link resolveCreateDestination}).
  // ⚠ FIRST, before any other validation and before the slug read: a caller who
  // may not create here should spend no round trips finding out, and must not be
  // told about a collision with a row it cannot see.
  // ⚠ `wantsTeams` is resolved here rather than below because a teams create
  // names the calling container and must never be re-routed.
  const wantsTeams = input.accessMode === "teams";
  const destination = await resolveCreateDestination(ctx, {
    homeScoped: input.homeScoped,
    shareToChannelId: input.shareToChannelId,
    wantsTeams,
  });

  // No per-base agent-write gate on CREATE — that toggle is per-base and the
  // base doesn't exist yet. Slug unique per workspace keeps MCP `kb_*` slug
  // addressing unambiguous; publicId is the URL routing key.
  //
  // Visibility default by caller: a SHARED credential must be 'public'
  // (⚠ `canSeeBase` blocks such credentials from reading their own private rows
  // back, so a private one is stranded — explicit 'private' rejected loudly);
  // session caller / container session → 'private', owner publishes later.
  //
  // ⚠ THE PREDICATE MOVED WITH `canSeeBase` ON 2026-08-27 (F-336): a
  // container-session credential CAN read its own private rows back, so it is
  // not stranded, and forcing 'public' would have the operator's agent publish
  // into the room the PEER is standing in.
  const fromWorkspaceKey = isSharedCredential(ctx);
  // ⚠ ANNOTATED, NOT INFERRED, since this function ANSWERS with it — the
  // inferred type carried `undefined`, and a caller reading that as "whatever
  // the server defaults to" is the guess `knowledge-ops-write.ts › opCreateBase`
  // refuses to make.
  let resolvedVisibility: "public" | "private";
  if (fromWorkspaceKey) {
    if (input.visibility === "private") {
      throw new WorkspaceKeyPrivateVisibilityError();
    }
    resolvedVisibility = input.visibility ?? "public";
  } else {
    resolvedVisibility = input.visibility ?? "private";
  }

  // Teams mode is human-only; non-admin creators may only grant teams they
  // belong to. ⚠ `wantsTeams` is resolved at the top of this function now — the
  // destination gate needs it before any read.
  const teamGrants = wantsTeams ? (input.teamGrants ?? []) : [];
  if (wantsTeams) {
    if (ctx.source === "agent") {
      throw new AgentWriteDisabledError(
        "(new)",
        "Sharing scope is a human-only setting — agents cannot create teams-scoped knowledge bases.",
      );
    }
    if (!meetsMinRole(ctx.role, "admin")) {
      const myTeams = new Set(
        await listTeamIdsForUser(ctx.workspaceId, ctx.userId),
      );
      if (teamGrants.some((g) => !myTeams.has(g.teamId))) {
        throw new TeamScopeForbiddenError();
      }
    }
    // Teams implies shared — schema already rejects private+teams.
    resolvedVisibility = "public";
  }

  // 🔒 G16 — PUBLISHING INTO THE ROOM A PEER IS STANDING IN. ⚠ The RESOLVED
  // visibility, after the teams branch has had its say: `accessMode: "teams"`
  // rewrites it to `public`, and reading `input.visibility` would let that
  // rewrite publish unacknowledged.
  // ⚠ BEFORE THE SLUG LOOP, so a refusal costs no slug and cannot half-land.
  await assertSharedPublishAcknowledged({
    // ⚠ THE CONTAINER THE ROW LANDS IN, not the one the call stands in. G16 asks
    // whether this publishes into the room a PEER is standing in; a personal row
    // lands on a shelf with one member, so asking about the room would demand an
    // acknowledgement for an audience the row never reaches. Identical to
    // `ctx.workspaceId` for every non-personal create.
    workspaceId: destination.workspaceId,
    publishes: resolvedVisibility === "public",
    acknowledged: input.acknowledgeShared,
    noun: "knowledge base",
  });

  return { destination, visibility: resolvedVisibility, teamGrants };
}
