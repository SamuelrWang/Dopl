import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { acknowledgeJoinNotice } from "@/features/workspaces/server/join-links";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

const AckSchema = z.object({ kind: z.enum(["pending", "resolved"]) });

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** POST — dismiss a join-request popup. */
export const POST = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const requestId = params?.requestId;
      if (!requestId) {
        return NextResponse.json({ error: "requestId required" }, { status: 400 });
      }
      const { kind } = await parseJson(request, AckSchema);
      await acknowledgeJoinNotice(userId, requestId, kind);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return toHttpErrorResponse("api/me/join-requests/[requestId]/ack", err);
    }
  }
);
