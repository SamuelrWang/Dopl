import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import { requireChannelKnowledgeContext } from "@/shared/api/channel-knowledge-lane";
import { getGrantedBaseTree } from "@/features/knowledge/server/service-channel-lane";

/**
 * `GET /api/channels/{channelId}/knowledge/bases/{baseId}/tree` — folders and
 * entry METADATA for ONE base granted into this channel (Home Knowledge Panels
 * M2, §3.1). Bodies are not in this payload; one entry's body is the next route.
 *
 * ── The fences, in order (§3.2) ────────────────────────────────────────────
 *  1. `withWorkspaceAuth(..., {minRole:"guest"})` — the floor (tripwire).
 *  2. `loadVisibleChannel` + 🔒 `membership !== null` — see
 *     `shared/api/channel-knowledge-lane.ts`.
 *  3. The grant row at `visible` — `agent_only` and absent are ONE answer, 404.
 *  4. Base alive + same workspace.
 * Fences 3 and 4 are `service-channel-grants.ts › assertGrantVisible`, which the
 * lane service calls before it touches a folder or an entry row.
 *
 * ⚠ `{baseId}` IS ATTACKER-SUPPLIED AND IS NEVER USED TO LOOK A BASE UP FIRST.
 * The grant is read before the base, so this route cannot be walked to find out
 * which uuids name live bases in the container — every miss, of any kind, is the
 * same `KNOWLEDGE_BASE_NOT_FOUND`.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = auth.params?.baseId;
    if (!baseId) throw HttpError.badRequest("baseId is required");
    const ctx = await requireChannelKnowledgeContext(auth);
    return NextResponse.json(await getGrantedBaseTree(ctx, baseId));
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

// ⚠ `minRole: "guest"` — INVARIANTS §4A, and a deliberate entry in
// `channels/guest-route-floor.test.ts › GUEST_ALLOWED`.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
