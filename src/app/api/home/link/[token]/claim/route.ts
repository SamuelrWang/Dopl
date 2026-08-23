import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { claimLink } from "@/features/home/server/service-writes";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * POST — claim a link. Authed: the claimer must be somebody, since the whole
 * outcome is a workspace membership. Unknown token 404, dead link 410, own link
 * 400; a pair that already has a container gets it back with `existing: true`
 * and spends no use.
 */
export const POST = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const token = params?.token;
      if (!token) {
        return NextResponse.json(
          { error: { code: "MISSING_TOKEN", message: "token required" } },
          { status: 400 }
        );
      }
      return NextResponse.json(await claimLink(token, userId));
    } catch (err) {
      return toHttpErrorResponse("api/home/link/[token]/claim", err);
    }
  },
  // sessionOnly: the outcome is a workspace MEMBERSHIP, which is the
  // destructive-admin class the flag exists for.
  { sessionOnly: true }
);
