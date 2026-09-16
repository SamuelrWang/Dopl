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
  listChannelArtifacts,
  readArtifact,
  removeFromArtifact,
} from "@/features/channels/server/service";
import { ArtifactActionSchema } from "@/features/channels/schema";
import { authorAgentIdOf } from "@/features/channels/lib/agent-post-stamp";

/**
 * `op="artifact"`'s transport — the four write actions, the single-card read
 * (design #1220 §5, accepted wholesale at #1222) and, since 2026-09-16, the
 * channel's artifact LIST (Samuel's artifacts-view ruling; `handleGet` carries
 * what that superseded).
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

/**
 * GET — the room's artifacts, or ONE card verbatim with `?artifact=<id>`.
 * ⚠ Visibility, not membership, on both arms.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const artifactId = request.nextUrl.searchParams.get("artifact");
    if (artifactId === null || artifactId.trim() === "") {
      // ⚠ **THIS ARM 400'd UNTIL 2026-09-16, AND THE REASON IT DID IS KEPT HERE
      // BESIDE THE REASON IT NO LONGER DOES.** Design #1220 §5 ruled a list "NOT
      // OFFERED … an artifact is found by reading the transcript it folds", so a
      // browse surface was a shape nothing asked for and "which id did you mean"
      // was the honest refusal. **Samuel 2026-09-16: artifact view lists the
      // room's cards** — the /home threads panel now toggles to an Artifacts face,
      // and the only other client-side source was the transcript's own page
      // envelope, which holds just the cards the loaded window happened to fold.
      // A list wearing "this channel's artifacts" over a clipped page is the
      // lying-control defect, so the lane is real rather than derived.
      // ⚠ The DESIGN'S GATE did not move with the ruling: `listChannelArtifacts`
      // runs the same `loadVisibleChannel` the single-card read does.
      const list = await listChannelArtifacts(
        buildChannelContext(auth),
        requireChannelId(auth.params)
      );
      // ⚠ `truncated` RIDES OUT HERE TOO (INVARIANTS §9) — the face prints it
      // beside the rows it clipped, never in a footer a skimmer drops.
      return NextResponse.json(list);
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
