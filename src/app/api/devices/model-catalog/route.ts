import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { PublishCatalogSchema } from "@/features/model-catalogs/contract";
import { upsertCatalog } from "@/features/model-catalogs/server/repository";
import { requestComputer } from "@/features/devices/server/devices-service";
import { devicesDeps, requestInstallId } from "@/features/devices/server/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /api/devices/model-catalog` — the desktop publishes one runtime's live model catalog
 * (`dopl-desktop-app/main/catalog-publish.js`), so the server-side glasses menu can offer models
 * this person never launched. Labels and dimensions only (`features/model-catalogs/contract.ts`).
 *
 * ⚠ SESSION ONLY: an agent token may not rewrite what the operator's lens offers.
 * `{ stored: false }` = the table is not there yet (migration unapplied), or the request names no
 * registered computer; the desktop retries on its next tick (its heartbeat registers it).
 *
 * ⚠ THE COMPUTER COMES FROM THE `X-Dopl-Device` HEADER, resolved to the caller's own active
 * `desktop_devices` row, never from the body: one Mac cannot publish under another's row.
 */
export const POST = withUserAuth(
  async (request, { userId }) => {
    try {
      const input = await parseJson(request, PublishCatalogSchema);
      const computer = await requestComputer(devicesDeps, userId, requestInstallId(request)).catch(() => null);
      if (!computer) {
        return NextResponse.json(
          { stored: false, reason: "unregistered-device" },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
      const result = await upsertCatalog(userId, computer.id, input);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return toHttpErrorResponse("devices.model-catalog", err);
    }
  },
  { sessionOnly: true }
);
