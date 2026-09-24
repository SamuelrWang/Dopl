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
    // Free-plan object cap is freeze-don't-delete: surface the upgrade envelope (message +
    // upgrade_url) so clients — MCP agents included — get an actionable 403, not a 500.
    if (err instanceof EntitlementError) {
      return NextResponse.json(entitlementDeniedBody(), {
        status: 403,
      });
    }
    return toHttpErrorResponse("ontology", err);
  }
}

// 🔒 `minRole: "guest"` (2026-09-09, Samuel's home-ontology ruling; closes
// F-685). "are guests access/view or edit" — `edit` is half of that ruling, so
// the object/relationship/membership writes carry the same floor as the reads.
// ⚠ THE FLOOR IS THE WEAKEST FENCE HERE, not the gate: `service-gates.ts ›
// requireObject` demands `edit` on EVERY ontology the object belongs to (Q9),
// resolved from DB facts, and a guest whose share says `view` — or who has no
// share — gets the same 404 they got before this floor existed. ⚠ The SHARE
// lane, ontology create/delete and the `agentsMayEdit` toggle deliberately did
// NOT move: a guest lends nothing and re-widens nobody's agents.
export const POST = withWorkspaceAuth(handlePost, { minRole: "guest" });
