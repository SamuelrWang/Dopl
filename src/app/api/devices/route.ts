import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { listComputers } from "@/features/devices/server/devices-service";
import { devicesDeps, requestInstallId } from "@/features/devices/server/runtime";

export const dynamic = "force-dynamic";

/** GET — the caller's computers (Settings > Connect > Devices). Glasses come from `/api/glasses/devices`. */
export const GET = withUserAuth(
  async (request, { userId }) => {
    try {
      const body = await listComputers(devicesDeps, userId, requestInstallId(request));
      return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
    } catch (err) {
      return toHttpErrorResponse("devices.list", err);
    }
  },
  { sessionOnly: true }
);
