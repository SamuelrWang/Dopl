import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { meetsMinRole } from "@/features/workspaces/types";
// Both shared with `agent-identities/server/service-writes.ts`: one copy of each tenancy predicate.
import { assertSharedPublishAcknowledged } from "@/features/workspaces/server/shared-publish";
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
 * The knowledge-base CREATE gate: questions about the caller before any row exists; persisting is
 * `service-base-writes.ts`.
 */

/**
 * A create must not produce a row its creator cannot read back (F-323): an agent in a shared room
 * reads only channel-granted bases, and granting is human-only. One message for both refusing arms.
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
 * Where a create lands. A create the shared room would refuse goes to the caller's personal container
 * instead, by owner and only when `personal-reach.ts` answers open; nothing guesses a container.
 * `shareToChannelId` and team grants name the calling container, so they keep the refusal.
 */
export interface CreateDestination {
  /** Routing flag; resolves the same owner container `personalWriteWorkspaceId` does. */
  homeScoped: boolean;
  /** Where the row lands (for the slug read and the rollback); `ctx.workspaceId` unless personal. */
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
    // Refuse, never downgrade: the workspace shelf is a different audience, not a lesser one.
    throw personalShelfRefusal(reach.refusal);
  }

  const audience = await resolveAgentAudience(ctx);
  if (audience.kind === "unrestricted") return room;
  // A create that names the room keeps the read-back refusal; anything else may follow its owner.
  if (input.shareToChannelId !== undefined || input.wantsTeams === true) {
    throw personalShelfUnreachableInRoom();
  }
  const reach = await resolvePersonalReach(ctx);
  if (reach.kind === "closed") throw personalShelfUnreachableInRoom();
  return { homeScoped: true, workspaceId: reach.containerId };
}

/** Decisions, not input echoes: the resolved destination and the visibility the row lands at. */
export interface CreateBasePreconditions {
  destination: CreateDestination;
  visibility: "public" | "private";
  teamGrants: NonNullable<KnowledgeBaseCreateInput["teamGrants"]>;
}

/**
 * Every pre-write gate of `createBase`, so the MCP dry run (another process) calls the same chain.
 * Side-effect free and above the slug read: a dry run must not report a collision on an invisible base.
 */
export async function assertCreateBaseAllowed(
  ctx: KnowledgeContext,
  input: KnowledgeBaseCreateInput,
): Promise<CreateBasePreconditions> {
  // First, before the slug read: a caller who may not create here must not learn of a collision (F-323).
  const wantsTeams = input.accessMode === "teams";
  const destination = await resolveCreateDestination(ctx, {
    homeScoped: input.homeScoped,
    shareToChannelId: input.shareToChannelId,
    wantsTeams,
  });

  // No agent-write gate here: that toggle is per-base and the base doesn't exist yet.
  // Same predicate as `canSeeBase` (F-336): a shared credential can't read private rows back.
  const fromWorkspaceKey = isSharedCredential(ctx);
  let resolvedVisibility: "public" | "private";
  if (fromWorkspaceKey) {
    if (input.visibility === "private") {
      throw new WorkspaceKeyPrivateVisibilityError();
    }
    resolvedVisibility = input.visibility ?? "public";
  } else {
    resolvedVisibility = input.visibility ?? "private";
  }

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

  // On the RESOLVED visibility (teams rewrites it to public); before the slug loop, so no slug is spent.
  await assertSharedPublishAcknowledged({
    // The container the row lands in: a personal shelf has one member, so nothing is owed.
    workspaceId: destination.workspaceId,
    publishes: resolvedVisibility === "public",
    acknowledged: input.acknowledgeShared,
    noun: "knowledge base",
  });

  // A private, ungranted base in a home channel is listed nowhere. Asked of the destination,
  // so a re-routed personal row passes.
  await assertHomeChannelRowIsShared({
    workspaceId: destination.workspaceId,
    shared:
      resolvedVisibility !== "private" || input.shareToChannelId !== undefined,
    noun: "knowledge base",
    remedy: "shareToChannelId",
  });

  return { destination, visibility: resolvedVisibility, teamGrants };
}
