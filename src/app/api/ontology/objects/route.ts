import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { OntologyObjectCreateSchema } from "@/features/ontology/schema";
import { buildOntologyContext, createObject } from "@/features/ontology/server/service";

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, OntologyObjectCreateSchema);
    const object = await createObject(buildOntologyContext(auth), input);
    return NextResponse.json({ object }, { status: 201 });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
