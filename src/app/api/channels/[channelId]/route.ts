import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse, channelWorkspace } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  deleteChannel,
  getChannel,
  updateChannel,
} from "@/features/channels/server/service";
import { ChannelUpdateSchema } from "@/features/channels/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const channel = await getChannel(ctx, requireChannelId(auth.params));
    return NextResponse.json({ channel });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * ⚠ FIELD-LEVEL `sessionOnly` (pinned by `src/shared/auth/write-gate-coverage.test.ts`):
 * this PATCH is several writes behind one verb that don't share a gate, so §9's
 * per-method gate would be wrong here. Read the array, not a count.
 *
 * - `visibility`: agents (`dopl_at_*`) may not change it — private→public exposes the
 *   channel and its history. Both directions gated (no MCP/desktop caller needs it).
 * - The responder nomination's per-member replacement (`unaddressed_responder`) is
 *   written via `PATCH /members`, sessionOnly for the whole method — still out of
 *   an agent credential's reach (self-authorizing lane, §6).
 * - `name` / `topic` / `archived`: manage-gated in the service (`canManageChannel`);
 *   credential and role fences are independent.
 * - `infoCard`: intentionally agent-writable, membership-gated (Samuel, 2026-08-25);
 *   gate + byte fence live in `service-writes.ts › updateChannel`.
 *
 * Session callers (cookie, Supabase JWT) never set `agentTokenId`.
 */
const SESSION_ONLY_FIELDS = ["visibility"] as const;

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const patch = await parseJson(request, ChannelUpdateSchema);
    const gated = SESSION_ONLY_FIELDS.filter((f) => patch[f] !== undefined);
    if (auth.agentTokenId && gated.length > 0) {
      throw new HttpError(
        403,
        "SESSION_REQUIRED",
        `Changing a channel's ${gated.join(", ")} requires an interactive Dopl ` +
          `session and can't be performed over an MCP connection. Sign in to ` +
          `the Dopl app to continue.`
      );
    }
    const ctx = buildChannelContext(auth);
    const channel = await updateChannel(ctx, requireChannelId(auth.params), patch);
    return NextResponse.json({ channel });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    await deleteChannel(ctx, requireChannelId(auth.params));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ GET at guest (INVARIANTS §4A, §2B); `loadVisibleChannel` is the true gate.
// PATCH/DELETE stay member+.
export const GET = withWorkspaceAuth(handleGet, { workspaceFromParams: channelWorkspace, minRole: "guest" });
export const PATCH = withWorkspaceAuth(handlePatch, { workspaceFromParams: channelWorkspace, minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { workspaceFromParams: channelWorkspace, minRole: "member" });
