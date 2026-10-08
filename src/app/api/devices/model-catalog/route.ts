import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { PublishCatalogSchema } from "@/features/model-catalogs/contract";
import { upsertCatalog } from "@/features/model-catalogs/server/repository";

export const dynamic = "force-dynamic";

/**
 * `POST /api/devices/model-catalog` — the desktop publishes one runtime's live model catalog
 * (`dopl-desktop-app/main/catalog-publish.js`), so the server-side glasses menu can offer models
 * this person never launched. Labels and dimensions only (`features/model-catalogs/contract.ts`).
 *
 * ⚠ SESSION ONLY: an agent token may not rewrite what the operator's lens offers.
 * `{ stored: false }` = the table is not there yet (migration unapplied); the desktop retries later.
 */
export const POST = withUserAuth(
  async (request, { userId }) => {
    try {
      const input = await parseJson(request, PublishCatalogSchema);
      const result = await upsertCatalog(userId, input);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return toHttpErrorResponse("devices.model-catalog", err);
    }
  },
  { sessionOnly: true }
);
