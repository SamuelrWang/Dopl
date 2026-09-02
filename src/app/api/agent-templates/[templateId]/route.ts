import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import {
  requireTemplateId,
  toAgentTemplateErrorResponse,
} from "@/shared/api/agent-template-route";
import {
  buildAgentTemplateContext,
  deleteTemplate,
  readTemplateById,
  updateTemplate,
} from "@/features/agent-templates/server/service";
import { AgentTemplateUpdateSchema } from "@/features/agent-templates/schema";

/**
 * `GET | PATCH | DELETE /api/agent-templates/{templateId}`.
 *
 * ⚠ `sessionOnly` IS PER-METHOD AND ONLY `DELETE` CARRIES IT. GET and PATCH
 * stay reachable by an agent token on purpose — an orchestrator reads templates,
 * and letting it fix a typo in one is not a containment question. A DELETE is
 * permanent (no trash, no restore), it destroys something a whole team may be
 * spawning from, and an agent token has no confirm dialog to gate it — the same
 * argument that session-gates the team DELETE and the thread DELETE. Recorded
 * with that reasoning in `src/shared/auth/write-gate-coverage.test.ts`.
 *
 * ⚠ **AND THE READ AND THE WRITES NO LONGER RESOLVE THE ID THE SAME WAY (A12).**
 * GET goes through `readTemplateById`, so the id names its own container and a
 * `workspace=` that contradicts it is IGNORED. PATCH and DELETE stay on
 * `getTemplateById`, keyed to the workspace the caller was authorised in — a
 * write that followed an id across a tenancy boundary is a ruling nobody has
 * made.
 */

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentTemplateContext(auth);
    const template = await readTemplateById(
      ctx,
      requireTemplateId(auth.params)
    );
    return NextResponse.json({ template });
  } catch (err) {
    return toAgentTemplateErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentTemplateContext(auth);
    const id = requireTemplateId(auth.params);
    const patch = await parseJson(request, AgentTemplateUpdateSchema);
    const template = await updateTemplate(ctx, id, patch);
    return NextResponse.json({ template });
  } catch (err) {
    return toAgentTemplateErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentTemplateContext(auth);
    await deleteTemplate(ctx, requireTemplateId(auth.params));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toAgentTemplateErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});
