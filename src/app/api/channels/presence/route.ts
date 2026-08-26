import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  heartbeatPresence,
} from "@/features/channels/server/service";
import { PresenceHeartbeatSchema } from "@/features/channels/schema";

// Desktop heartbeat: upserts (user_id, workspace_id) with a fresh last_seen_at.
// Always keyed to `ctx.userId` — the subject is never a parameter.
//
// ⚠ THE FLOOR IS `guest`, NOT VIEWER, AND THIS COMMENT SAID VIEWER FOR A DAY
// (corrected 2026-08-26). See the export below.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, PresenceHeartbeatSchema);
    const ctx = buildChannelContext(auth);
    const presence = await heartbeatPresence(ctx, input.status);
    return NextResponse.json({ presence });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ `minRole: "guest"` — a guest is present in its channel and thus mentionable
// (INVARIANTS §4A, §2B; Samuel's Q2 ruling: guests appear in presence).
//
// ⚠ THERE IS NO CHANNEL-MEMBERSHIP FENCE HERE, AND THIS COMMENT CLAIMED ONE
// (corrected 2026-08-26 — it read "the channel-membership fence bounds the
// heartbeat to the caller's own channels"). `presence-service.ts ›
// heartbeatPresence` upserts a WORKSPACE-scoped `(user_id, workspace_id)` row
// unconditionally; it never sees a channel id and calls no `loadVisibleChannel`.
// §14: a comment asserting where a filter lives is not evidence the filter
// exists — open the somewhere else it names.
//
// WHAT ACTUALLY BOUNDS IT, and it is enough: the row is keyed to `ctx.userId`
// and `ctx.workspaceId`, both server-resolved, so the only thing a caller can
// write is "I am here, in a workspace I am a member of". `agent_presence`
// carries no content. The corresponding READ side is the RLS policy
// (`20260826120000_guest_channel_realtime_rls.sql`), which is workspace-scoped
// for the same reason — presence was never channel-scoped in either direction.
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
