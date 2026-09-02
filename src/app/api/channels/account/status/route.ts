import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { getAccountStatus } from "@/features/channels/server/service";
import { AccountStatusQuerySchema } from "@/features/channels/schema";

/**
 * **THE ACCOUNT-WIDE CHANNEL STATUS** — every channel the caller is in, across
 * every workspace AND every home-channel container, in ONE read (T20/T22).
 *
 * ⚠ **`withUserAuth`, AND IT COULD NOT BE `withWorkspaceAuth`.** That wrapper
 * resolves exactly one workspace and answers 400 `WORKSPACE_REQUIRED` to a
 * caller with 2+ standard memberships (INVARIANTS §4) — which is precisely the
 * caller this endpoint exists for. It also filters `kind='link'` containers out
 * of auto-targeting (§4A), so a home channel would be unreachable through it
 * even for a single-workspace caller. The fence is therefore the USER, exactly
 * as it is for `GET /api/home/channels`: every read below enters through
 * `channel_members.user_id = <caller>`, so a channel the caller does not belong
 * to is never NAMED by any query behind this route.
 *
 * ⚠ **NO `?workspaceId=` AND NO `X-Workspace-Id`.** A scoping parameter here
 * would be a second, narrower answer to the question the endpoint exists to
 * answer whole — the mistake `GET /api/home/overview` had to have surgically
 * removed (§4A, 2026-09-01). To scope to one workspace, use the per-workspace
 * reads that already exist.
 *
 * 🔒 **THE CONTAINER LOCK (B3) IS NOT APPLIED HERE.** A lock is a property of one
 * MCP CONNECTION, not of the credential, so — as for `/api/home/channels` — the
 * narrowing lives in the MCP layer (`packages/mcp-server/src/tools/home-scopes.ts
 * › narrowToLock`). A future non-MCP caller that skips it has rebuilt the
 * enumeration oracle B3 denies.
 *
 * ⚠ **THE SESSION HALF CARRIES OPERATOR-ONLY TELEMETRY**, which is safe only
 * because the session read is fenced on `user_id` (`repository-account.ts ›
 * listAccountSessionStates`). A peer's session never reaches this payload and no
 * argument here could ask for one.
 *
 * ⚠ NOT `sessionOnly` and NOT write-scoped: it is a READ, and an agent token is
 * the caller it is built for.
 */
async function handleGet(
  request: NextRequest,
  { userId }: { userId: string }
): Promise<Response> {
  try {
    const { since, view } = parseQuery(
      request.nextUrl.searchParams,
      AccountStatusQuerySchema,
      ["since", "view"]
    );
    const status = await getAccountStatus(userId, { since, view });
    return NextResponse.json(status, {
      // ⚠ Per-caller and volatile by construction — never cacheable.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withUserAuth(handleGet);
