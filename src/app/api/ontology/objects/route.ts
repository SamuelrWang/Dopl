import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  EntitlementError,
  entitlementDeniedBody,
} from "@/features/billing/server/entitlements";
import { LegacyTolerantObjectCreateSchema } from "@/features/ontology/legacy-aliases";
import { buildOntologyContext, createObject } from "@/features/ontology/server/service";

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    // LEGACY (≤ 1.36.0 desktops): the old parent key is re-keyed first — `legacy-aliases.ts`.
    const input = await parseJson(request, LegacyTolerantObjectCreateSchema);
    const object = await createObject(buildOntologyContext(auth), input);
    return NextResponse.json({ object }, { status: 201 });
  } catch (err) {
    // Free-plan object cap: actionable 403 upgrade envelope (MCP agents too), not a 500.
    if (err instanceof EntitlementError) {
      return NextResponse.json(entitlementDeniedBody(), {
        status: 403,
      });
    }
    return toHttpErrorResponse("ontology", err);
  }
}

// 🔒 `minRole: "guest"` (2026-09-09, Samuel's home-ontology ruling; F-685).
// ⚠ The floor is not the gate: `service-gates.ts › requireObject` demands
// `edit` on EVERY ontology the object belongs to (Q9); no share → 404. Shares,
// ontology create/delete and `agentsMayEdit` deliberately stay above guest.
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
