import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { heartbeatPresenceEverywhere } from "@/features/channels/server/service";
import { PresenceHeartbeatAllSchema } from "@/features/channels/schema";

/**
 * **THE USER-SCOPED PRESENCE HEARTBEAT** — one POST stamps `agent_presence` for
 * EVERY container the caller is an active member of (2026-09-08, Samuel's
 * Slack-parity ruling).
 *
 * ⚠ **A SIBLING ROUTE, NOT A SECOND ARM ON `../route.ts`**: Next allows one
 * `POST` export per file and the per-workspace heartbeat must keep working for
 * older desktops (§13). `main/presence-core.js` posts HERE every tick and falls
 * back to the per-workspace loop — in PARALLEL — only on a 404 from this path.
 *
 * ⚠ **`withUserAuth`, NOT `withWorkspaceAuth`, AND THAT IS THE WHOLE FEATURE.**
 * The old route's per-call `X-Workspace-Id` is what forced the desktop into N
 * serial posts, the shape that made an operator in 13+ containers flicker
 * offline while their machine was awake. The membership set is read INSIDE
 * `presence_heartbeat_all`, so it is never a caller's claim.
 *
 * ⚠ **IT THEREFORE HAS NO WORKSPACE FLOOR AND MUST NOT GROW ONE.** Deliberately
 * absent from `guest-route-floor.test.ts › GUEST_ALLOWED` and outside that
 * file's family C (it does not call `resolveApiWorkspace`). A GUEST still
 * heartbeats, in the RPC, at any rank — Samuel's Q2 ruling holding with no floor
 * to place.
 *
 * ⚠ **THE ONLY THING A CALLER CONTROLS IS THE WORD `active` OR `away`.** The
 * subject is `userId` from the wrapper; `agent_presence` carries no content; the
 * container set is the database's answer.
 *
 * ⚠ **NO `apiKeyWorkspaceId` CEILING (R3), UNLIKE ITS `account/` SIBLINGS.** B1's
 * container lock stops a scoped credential READING across workspaces; this route
 * reads nothing back, and narrowing it would make that machine flicker offline
 * everywhere else — the bug this route was built to remove.
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
    // ⚠ A DATABASE WITHOUT THE RPC ANSWERS 404 HERE, ON PURPOSE
    // (`repository-collab.ts › upsertPresenceEverywhere` throws the HttpError).
    // `20260930140000` is written-not-applied (§12), and 404 is the ONE status
    // the desktop reads as "fall back to the per-workspace loop"; a 500 would
    // make it retry this path forever and never beat at all.
    return toChannelErrorResponse(err);
  }
}

export const POST = withUserAuth(handlePost);
