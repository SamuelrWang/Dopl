import "server-only";
import { personalShelfRefusal } from "@/shared/tenancy/personal-container";
import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
import type { KnowledgeContext } from "../types";
import { AgentWriteDisabledError } from "./errors";
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
