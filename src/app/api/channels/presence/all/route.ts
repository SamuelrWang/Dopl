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
 * ⚠ **WHY IT IS A SIBLING ROUTE AND NOT A SECOND ARM ON `../route.ts`.** Next
 * allows exactly one `POST` export per route file, and the per-workspace
 * heartbeat must keep working unchanged for older desktops (§13). So the two
 * live side by side, and the desktop picks: `main/presence-core.js` posts HERE
 * every tick and falls back to the per-workspace loop — in PARALLEL — only on a
 * 404 from this path.
 *
 * ⚠ **`withUserAuth`, NOT `withWorkspaceAuth`, AND THAT IS THE WHOLE FEATURE.**
 * There is no workspace in this operation. The old route needed an
 * `X-Workspace-Id` per call, which is exactly what forced the desktop into N
 * serial posts — the shape that made an operator in 13+ containers flicker
 * offline while their machine was awake. The membership set is read INSIDE the
 * statement (`presence_heartbeat_all`), so it is never a caller's claim.
 *
 * ⚠ **IT THEREFORE HAS NO WORKSPACE FLOOR AND MUST NOT GROW ONE.** It is
 * deliberately absent from `guest-route-floor.test.ts › GUEST_ALLOWED` (that
 * set enumerates `withWorkspaceAuth` floors) and it does NOT call
 * `resolveApiWorkspace`, so it is outside that file's family C as well. A GUEST
 * still heartbeats — through the row their own `workspace_members` entry
 * provides, in the RPC, at any rank — which is Samuel's Q2 ruling holding
 * unchanged and without a floor to place.
 *
 * ⚠ **THE ONLY THING A CALLER CONTROLS IS THE WORD `active` OR `away`.** The
 * subject is `userId` from the wrapper; `agent_presence` carries no content; the
 * container set is the database's answer. There is nothing here to fence.
 *
 * ⚠ **NO `apiKeyWorkspaceId` CEILING (R3), UNLIKE ITS `account/` SIBLINGS**, and
 * the asymmetry is deliberate: B1's container lock exists to stop a scoped
 * credential READING across an operator's workspaces. This route reads nothing
 * back — it writes "I am here" to rooms the caller is already a member of, which
 * every one of those rooms may already see. Narrowing it to the locked container
 * would make a scoped credential's machine flicker offline everywhere else,
 * which is the bug this route was built to remove.
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
    // `20260930140000` is written-not-applied (§12), so a server can legitimately
    // ship ahead of its database — and 404 is the ONE status the desktop reads as
    // "fall back to the per-workspace loop". A 500 here would make it retry this
    // path forever and never beat at all.
    return toChannelErrorResponse(err);
  }
}

export const POST = withUserAuth(handlePost);
