import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import { OntologyObjectUpdateSchema } from "@/features/ontology/schema";
import {
  buildOntologyContext,
  deleteObject,
  updateObject,
} from "@/features/ontology/server/service";

function objectIdOf(auth: WorkspaceAuthContext): string {
  const objectId = auth.params?.objectId;
  if (!objectId) throw HttpError.badRequest("Missing objectId");
  return objectId;
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, OntologyObjectUpdateSchema);
    const object = await updateObject(buildOntologyContext(auth), objectIdOf(auth), input);
    return NextResponse.json({ object });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    await deleteObject(buildOntologyContext(auth), objectIdOf(auth));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
