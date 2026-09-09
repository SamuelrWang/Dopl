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
 * ⚠ **IT HELD TWO UNTIL 2026-09-02 (slice B15).** `resolveHomeScope` — the
 * three-condition home-shelf fence — is DELETED with the `home_scoped` column it
 * answered for; what replaces it is `shared/tenancy/personal-container.ts ›
 * personalWriteWorkspaceId`, which fences ONE condition (a credential that
 * stands for a person, with a container) because the other two died with the
 * derived-container concept B14 deleted and with the
 * shelf-inside-a-shared-workspace it protected.
 * That module's docblock retires each condition by name.
 *
 * ⚠ **SPLIT OUT OF `service-base-writes.ts` ON 2026-09-02 AT THE §1 CAP** (it
 * measured 498 of 500). The seam is not arbitrary: what lives here is a
 * PRE-WRITE REFUSAL that answers a question about the CALLER — may this person
 * put a row on their home shelf, and will this caller be able to read back what
 * it is about to write — while everything left in that module composes a row and
 * persists it. A gate that lives beside the insert is a gate a later edit
 * reorders past it.
 *
 * ⚠ **IT HELD TWO EXPORTS UNTIL 2026-09-06.** `assertCreatorCanReadItBack` — the
 * standalone read-back refusal — is DELETED: {@link resolveCreateDestination}
 * absorbed its question when gap 2 of #1077 gave the create a destination, and
 * from that commit nothing imported the older gate. Its reasoning is not lost;
 * it is retired by name in the prose below, where the same refusal now lives.
 *
 * ⚠ NOT EXPORTED ANY FURTHER THAN THAT MODULE. This is not a general "knowledge
 * gate" surface: what is here is meaningful only before an insert that has not
 * happened yet.
 */

/**
 * 🔒 **A CREATE MUST NOT PRODUCE A ROW ITS OWN CREATOR CANNOT READ BACK** — the
 * authoring half of **F-323**, and the sentence the refusing arms of
 * {@link resolveCreateDestination} say when it would.
 *
 * ⚠ **ONE MESSAGE, TWO CALLERS**, both arms of that one function: the create
 * that names the ROOM (`shareToChannelId` or teams) and the one whose personal
 * reach comes back CLOSED. Two copies of a refusal is two refusals that stop
 * agreeing about the remedy. ⚠ The remaining throw there — the shelf asked for
 * BY NAME, `homeScoped` — is deliberately NOT this sentence: it raises
 * `personal-container.ts › personalShelfRefusal`, whose wording belongs to the
 * router. ⚠ It was three until 2026-09-06, when the standalone
 * `assertCreatorCanReadItBack` gate was deleted as caller-less; the reasoning
 * below is that gate's, kept because the refusal it guarded is still thrown here.
 *
 * THE SHAPE OF THE BUG. `resolveAgentAudience` answers `granted` for an agent
 * inside a `kind='link'` container that has a PEER in it: the only bases it may
 * reach are the ones carrying a channel GRANT. Every read composes that filter
 * (`service-bases.ts › listBases`/`getBaseById`/`getBaseBySlug`,
 * `service-entries.ts › resolveEntryRefs`). `createBase` composed NOTHING — the
 * comment where the guard first stood said "No agent gate on CREATE … the base
 * doesn't exist yet", which is true about the per-base agent-write toggle and
 * silently untrue about the ceiling.
 *
 * A NEW BASE HAS NO GRANT BY CONSTRUCTION, so under a `granted` audience the
 * insert succeeded, the tool answered "Created knowledge base … Private to
 * you", and the row was invisible to its creator from the very next call:
 * absent from `list_bases`, unresolvable by slug, unwritable. An agent that
 * cannot see the failure retries, so the observed report was two identical
 * successes and two orphaned rows.
 *
 * ⚠ **REFUSAL IS THE ONLY AVAILABLE ANSWER, NOT THE CAUTIOUS ONE.** The other
 * repair would be to grant the new base into the container's channel — but
 * `service-channel-grants.ts › setChannelKnowledgeGrant` refuses
 * `ctx.source === "agent"` outright (2026-08-27), because a grant decides what
 * the PEER standing in that room can read and that is a human's decision. So
 * the create-and-share path (`input.shareToChannelId`) is ALSO always a refusal
 * for an agent, and it already rolls the row back. This makes the plain create
 * behave the way the sharing create has behaved all along, one call earlier and
 * without writing a row first.
 *
 * ⚠ **IT CANNOT NARROW A HUMAN, A STANDARD WORKSPACE, OR A SOLO CONTAINER.**
 * Those are `resolveAgentAudience`'s three `unrestricted` branches, and the
 * ceiling "only ever closes" — so this refusal reaches exactly the population
 * for which the write was already useless. ⚠ It is deliberately NOT keyed on
 * `ctx.source === "agent"` alone: an agent in the operator's own workspace
 * creates bases it reads back perfectly well, and refusing there would delete a
 * working daily path to fix one that never worked.
 *
 * ⚠ The message names the ROOM and the REMEDY, because "forbidden" with no
 * cause is what sends an agent to grep the repo: the operator creates the base
 * (or shares an existing one into the channel) and the agent then reaches it.
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
 * 🔒 **WHERE A CREATE LANDS — GAP 2 OF #1077, AND THE ASKING SEAM THE ROUTER
 * WAS ALWAYS WAITING FOR.**
 *
 * `personal-container.ts › personalWriteWorkspaceId` has routed a create BY
 * AUTHOR since B15; what was missing is anything that ASKS it in a shared room.
 * The refusal above was the whole answer there, and #1077 calls that conclusion
 * wrong for a PERSONAL resource: *"a create with no valid container in a shared
 * room should go to the caller's own personal container, not refuse — personal
 * -visibility creates resolve their container by OWNER, never by call site."*
 *
 * ── The seam, in the order it decides ───────────────────────────────────────
 * ```
 * asked for the shelf (homeScoped)  → the fence answers; open lands personal,
 *                                     closed REFUSES (never downgrades)
 * audience unrestricted             → the calling container, exactly as today
 * audience restricted + reachable   → the caller's own personal container
 * audience restricted + closed      → today's refusal, with the new remedy
 * ```
 *
 * ⚠ **IT CHANGES NOTHING THAT WORKS TODAY.** The only creates it re-routes are
 * the ones the read-back gate was already refusing outright — an agent in a room
 * with somebody else in it — so no working path moves and no row that lands in
 * the calling container today lands anywhere else tomorrow.
 *
 * 🔒 **IT HALF-OPENS NOTHING, AND A4 INHERITS THIS.** The personal destination
 * is available only when `personal-reach.ts` answers OPEN, which in a shared
 * room means the owner has armed it. An unarmed room still refuses. The fence is
 * asked here rather than re-implemented, so an artifact create that adopts this
 * function inherits the same answer rather than a second opinion.
 *
 * ⚠ **THE READ-BACK QUESTION IS ANSWERED AT THE DESTINATION, WHICH IS THE WHOLE
 * REPAIR.** The retired standalone gate asked it of `ctx.workspaceId` — the room
 * — and a personal row does not land there. In the caller's own container the
 * answer is `unrestricted` by construction (one member, no grant filter), so an
 * OPEN fence IS the read-back guarantee for that row rather than a way around
 * the gate.
 *
 * ⚠ **REFUSING LOUDLY HERE IS NOT THE ORACLE THE FENCE FORBIDS.** That rule is
 * about READS: an unarmed room must answer what an empty one answers, or arming
 * state becomes readable through the surfaces it gates. A WRITE has no silent
 * form — "refuse, never downgrade" is `personal-container.ts`'s own rule — and
 * the only person who learns anything here is the OWNER, about their OWN shelf
 * and their OWN room. Nothing tells a peer anything.
 *
 * ⚠ **NOTHING HERE RE-GROWS THE GUESSED-CONTAINER FALLBACK B14 DELETED**
 * (invariant 1 of #1077; the concept is named nowhere on purpose —
 * `workspaces/b10-no-derived-default.test.ts` scans this file's prose too).
 * Nothing is guessed: the destination is the caller's own container, resolved by
 * owner, and it is the ONLY container a personal row can live in. A create that
 * cannot land there is refused, never widened.
 *
 * ⚠ **`shareToChannelId` AND TEAM GRANTS ARE NEVER RE-ROUTED.** Both name the
 * room in as many words — a channel grant and a team live in the calling
 * container — so a create carrying either keeps today's refusal instead of
 * quietly landing its row somewhere its grant cannot follow.
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
// ⚠ **MOVED HERE FROM `service-base-writes.ts` ON 2026-09-09** (the CHANGELOG
// lane), which measured 509 against §1's 500 cap and could not absorb the three
// lines the revision capture needed. The seam is this module's OWN header,
// applied: what is here answers a question about the CALLER before any row
// exists; what stays there composes a row and persists it. It is the second
// time that file has paid this cap and both splits chose the same line.
//
// ⚠ `service-base-writes.ts` RE-EXPORTS BOTH NAMES, so every importer — the
// route, the barrel and `service-create-audience.test.ts` — is unchanged.


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
 * ⚠ **THE PIN IT EXISTS FOR: A PREVIEW MUST NEVER HAND OUT A TOKEN FOR A CREATE
 * THE CONFIRMED CALL WOULD REFUSE.** The MCP confirm class
 * (`packages/mcp-server/src/tools/confirm-token.ts`) previews an audience
 * -changing create and mints a token the acting call echoes back. That preview
 * is minted in a DIFFERENT PROCESS from the gates, so it knew nothing about
 * them: `create_base` with `visibility:"public"` in an unarmed shared home
 * channel previewed happily, issued a token, and then the confirmed call was
 * refused by {@link resolveCreateDestination}. A preview that promises what the
 * gate forbids is worse than no preview — it is the surface telling the caller
 * the act was available.
 *
 * ⚠ **PARITY IS STRUCTURAL, NOT A SECOND LIST.** The dry run does not
 * re-implement, re-order or approximate these gates; it calls THIS function,
 * which is the same call `createBase` makes and the only place the chain is
 * written. A gate added below is inherited by the preview on the same commit,
 * which is the one property a hand-mirrored copy could never keep.
 *
 * ⚠ **IT STOPS EXACTLY WHERE THE WRITES BEGIN**, and that boundary is the
 * contract: everything here answers a question about the CALLER and touches no
 * row, so running it twice — once for the preview, once for the act — costs
 * reads and changes nothing. The slug read is deliberately BELOW the line: it
 * reads a container the caller may not be allowed to create in yet, and a dry
 * run must not report a slug collision against a base that nobody may see.
 *
 * ⚠ **A DRY RUN MUST SEND THE BODY THE CONFIRMED CALL WILL SEND**, including
 * `acknowledgeShared` — see the G16 call below. Previewing without it would
 * refuse on the missing acknowledgement, which is the very thing the preview
 * exists to obtain: the answer would be "no" to a question nobody asked.
 */
export async function assertCreateBaseAllowed(
  ctx: KnowledgeContext,
  input: KnowledgeBaseCreateInput,
): Promise<CreateBasePreconditions> {
  // 🔒 THE AUDIENCE CEILING, ASKED BEFORE THE INSERT rather than only by the
  // reads afterwards (F-323's authoring half) — see
  // `service-base-gates.ts`. ⚠ FIRST, before any other validation and
  // before the slug derivation's read: a caller that may not create here should
  // spend no round trips finding out, and must not be told about a slug
  // collision with a row it cannot see.
  //
  // 🔒 **AND IT IS NOW THE SAME CALL THAT DECIDES WHERE THE ROW LANDS** (gap 2
  // of #1077 — the asking seam). `resolveCreateDestination` composes that
  // ceiling question with the personal-shelf fence and answers WHICH CONTAINER;
  // it still refuses in every case the standalone read-back gate refused, and the
  // one thing it adds is that an agent whose operator has ARMED this room
  // creates on that operator's own shelf instead of being turned away.
  // ⚠ `wantsTeams` is read here rather than below because a teams create names
  // the calling container and must never be re-routed — see the gate.
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
  // ⚠ THE PREDICATE MOVED WITH `canSeeBase` ON 2026-08-27 (F-336) BECAUSE THE
  // COMMENT ABOVE IS THE WHOLE JUSTIFICATION FOR THE FENCE. A container-session
  // credential CAN read its own private rows back now, so the stranding it
  // guards against does not exist for it, and forcing 'public' would have the
  // operator's agent publish into the room the PEER is standing in — the
  // opposite of what this branch is for.
  const fromWorkspaceKey = isSharedCredential(ctx);
  // ⚠ ANNOTATED, NOT INFERRED, since this function now ANSWERS with it: the
  // inferred type carried `undefined` from `input.visibility`, and a caller
  // reading "undefined" as "whatever the server defaults to" is exactly the
  // credential-dependent guess `knowledge-ops-write.ts › opCreateBase` refuses
  // to make.
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
