import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  getLaunchDirective,
} from "@/features/channels/server/service";

/**
 * POLL ONE DIRECTIVE — what the MCP op's bounded hold reads while it waits for
 * the desktop to decide.
 *
 * ⚠ OWN-SCOPED IN THE REPOSITORY (`operator_user_id = ctx.userId`), and another
 * operator's directive answers 404 rather than 403 — a 403 would confirm the id
 * exists, which is the probe the single not-found error exists to prevent.
 *
 * ⚠ THE `status` IT RETURNS HAS LAZY EXPIRY APPLIED, so it may differ from the
 * stored column. There is no cron; `service-launch.ts › toDirective` is the one
 * place that decides, and every reader goes through it.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const id = auth.params?.directiveId ?? "";
    const directive = await getLaunchDirective(ctx, id);
    return NextResponse.json({ directive });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
