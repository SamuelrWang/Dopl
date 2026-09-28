import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { removeComputer } from "@/features/devices/server/devices-service";
import { devicesDeps } from "@/features/devices/server/runtime";

export const dynamic = "force-dynamic";

/**
 * DELETE — remove a computer and revoke every credential it minted (its device token and its
 * container sessions). ⚠ `sessionOnly`: an agent must never revoke the machine it runs on.
 */
export const DELETE = withUserAuth(
  async (_request, { userId, params }) => {
    try {
      const result = await removeComputer(devicesDeps, userId, params?.deviceId ?? "");
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return toHttpErrorResponse("devices.remove", err);
    }
  },
  { sessionOnly: true }
);
