import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import {
  buildChannelContext,
  loadVisibleChannel,
} from "@/features/channels/server/service";
import type { ChannelKnowledgeContext } from "@/features/knowledge/server/service-channel-grants";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { requireChannelId } from "./channel-route";

/**
 * 🔒 FENCE 2 OF THE GUEST KNOWLEDGE LANE (Home Knowledge Panels M2, plan §3.2),
 * and the ONLY place it is written. All four `(route, method)` pairs under
 * `src/app/api/channels/[channelId]/knowledge/**` call this first and do nothing
 * before it.
 *
 * It lives at the ROUTE layer because §3.3 forbids the composition anywhere
 * else: the CHANNELS service owns the membership fence, the KNOWLEDGE grant
 * service owns the payload, and neither feature may import the other. This
 * module is where the two meet, and it is a module rather than eight lines
 * copied into three handlers because a fence written three times is a fence that
 * drifts twice.
 *
 * ── The order (the ordering IS the contract) ────────────────────────────────
 *  1. `withWorkspaceAuth(..., {minRole:"guest"})` — at the route. A TRIPWIRE:
 *     it proves the caller is in the WORKSPACE, which for a container is nearly
 *     everyone the lane could possibly refuse.
 *  2. `loadVisibleChannel` — this file. Resolves the ref, hides a private
 *     channel from a non-member as NOT-FOUND.
 *  3. 🔒 `membership !== null` — this file, and the line the plan singled out as
 *     the one that will regress. See below.
 *  4/5. The grant row at `visible`, then base alive + same workspace — both in
 *     `knowledge/server/service-channel-grants.ts › assertGrantVisible`.
 *
 * ── 🔒 Why `membership !== null` is a fence and not a tidy-up ───────────────
 * `loadVisibleChannel` RETURNS SUCCESSFULLY WITH `membership: null`. That is its
 * PUBLIC ARM: a `visibility='public'` channel is readable by any workspace
 * member at `viewer`+ who never joined it. A guest does not inherit that arm
 * (`service-shared.ts › mayReadPublicChannels`, 2026-08-26) — but a workspace
 * VIEWER does, and F-327 says a public channel inside a `kind='link'` container
 * can exist: `createChannel` never reads `workspace.kind`, `POST /api/channels`
 * is `member`+ which the container's owner clears, the MCP `open` op exposes
 * `visibility`, and no DB constraint forbids it.
 *
 * So without this line, a workspace viewer who is NOT in the channel would reach
 * every knowledge base granted into it — a grant the operator made to the people
 * IN a room, read by somebody who only shares a tenancy with it. The eleven
 * other guest-floored channel routes are safe from that because their payload is
 * the channel's own content; this lane's payload is a whole knowledge base, so
 * the public arm is not a smaller leak here, it is a larger one.
 *
 * The refusal is the SAME 404 an unknown channel gets. "You are not in it",
 * "it is not yours to see" and "it is not there" must stay one answer, or the
 * lane enumerates the container.
 */
export async function requireChannelKnowledgeContext(
  auth: WorkspaceAuthContext
): Promise<ChannelKnowledgeContext> {
  const ref = requireChannelId(auth.params);
  let channelId: string;
  let workspaceId: string;
  try {
    const { channel, membership } = await loadVisibleChannel(
      buildChannelContext(auth),
      ref
    );
    // 🔒 THE LINE. See the docblock — `membership: null` is a SUCCESSFUL return
    // on the public arm, not an error the `catch` below would have caught.
    if (membership === null) throw channelNotFound(ref);
    channelId = channel.id;
    // Off the CHANNEL ROW, not off `auth`. They agree today (the resolver filters
    // by `ctx.workspaceId`), and taking the row's own value means the grant read
    // downstream is scoped by the same workspace the membership was proved in.
    workspaceId = channel.workspace_id;
  } catch (err) {
    // `ChannelNotFoundError` is the channels feature's own domain error, and the
    // lane's routes answer through `toKnowledgeErrorResponse` — which knows
    // nothing about it and would 500. Translated here, to the identical body the
    // membership refusal above produces.
    if (err instanceof HttpError) throw err;
    if (isChannelNotFound(err)) throw channelNotFound(ref);
    throw err;
  }

  return {
    workspaceId,
    channelId,
    userId: auth.userId,
    // Same derivation `buildKnowledgeContext` uses: an API key means an agent.
    // ⚠ Carried so `assertGrantWritable` can refuse one — NOT so anything on
    // this lane can widen for one.
    source: auth.agentTokenId ? "agent" : "user",
  };
}

function channelNotFound(ref: string): HttpError {
  return new HttpError(404, "CHANNEL_NOT_FOUND", `Channel not found: ${ref}`);
}

/** ⚠ Name-based rather than `instanceof`: this module sits between two features
 *  and a mocked or duplicated error module must not turn a 404 into a 500. */
function isChannelNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === "ChannelNotFoundError";
}
