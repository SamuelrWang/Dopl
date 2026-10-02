import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { revokeLink } from "@/features/home/server/service-writes";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * DELETE — revoke a link. Creator only (else 404). SOFT: the row stays, so a
 * revoke never erases an existing relationship.
 */
export const DELETE = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const linkId = params?.linkId;
      if (!linkId) {
        return NextResponse.json(
          { error: { code: "MISSING_LINK_ID", message: "linkId required" } },
          { status: 400 }
        );
      }
      await revokeLink(userId, linkId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return toHttpErrorResponse("api/home/links/[linkId]", err);
    }
  },
  // sessionOnly: invalidates an account-entry credential.
  { sessionOnly: true }
);
