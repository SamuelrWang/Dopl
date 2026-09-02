import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  getBaseById,
} from "@/features/knowledge/server/service";
import {
  canManageChannelGrants,
  getBaseGrantMap,
  setChannelKnowledgeGrant,
} from "@/features/knowledge/server/service-channel-grants";
import {
  buildChannelContext,
  listChannels,
} from "@/features/channels/server/service";
import { isChannelVisibleTo } from "@/features/workspaces/server/service-overview";
import { ChannelGrantWriteSchema } from "@/features/knowledge/schema";
import type {
  ChannelGrantChannelRef,
  ChannelResourceGrant,
} from "@/features/knowledge/types";

/**
 * `GET|PUT /api/knowledge/bases/{baseId}/channel-grants` — WHICH CHANNELS THIS
 * KNOWLEDGE BASE IS SHARED INTO, and the three-state write that changes one.
 * The inverse of `GET /api/knowledge/bases?channelId=`'s `channelGrants` map
 * (one channel, many KBs); same table, asked the other way round, and the
 * `resource_grants_resource_idx` index is named for exactly this query.
 *
 * ── The write contract ──────────────────────────────────────────────────────
 * `PUT` body `{channelId, level: "none"|"agent_only"|"visible", guestWrite?}`.
 * `"none"` DELETES the row — absence is the third state, never a stored
 * `'none'` — and the response says `grant: null` for it. The write states the
 * desired END STATE, so a retry after an ambiguous failure is idempotent
 * (`bases/[baseId]/star` makes the same argument with two verbs; here one verb
 * carries three states, so the third has to be spelled).
 *
 * ── 🔒 Why this route is `sessionOnly` ──────────────────────────────────────
 * IT HANDS CONTENT TO A PERSON. The precedent is `POST /api/home/links`
 * (INVARIANTS §3, §4A): creating a home CHANNEL is not session-gated because a
 * container the caller is alone in reaches nobody, while minting the LINK is,
 * because the link reaches a human being. A grant at `visible` is that same
 * line crossed from the other direction — it puts a knowledge base in front of
 * every member of a channel, GUESTS INCLUDED (the M2 channel lane reads exactly
 * these rows), and `guestWrite` additionally hands that person a pen. An agent
 * token must not be able to widen its own operator's audience: a `full`-profile
 * session has Bash, can read the 90-day device token off disk, and would
 * otherwise be one HTTP call from publishing the operator's knowledge base to a
 * guest and then editing it there.
 * ⚠ This is a CONSCIOUS edit to `src/shared/auth/write-gate-coverage.test.ts`'s
 * pinned `sessionOnly` set (25 → 26 route files, 2026-08-26). It is per-METHOD:
 * `GET` stays ungated, because reading which channels a base is already shared
 * into decides nothing and an orchestrator agent describing its own workspace
 * is a capability with a use.
 *
 * ── The fences, in order ────────────────────────────────────────────────────
 *  1. `withWorkspaceAuth` — workspace floor (`member` for the write; the
 *     `viewer` default for the read, which also refuses guests, §4A).
 *  2. `getBaseById` — 404s a base in another workspace or one the caller can't
 *     see, BEFORE the grant service runs. Visibility is not an oracle.
 *  3. `isChannelVisibleTo` — the body's `channelId` fenced against the caller's
 *     own visible channels, 404 on a miss (the `?channelId=` precedent, §9).
 *  4. `canManageChannelGrants` in the service — creator or workspace admin+,
 *     mirroring the sharing gate rather than the content-write gate.
 *  5. The `enforce_resource_grant()` trigger — 🔒 "the GRANTOR may share this"
 *     (`20260914120000`, ruling B4), which is a WIDER admission than the
 *     same-container equality it replaced: it accepts a channel in another
 *     container when the grantor reaches both. Unreachable while (2) and (3)
 *     hold — they fence both sides to the caller's own container — and
 *     translated to a 400 anyway, so a moved fence surfaces as "refused" rather
 *     than as an outage.
 */

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

function channelNotFound(): NextResponse {
  // ⚠ The SAME answer an unknown channel gets. "Cannot see" and "does not
  // exist" must stay indistinguishable, or the write becomes a channel oracle.
  return NextResponse.json(
    { error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found" } },
    { status: 404 }
  );
}

/**
 * The section's read: the caller's visible channels, this base's grants
 * INTERSECTED with them, and whether this caller may edit any of it.
 *
 * ⚠ THE CHANNEL LIST IS BUILT SERVER-SIDE, from the channels service's own
 * visibility statement (`service-reads.ts › listChannels`, archived excluded).
 * A client-side workspace channel list would put the names of rooms the caller
 * cannot read on the wire and then hide them in the renderer — the members-v2
 * ruling this codebase already made once.
 *
 * ⚠ Grants on channels OUTSIDE that list are DROPPED, not reported. The KB
 * owner may have shared into a private room they were since removed from; the
 * fail-safe direction is a shorter list, never a leaked name.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const base = await getBaseById(ctx, requireBaseId(auth));
    const [visible, grantsByChannel] = await Promise.all([
      listChannels(buildChannelContext(auth), false),
      getBaseGrantMap(ctx.workspaceId, base.id),
    ]);

    const channels: ChannelGrantChannelRef[] = visible.map((c) => ({
      id: c.id,
      // A DM's own `name` is internal plumbing; the peer is what a human reads.
      name: c.isDirect ? (c.directPeer?.displayName ?? c.name) : c.name,
      isDirect: c.isDirect,
    }));
    const grants: Record<string, ChannelResourceGrant> = {};
    for (const c of channels) {
      const grant = grantsByChannel[c.id];
      // ABSENT, never `{level:"none"}` — the map mirrors storage, where the
      // third state IS absence.
      if (grant) grants[c.id] = grant;
    }

    return NextResponse.json({
      canManage: canManageChannelGrants(ctx, base),
      channels,
      grants,
    });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePut(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const input = await parseJson(request, ChannelGrantWriteSchema);
    const ctx = buildKnowledgeContext(auth);
    // Fence the BASE first (404 for foreign or invisible), then the CHANNEL,
    // both before the service-role grant write.
    const base = await getBaseById(ctx, baseId);
    if (!(await isChannelVisibleTo(ctx.workspaceId, ctx.userId, input.channelId))) {
      return channelNotFound();
    }
    const grant = await setChannelKnowledgeGrant(ctx, base, input);
    // `grant: null` IS the answer for `level:"none"` — the client removes the
    // key rather than storing a level.
    return NextResponse.json({ channelId: input.channelId, grant });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
// 🔒 `sessionOnly` — see the docblock. Per-METHOD: the GET above is ungated.
export const PUT = withWorkspaceAuth(handlePut, {
  minRole: "member",
  sessionOnly: true,
});
