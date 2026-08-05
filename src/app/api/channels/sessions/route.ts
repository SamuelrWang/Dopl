import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { SessionStateQuerySchema } from "@/features/channels/schema";
import {
  buildChannelContext,
  listSessionStates,
} from "@/features/channels/server/service";

// READ-SESSION-STATE (rollback §3.5). GET the CALLER'S OWN live sessions —
// "what is flint doing?" answered over MCP — optionally narrowed to one channel
// with `?channelId=<uuid>`. Read-only and own-scoped (the service keys on
// ctx.userId, RLS backs it), so any signed-in workspace member may call it
// (viewer floor). The WRITE half (the desktop pushing rows on state change) is
// a flagged delivery gap and is intentionally not a route here yet — see F-144.
//
// F-145, two fixes on one handler:
//  1. `?channelId=` IS VALIDATED. It used to go straight into `.eq()`, so a
//     non-uuid became a Postgres cast error and a 500 for what is plainly a
//     malformed request. A 400 naming the field is the honest answer, and it is
//     the same safeParse the consent inbox's identical param already did.
//  2. The empty answer is REAL. `channel_sessions` is unapplied, so this read
//     answered PGRST205 and the route returned INTERNAL_ERROR — while the
//     comment above claimed "[] until the push lands". The repository degrades
//     that ONE code (`repository-collab.listSessionStates`); every other DB
//     failure still reaches the caller as a failure.
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const parsed = SessionStateQuerySchema.safeParse({
      channelId: request.nextUrl.searchParams.get("channelId") || undefined,
    });
    if (!parsed.success) {
      throw new HttpError(
        400,
        "VALIDATION_FAILED",
        "Invalid query",
        parsed.error.issues
      );
    }
    const ctx = buildChannelContext(auth);
    const sessions = await listSessionStates(ctx, parsed.data.channelId);
    return NextResponse.json({ sessions });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
