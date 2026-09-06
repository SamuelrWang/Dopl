import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  addToArtifact,
  buildChannelContext,
  createArtifact,
  dissolveArtifact,
  readArtifact,
  removeFromArtifact,
} from "@/features/channels/server/service";
import { ArtifactActionSchema } from "@/features/channels/schema";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";

/**
 * `op="artifact"`'s transport — the four write actions and the single-card read
 * (design #1220 §5, accepted wholesale at #1222).
 *
 * ⚠ **ONE ROUTE, FOUR ACTIONS, BECAUSE THE SCHEMA IS ONE DISCRIMINATED UNION.**
 * Four endpoints would be four places to forget the channel ref, and the wire
 * shape the design specified is `{action, …}` — the route's job is to hand that
 * to the service unchanged, not to re-spell it as paths.
 *
 * ⚠ **NO AUTHORIZATION DECISION IS MADE HERE.** `service-artifacts.ts` holds the
 * whole gate (membership to write, visibility to read, creator-only dissolve,
 * author-or-creator un-box). A route that pre-checked any of it would be the
 * second authority the design's §8 warns about, and the two would drift.
 */

/** GET ?artifact=<id> — open ONE card verbatim. ⚠ Visibility, not membership. */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const artifactId = request.nextUrl.searchParams.get("artifact");
    if (artifactId === null || artifactId.trim() === "") {
      // ⚠ A LIST OF THE ROOM'S ARTIFACTS IS NOT OFFERED, and that is the design
      // rather than an omission: an artifact is found by reading the transcript
      // it folds. Answering "which id did you mean" beats inventing a browse
      // surface nothing asked for.
      return NextResponse.json(
        { error: "Name one artifact: ?artifact=<id>" },
        { status: 400 }
      );
    }
    const ctx = buildChannelContext(auth);
    const result = await readArtifact(
      ctx,
      requireChannelId(auth.params),
      artifactId.trim()
    );
    // ⚠ `truncated` RIDES IN THE ENVELOPE and is never dropped: at the ceiling
    // is indistinguishable from over it (INVARIANTS §9), and a clipped member
    // list that renders like an exhausted one is the bug.
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/** POST — create / add / remove / dissolve. */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ArtifactActionSchema);
    const ctx = buildChannelContext(auth);
    const ref = requireChannelId(auth.params);
    switch (input.action) {
      case "create": {
        // ⚠ **THE AGENT INSTANCE IS READ OFF THE SAME STAMP A POST USES**
        // (`lib/agent-post-stamp.ts`), so "which agent made this card" is
        // answered by the one resolver that answers it for messages. Null for a
        // person pressing a button, which is the honest answer for them.
        const authorAgentId = authorAgentIdOf({
          clientMsgId: input.clientMsgId ?? null,
          metadata: null,
        });
        const result = await createArtifact(ctx, ref, input, authorAgentId);
        // ⚠ 201 AND THE FULL RESULT: `folded` may be SHORTER than `requested`
        // (a seq that does not exist, or is already in another artifact), and
        // reporting a count alone would let a caller believe it boxed a run it
        // only half boxed.
        return NextResponse.json(result, { status: 201 });
      }
      case "add":
        return NextResponse.json(await addToArtifact(ctx, ref, input));
      case "remove":
        return NextResponse.json(await removeFromArtifact(ctx, ref, input));
      case "dissolve":
        return NextResponse.json(await dissolveArtifact(ctx, ref, input));
    }
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ BOTH at `minRole: "guest"`, exactly like the messages route: the workspace
// floor is a tripwire and the real gate is the channel fence in the service.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
