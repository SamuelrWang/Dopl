import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import { requireChannelKnowledgeContext } from "@/shared/api/channel-knowledge-lane";
import { listGrantedBases } from "@/features/knowledge/server/service-channel-lane";
import type { ChannelResourceGrant } from "@/features/knowledge/types";

/**
 * `GET /api/channels/{channelId}/knowledge/bases` — THE KNOWLEDGE BASES SHARED
 * INTO THIS CHANNEL, as the channel's own members (guests included) may read
 * them. Entry point of the guest read lane (Home Knowledge Panels M2, §3.1).
 *
 * ⚠ THIS IS NOT `GET /api/knowledge/bases` WITH A CHANNEL FILTER. That route
 * answers "the bases YOUR WORKSPACE ROLE may see", and a guest's role resolves
 * to no access level at all. This one answers "the bases this CHANNEL was
 * granted", from the grant table alone — a different question with a different
 * gate, which is why it is a different route rather than a query parameter.
 *
 * ── The fences, in order (the ordering IS the contract, §3.2) ───────────────
 *  1. `withWorkspaceAuth(..., {minRole:"guest"})` — the workspace floor. A
 *     TRIPWIRE, and a deliberate entry in `channels/guest-route-floor.test.ts ›
 *     GUEST_ALLOWED` + INVARIANTS §4A.
 *  2. `loadVisibleChannel` with 🔒 `membership !== null` REQUIRED — in
 *     `shared/api/channel-knowledge-lane.ts`, which explains at length why the
 *     public arm is refused outright here.
 *  3. The grant row at `level='visible'`. `agent_only` is not a lower level, it
 *     is a different audience: those rows never enter the list.
 *  4. Base alive + same workspace.
 *
 * ── The payload ────────────────────────────────────────────────────────────
 * `{bases, grants}` — two sibling keys, `grants` keyed by base id, following the
 * `channelGrants` shape M0 put on the workspace list (INVARIANTS §9). Every
 * entry in `grants` is `level:"visible"`; it rides along for `guestWrite`, so a
 * surface can render a pen without asking again. An ungranted base is ABSENT
 * from both, never present with a level of `"none"`.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = await requireChannelKnowledgeContext(auth);
    const granted = await listGrantedBases(ctx);
    const grants: Record<string, ChannelResourceGrant> = {};
    for (const g of granted) grants[g.base.id] = g.grant;
    return NextResponse.json({ bases: granted.map((g) => g.base), grants });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

// ⚠ `minRole: "guest"` — the whole point of the lane (INVARIANTS §4A). The floor
// grants NOTHING on its own: the true gate is the channel-membership fence plus
// the grant row, both above.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
