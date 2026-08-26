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

// ⚠ BOTH VERBS ARE AT `minRole: "guest"`, AND THE M1 COMMENT THAT USED TO SIT
// HERE HAD THE TWO BACKWARDS (corrected 2026-08-26). It said "POST lowered — a
// guest may @-mention" and "GET (marking a mention read)". Neither half was
// true: GET is `listMyChannelMentions` (READ my inbox) and POST is
// `markMentionsRead` (mark them read), and **@-mentioning is not this route at
// all** — a mention is parsed out of message TEXT by
// `channels/server/service-writes-metadata-mentions.ts`, so Samuel's Q2 ruling
// was already delivered by `POST …/messages`, which is separately guest-floored.
//
// The floors that are actually needed, each for its own reason:
//  - GET: the guest lane's Tags inbox is the guest's own mention list. It is
//    own-scoped by `ctx.userId` inside the service (see the docblock above —
//    "MY" is not a parameter), so a guest can only ever read their own rows.
//    Without this floor `useChannelMentions` 403s on EVERY guest mount.
//  - POST: marking your own mention read is the read-watermark class — it
//    decides nothing, mutates no permission and is bounded to the caller's own
//    rows by the same service scoping.
// The channel-membership fence is the true gate for both (INVARIANTS §4A/§2B).
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
