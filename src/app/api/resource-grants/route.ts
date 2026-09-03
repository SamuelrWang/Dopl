import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { ResourceGrantWriteSchema } from "@/shared/grants/schema";
import { grantResource } from "@/shared/grants/service";

/**
 * `PUT /api/resource-grants` — **LEND ONE RESOURCE TO ONE SCOPE**, the door that
 * replaced `dopl_kb(op="copy_base")` and `dopl_agent(op="copy")` (Wave B slice
 * B15, Samuel's ruling B11: *grants replace copies*).
 *
 * ⚠ **ONE ROUTE, NOT ONE PER FEATURE.** `resource_grants` is one table with five
 * resource types (`20260914120000`, ruling B4); a per-feature door would be five
 * statements of one fence, which is exactly the shape §5A's mirror-list warnings
 * exist to refuse. The fences and their order live in `shared/grants/service.ts`.
 *
 * ── 🔒 WHY THIS IS NOT `sessionOnly`, AND WHY THAT IS NOT A REVERSAL ────────
 *
 * `PUT /api/knowledge/bases/{baseId}/channel-grants` IS `sessionOnly`, on the
 * argument that *an agent token must not be able to widen its own operator's
 * audience*. That route is **workspace-admin-or-creator** and carries
 * `guestWrite` — an admin may share ANOTHER member's base into a room, and hand
 * the people in it a pen. **This door is neither**: fence 2 refuses anything the
 * caller did not CREATE, and `guest_write` is not on its schema at all, so the
 * widest thing an agent can do here is lend its own operator's own row into a
 * room its own operator is already a member of at `member`+. That is the reach
 * the deleted copy ops already had — they created a whole new row in the target
 * — with the divergence removed.
 * ⚠ **IT IS THEREFORE NOT AN EDIT TO `write-gate-coverage.test.ts`'s pinned
 * `sessionOnly` SET**, and the channel-grants route keeps its gate: the app's
 * sharing panel still owns the three-state write, the `agent_only` audience and
 * `guestWrite`. **If this door ever learns `guest_write` or a foreign-resource
 * arm, it joins that set in the same change.**
 *
 * ⚠ **NO `GET` HERE, DELIBERATELY.** "Which scopes is this lent to" is a
 * per-resource question every feature already answers on its own surface
 * (`bases/{id}/channel-grants`, the teams access matrix); a second, generic
 * listing would be a fourth reader of one table with no consumer asking for it.
 */
async function handlePut(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ResourceGrantWriteSchema);
    const grant = await grantResource(auth, input);
    return NextResponse.json(grant);
  } catch (err) {
    return toHttpErrorResponse("PUT /api/resource-grants", err);
  }
}

// ⚠ `member` — lending is a write about other people's reach, and `viewer`
// administers nothing. Both sides are fenced again inside the service.
export const PUT = withWorkspaceAuth(handlePut, { minRole: "member" });
