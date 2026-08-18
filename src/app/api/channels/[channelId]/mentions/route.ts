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

// THE MENTIONS INBOX. GET lists MY mentions in this channel; POST marks some of
// them read.
//
// ⚠ "MY" IS NOT A PARAMETER. Both handlers scope to `ctx.userId` inside the
// service and neither reads a subject from the body or the query — there is no
// shape of this request that asks about somebody else's inbox (INVARIANTS §6's
// discipline, applied to a second per-operator surface).
//
// NOT `sessionOnly`: marking your own mention read decides nothing, mutates no
// permission and cannot be destructive — it is the read-watermark class, not
// the containment-control class (INVARIANTS §3).
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const { mentions, truncated } = await listMyChannelMentions(
      ctx,
      requireChannelId(auth.params)
    );
    // `truncated` is ADDITIVE and load-bearing: the inbox is a record nothing
    // leaves, so a caller that cannot tell a clipped page from an exhausted one
    // will present a partial list as the whole one (INVARIANTS §9).
    return NextResponse.json({ mentions, truncated });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ ONE SHAPE FOR BOTH THE SINGLE CLICK AND MARK-ALL — mark-all sends the ids
// it is displaying rather than a flag, so the badge stays ONE derivation and a
// clipped page can only ever mark the page. See `schema-mentions.ts`.
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, MentionReadSchema);
    const ctx = buildChannelContext(auth);
    const { marked } = await markMentionsRead(
      ctx,
      requireChannelId(auth.params),
      input.messageIds
    );
    // 200, never 201: marking read is IDEMPOTENT and the second call created
    // nothing. `marked` counts ids ACCEPTED (mine, in this channel), not rows
    // inserted — a re-mark reports the state that holds, not a failure.
    return NextResponse.json({ marked });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
