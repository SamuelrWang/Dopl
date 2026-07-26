import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  pollChannelMessages,
  resolveReadableChannelId,
  revalidateAwaitAccess,
} from "@/features/channels/server/service";
import { AwaitQuerySchema } from "@/features/channels/schema";
import {
  AWAIT_POLL_INTERVAL_MS,
  DEFAULT_AWAIT_TIMEOUT_MS,
} from "@/features/channels/constants";

/**
 * Long-poll for new messages. Validates channel access up front, then polls
 * `seq > since` on a bounded loop (~1.5s interval, capped by `timeoutMs`
 * <= 50s) and returns as soon as anything arrives — else `{ messages: [],
 * timedOut: true }` so the caller re-polls with the same cursor. Each tick
 * re-checks access (channel not soft-deleted, membership not revoked) so a
 * mid-poll change ends the stream rather than leaking.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const search = request.nextUrl.searchParams;
    const parsed = AwaitQuerySchema.safeParse({
      since: search.get("since") ?? undefined,
      timeoutMs: search.get("timeoutMs") ?? undefined,
    });
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", "Invalid query", parsed.error.issues);
    }
    const { since, timeoutMs } = parsed.data;
    const deadline = Date.now() + (timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS);

    const ctx = buildChannelContext(auth);
    const channelId = await resolveReadableChannelId(
      ctx,
      requireChannelId(auth.params)
    );

    let messages = await pollChannelMessages(channelId, since);
    while (
      messages.length === 0 &&
      Date.now() < deadline &&
      !request.signal.aborted
    ) {
      await sleep(Math.min(AWAIT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
      // Re-check access every tick: a soft-delete or membership revocation
      // mid-poll throws ChannelNotFoundError (-> 404) and ends the poll.
      await revalidateAwaitAccess(ctx, channelId);
      messages = await pollChannelMessages(channelId, since);
    }
    return NextResponse.json({ messages, timedOut: messages.length === 0 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
