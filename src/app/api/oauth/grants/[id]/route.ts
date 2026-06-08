import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { revokeGrant } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/oauth/grants/[id] — revoke a connected app. Scoped to the
 * owner (revokeGrant filters by user_id), so a user can only revoke their
 * own grants. The client's next /api/mcp call then 401s and it re-auths.
 */
export const DELETE = withUserAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await revokeGrant(id, userId);
  return NextResponse.json({ ok: true });
});
