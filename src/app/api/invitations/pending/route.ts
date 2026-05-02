import { NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import { listPendingInvitationsForUser } from "@/features/workspaces/server/invitations";

/**
 * GET /api/invitations/pending — list the current user's live workspace
 * invitations (unaccepted, unrevoked, unexpired). Powers the sidebar
 * notification badge + accept UI.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ invitations: [] });
  }
  const invitations = await listPendingInvitationsForUser(user.email);
  return NextResponse.json({ invitations });
}
