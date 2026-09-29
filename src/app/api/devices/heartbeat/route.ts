import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { heartbeat } from "@/features/devices/server/devices-service";
import { HeartbeatSchema } from "@/features/devices/server/schema";
import { devicesDeps, requestSessionId } from "@/features/devices/server/runtime";

export const dynamic = "force-dynamic";

/**
 * POST — a desktop registers itself and reports it is still here (`main/device-registry.js`,
 * riding the presence loop). Answers `{ device: { revoked: true } }` for a removed computer, which
 * the desktop takes as "sign out". ⚠ `sessionOnly`: only the signed-in app, never an agent token.
 */
export const POST = withUserAuth(
  async (request, { userId }) => {
    try {
      const [input, sessionId] = await Promise.all([
        parseJson(request, HeartbeatSchema),
        requestSessionId(request, userId),
      ]);
      const result = await heartbeat(devicesDeps, userId, input, sessionId);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return toHttpErrorResponse("devices.heartbeat", err);
    }
  },
  { sessionOnly: true }
);
