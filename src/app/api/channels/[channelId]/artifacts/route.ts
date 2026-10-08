import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse, channelWorkspace } from "@/shared/api/channel-route";
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
 * `op="artifact"` transport: four write actions, the single-card read (design
 * #1220 §5) and the channel's artifact list (Samuel, 2026-09-16).
 * ⚠ One route for the `{action, …}` discriminated union — not four paths.
 * ⚠ No authorization here: `service-artifacts.ts` holds the whole gate; a route
 * pre-check would be the second authority design §8 warns about.
 */

/**
 * GET — the room's artifacts, or ONE card verbatim with `?artifact=<id>`.
 * ⚠ Visibility, not membership, on both arms.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const artifactId = request.nextUrl.searchParams.get("artifact");
    if (artifactId === null || artifactId.trim() === "") {
      // List arm (Samuel, 2026-09-16, superseding design #1220 §5's "no list"):
      // a server list, because deriving it from the loaded transcript page would
      // be a clipped list posing as whole. Same `loadVisibleChannel` gate.
      const list = await listChannelArtifacts(
        buildChannelContext(auth),
        requireChannelId(auth.params)
      );
      // ⚠ `truncated` rides out (INVARIANTS §9).
      return NextResponse.json(list);
    }
    const ctx = buildChannelContext(auth);
    const result = await readArtifact(
      ctx,
      requireChannelId(auth.params),
      artifactId.trim()
    );
    // ⚠ `truncated` rides in the envelope, never dropped (INVARIANTS §9).
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
        // ⚠ Agent instance from the same stamp a post uses (`lib/agent-post-stamp.ts`);
        // null for a person.
        const authorAgentId = authorAgentIdOf({
          clientMsgId: input.clientMsgId ?? null,
          metadata: null,
        });
        const result = await createArtifact(ctx, ref, input, authorAgentId);
        // ⚠ Full result, not a count: `folded` may be shorter than `requested`
        // (missing seq, or already in another artifact).
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

// ⚠ Both at guest, like messages: the floor is a tripwire; the channel fence gates.
export const GET = withWorkspaceAuth(handleGet, { workspaceFromParams: channelWorkspace, minRole: "guest" });
export const POST = withWorkspaceAuth(handlePost, { workspaceFromParams: channelWorkspace, minRole: "guest" });
