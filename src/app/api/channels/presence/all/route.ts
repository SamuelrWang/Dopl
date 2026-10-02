import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { heartbeatPresenceEverywhere } from "@/features/channels/server/service";
import { PresenceHeartbeatAllSchema } from "@/features/channels/schema";

/**
 * User-scoped presence heartbeat: one POST stamps `agent_presence` for every
 * container the caller is an active member of (Samuel, 2026-09-08).
 *
 * ⚠ Sibling route (not an arm on `../route.ts`) so the per-workspace heartbeat keeps
 * working for older desktops (§13); `main/presence-core.js` falls back to it only on 404.
 * ⚠ `withUserAuth` — per-call `X-Workspace-Id` forced N serial posts and offline
 * flicker. Membership is read inside `presence_heartbeat_all`, never claimed.
 * ⚠ No workspace floor and must not grow one (outside `guest-route-floor.test.ts`'s
 * sets); guests heartbeat in the RPC (Samuel's Q2 ruling).
 * ⚠ The caller controls only `active` | `away`.
 * ⚠ No `apiKeyWorkspaceId` ceiling (R3): this reads nothing back, and narrowing
 * would bring back the flicker.
 */
async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
): Promise<Response> {
  try {
    const input = await parseJson(request, PresenceHeartbeatAllSchema);
    const result = await heartbeatPresenceEverywhere(userId, input.status);
    return NextResponse.json(
      { presence: { status: result.status, workspaces: result.workspaceIds.length } },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    // ⚠ Missing RPC → 404 on purpose (`repository-collab.ts › upsertPresenceEverywhere`):
    // the one status the desktop reads as "fall back"; a 500 would never beat.
    return toChannelErrorResponse(err);
  }
}

export const POST = withUserAuth(handlePost);
