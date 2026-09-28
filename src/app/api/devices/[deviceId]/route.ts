import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { removeComputer, renameComputer } from "@/features/devices/server/devices-service";
import { devicesDeps, requestInstallId } from "@/features/devices/server/runtime";
import { RenameComputerSchema } from "@/features/devices/server/schema";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * PATCH `{name}` — rename a computer; null or "" restores the detected name. ⚠ `sessionOnly`, like
 * Remove: the name is stamped on every message sent from that computer (`metadata.source`).
 */
export const PATCH = withUserAuth(
  async (request, { userId, params }) => {
    try {
      const { name } = await parseJson(request, RenameComputerSchema);
      const result = await renameComputer(
        devicesDeps,
        userId,
        params?.deviceId ?? "",
        name,
        requestInstallId(request)
      );
      return NextResponse.json(result, NO_STORE);
    } catch (err) {
      return toHttpErrorResponse("devices.rename", err);
    }
  },
  { sessionOnly: true }
);

/**
 * DELETE — remove a computer and revoke every credential it minted (its device token and its
 * container sessions). ⚠ `sessionOnly`: an agent must never revoke the machine it runs on.
 */
export const DELETE = withUserAuth(
  async (_request, { userId, params }) => {
    try {
      const result = await removeComputer(devicesDeps, userId, params?.deviceId ?? "");
      return NextResponse.json(result, NO_STORE);
    } catch (err) {
      return toHttpErrorResponse("devices.remove", err);
    }
  },
  { sessionOnly: true }
);
