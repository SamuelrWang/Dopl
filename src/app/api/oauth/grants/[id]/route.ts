import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { revokeGrant } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/** DELETE — revoke a connected app. Owner-scoped (`revokeGrant` filters by user_id); the
 *  client's next /api/mcp call 401s and it re-auths. */
export const DELETE = withUserAuth(
  async (_request, { userId, params }) => {
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    await revokeGrant(id, userId);
    return NextResponse.json({ ok: true });
  },
  // ⚠ sessionOnly: an agent token must never revoke grants — its own or a sibling's.
  { sessionOnly: true }
);
