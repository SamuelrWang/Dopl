import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  EntitlementError,
  entitlementDeniedBody,
} from "@/features/billing/server/entitlements";
import { OntologyObjectCreateSchema } from "@/features/ontology/schema";
import { buildOntologyContext, createObject } from "@/features/ontology/server/service";

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, OntologyObjectCreateSchema);
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

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
