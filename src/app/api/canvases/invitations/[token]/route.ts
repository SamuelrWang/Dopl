import { NextRequest, NextResponse } from "next/server";
import { getInvitationByToken } from "@/features/canvases/server/invitations";

/**
 * GET /api/canvases/invitations/[token] — fetch the public-facing
 * status of an invitation: the canvas name, inviter email, role being
 * granted, and whether the link is still live.
 *
 * Intentionally NOT auth-gated. Anyone with the token can read it; the
 * security property is the token's unguessability (256 bits of entropy).
 * The ACCEPT endpoint requires auth.
 */
export const GET = async (
  _request: NextRequest,
  context: { params: Promise<{ token: string }> }
) => {
  const { token } = await context.params;
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  try {
    const status = await getInvitationByToken(token);
    if (!status) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 }
      );
    }
    // Strip the token from the public payload — the caller already has
    // it (it's in the URL). No need to echo it back.
    const { token: _omit, ...invitationWithoutToken } = status.invitation;
    void _omit;
    return NextResponse.json({
      ...status,
      invitation: invitationWithoutToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
