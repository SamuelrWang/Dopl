import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { meetsMinRole } from "@/features/workspaces/types";
// G16 — the one statement of the publish-into-a-peer's-room precondition,
// shared with `agent-identities/server/service-writes.ts`; two copies of a
// tenancy predicate is how the shelf fence ended up divergent (findings §6 #3).
import { assertSharedPublishAcknowledged } from "@/features/workspaces/server/shared-publish";
// The ONE statement of "a home channel holds only what is shared into it"
// (Samuel, 2026-09-18), shared with `agent-identities/server/service-writes.ts`
// for the same reason the line above it is shared.
import { assertHomeChannelRowIsShared } from "@/features/workspaces/server/home-channel-destination";
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
 * The gate a knowledge-base CREATE passes, and nothing else. What lives here
 * answers a question about the CALLER before any row exists; composing and
 * persisting the row is `service-base-writes.ts`. Not exported any further than
 * that module: it is meaningful only before an insert that has not happened yet.
 *
 * Retired names the docs still cite: `resolveHomeScope` (deleted 2026-09-02 with
 * the `home_scoped` column, replaced by
 * `shared/tenancy/personal-container.ts › personalWriteWorkspaceId`) and
 * `assertCreatorCanReadItBack` (deleted 2026-09-06, absorbed by
 * {@link resolveCreateDestination}).
 */

/**
 * A create must not produce a row its own creator cannot read back — F-323's
 * authoring half, said by both refusing arms of
 * {@link resolveCreateDestination}. ONE message for both: two copies of a
 * refusal stop agreeing about the remedy. The third throw there — the shelf
 * asked for BY NAME — is `personal-container.ts › personalShelfRefusal`.
 *
 * `resolveAgentAudience` answers `granted` for an agent in a `kind='link'`
 * container with a PEER in it, and every read composes that grant filter while
 * `createBase` composed none — so a fresh base was invisible to its creator from
 * the very next call. Refusal is the only answer available: the alternative
 * repair, granting the base into the container's channel, is human-only
 * (`service-channel-grants.ts › setChannelKnowledgeGrant`, 2026-08-27).
 *
 * It narrows nobody whose write worked — a human, a standard workspace and a
 * solo container are `resolveAgentAudience`'s `unrestricted` branches, so this is
 * not keyed on `ctx.source === "agent"` alone. The message names the room and the
 * remedy.
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
 * Where a create lands — gap 2 of #1077: a create with no valid container in a
 * shared room goes to the caller's own personal container rather than refusing;
 * personal-visibility creates resolve their container by OWNER, never by call
 * site. The only creates it re-routes are the ones already refused outright.
 *
 * The personal destination needs `personal-reach.ts` to answer OPEN — in a
 * shared room that means the owner armed it — and the fence is ASKED here rather
 * than re-implemented, so an adopting caller gets the same answer. The read-back
 * question is answered AT THE DESTINATION, not at `ctx.workspaceId`: the caller's
 * own container is `unrestricted` by construction, so an OPEN fence IS the
 * read-back guarantee.
 *
 * **NOTHING HERE GUESSES A CONTAINER** (invariant 1 of #1077;
 * `workspaces/b10-no-derived-default.test.ts` scans this file's prose): the
 * destination is resolved by owner and is the ONLY container a personal row can
 * live in. `shareToChannelId` and team grants are never re-routed — both name
 * the calling container, so a create carrying either keeps the refusal.
 */
export interface CreateDestination {
  /** The routing flag, passed straight to the repository. The router resolves
   *  the container, so this and `personalWriteWorkspaceId` cannot disagree: both
   *  ask `findPersonalContainerId` for the same owner. */
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
    // refuse, never downgrade — the caller asked for their shelf by name and the
    // workspace shelf is a different audience, not a lesser one. The sentence is
    // `personal-container.ts`'s so the router and its twin cannot diverge.
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
// Moved here from `service-base-writes.ts` on 2026-09-09 (§1's cap). That file
// RE-EXPORTS both names, so the route, the barrel and the tests are unchanged.

/** What {@link assertCreateBaseAllowed} decided, and {@link createBase} then
 *  writes with. Every field is a DECISION, not an echo of the input: the
 *  destination is resolved by owner, and the visibility is the value the row
 *  LANDS at after the teams branch has had its say. */
export interface CreateBasePreconditions {
  destination: CreateDestination;
  visibility: "public" | "private";
  teamGrants: NonNullable<KnowledgeBaseCreateInput["teamGrants"]>;
}

/**
 * Every pre-write gate of {@link createBase}, as one function, so a dry run can
 * run the gate the confirmed call runs:
 * `packages/mcp-server/src/tools/confirm-token.ts` previews in a DIFFERENT
 * PROCESS from the gates, so a public `create_base` in an unarmed shared home
 * channel previewed happily and was then refused. Parity is structural — the dry
 * run CALLS this rather than re-implementing the chain.
 *
 * It stops exactly where the writes begin, so running it twice changes nothing,
 * and the slug read stays BELOW the line: a dry run must not report a collision
 * against a base nobody may see. A dry run must send the body the confirmed call
 * will send, `acknowledgeShared` included.
 */
export async function assertCreateBaseAllowed(
  ctx: KnowledgeContext,
  input: KnowledgeBaseCreateInput,
): Promise<CreateBasePreconditions> {
  // The audience ceiling, asked before the insert rather than only by the reads
  // afterwards (F-323's authoring half), and the same call that decides where the
  // row lands (#1077 gap 2). FIRST, before any other validation and before the
  // slug read: a caller who may not create here must not be told about a
  // collision with a row it cannot see. `wantsTeams` is resolved here because a
  // teams create names the calling container and must never be re-routed.
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
  // (`canSeeBase` blocks such credentials from reading their own private rows
  // back, so a private one is stranded); session caller → 'private'.
  //
  // THE PREDICATE MOVED WITH `canSeeBase` ON 2026-08-27 (F-336): a
  // container-session credential CAN read its own private rows back, and forcing
  // 'public' would publish into the room the PEER is standing in.
  const fromWorkspaceKey = isSharedCredential(ctx);
  // annotated, not inferred, since this function ANSWERS with it: the inferred
  // type carried `undefined`, the guess `knowledge-ops-write.ts › opCreateBase`
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
  // belong to. `wantsTeams` is resolved at the top — the destination gate needs
  // it before any read.
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

  // G16 — publishing into the room a peer is standing in, on the RESOLVED
  // visibility: `accessMode: "teams"` rewrites it to `public`, and reading
  // `input.visibility` would let that rewrite publish unacknowledged. Before the
  // slug loop, so a refusal costs no slug and cannot half-land.
  await assertSharedPublishAcknowledged({
    // the container the row LANDS in, not the one the call stands in: a personal
    // row lands on a shelf with one member, so asking about the room would demand
    // an acknowledgement for an audience the row never reaches.
    workspaceId: destination.workspaceId,
    publishes: resolvedVisibility === "public",
    acknowledged: input.acknowledgeShared,
    noun: "knowledge base",
  });

  // 🔒 **THE THIRD DESTINATION DOES NOT EXIST** (Samuel, 2026-09-18) — a
  // `private`, ungranted base inside a home channel is listed by nothing: /home's
  // Knowledge face lists only the container bases carrying a channel grant, and a
  // container has no Knowledge page of its own. The twin of the same call in
  // `agent-identities/server/service-writes.ts`, one axis apart because the two
  // features answer "is it shared into the channel?" differently — a grant here,
  // the audience column there.
  // ⚠ THE DESTINATION, not the room: a personal row has already been re-routed
  // above and is destination 1, which this must not refuse.
  await assertHomeChannelRowIsShared({
    workspaceId: destination.workspaceId,
    shared:
      resolvedVisibility !== "private" || input.shareToChannelId !== undefined,
    noun: "knowledge base",
    remedy: "shareToChannelId",
  });

  return { destination, visibility: resolvedVisibility, teamGrants };
}
