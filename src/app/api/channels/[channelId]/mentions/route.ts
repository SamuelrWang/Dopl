import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  listMyChannelMentions,
  markMentionsRead,
} from "@/features/channels/server/service";
import { MentionReadSchema } from "@/features/channels/schema-mentions";

// Mentions inbox: GET lists MY mentions in this channel; POST marks some read.
// ⚠ "My" is not a parameter — both scope to `ctx.userId` in the service (§6).
// Not `sessionOnly`: read-watermark class, not containment control (INVARIANTS §3).
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const { mentions, truncated } = await listMyChannelMentions(
      ctx,
      requireChannelId(auth.params)
    );
    // `truncated` is load-bearing (INVARIANTS §9).
    return NextResponse.json({ mentions, truncated });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ Mark-all sends the displayed ids, not a flag, so a clipped page only marks
// the page. See `schema-mentions.ts`.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, MentionReadSchema);
    const ctx = buildChannelContext(auth);
    const { marked } = await markMentionsRead(
      ctx,
      requireChannelId(auth.params),
      input.messageIds
    );
    // 200, never 201: idempotent. `marked` counts ids accepted, not rows inserted.
    return NextResponse.json({ marked });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ Both at guest (INVARIANTS §4A/§2B; channel fence is the true gate). GET: the
// guest's Tags inbox (else `useChannelMentions` 403s every guest mount). POST:
// read-watermark on own rows. @-mentioning itself is parsed from message text
// (`service-writes-metadata-mentions.ts`), not this route (Samuel's Q2 ruling
// is delivered by `POST …/messages`).
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
