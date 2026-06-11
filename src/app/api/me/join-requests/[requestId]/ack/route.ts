import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { acknowledgeJoinNotice } from "@/features/workspaces/server/join-links";

const AckSchema = z.object({ kind: z.enum(["pending", "resolved"]) });

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** POST /api/me/join-requests/[requestId]/ack — dismiss a join-request popup. */
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
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);
