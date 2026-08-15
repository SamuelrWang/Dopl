import { NextRequest, NextResponse } from "next/server";
import { getInvitationByToken } from "@/features/workspaces/server/invitations";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/**
 * GET — an invitation's public status (workspace name, inviter email, role, still-live).
 * ⚠ Intentionally NOT auth-gated: the security property is the token's unguessability (256 bits).
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
    // Strip the token — the caller already has it in the URL.
    const { token: _omit, ...invitationWithoutToken } = status.invitation;
    void _omit;
    return NextResponse.json({
      ...status,
      invitation: invitationWithoutToken,
    });
  } catch (err) {
    return toHttpErrorResponse("api/workspaces/invitations/[token]", err);
  }
};
