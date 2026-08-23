import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toAgentTemplateErrorResponse } from "@/shared/api/agent-template-route";
import {
  buildAgentTemplateContext,
  createTemplate,
  listTemplates,
} from "@/features/agent-templates/server/service";
import { AgentTemplateCreateSchema } from "@/features/agent-templates/schema";

/**
 * `GET /api/agent-templates`  — every template the caller may see.
 * `POST /api/agent-templates` — create one.
 *
 * ⚠ NOT `sessionOnly`, AND THAT IS THE POINT OF THE FEATURE. An orchestrator
 * agent holding an agent token must be able to LIST templates — asking "which
 * identities exist here" is the whole reason they are persistent. The
 * destructive verb is the one that is session-gated; see `[templateId]/route.ts`.
 *
 * ⚠ EACH ROW CARRIES ITS `visibility` SO THE CLIENT CAN GROUP. The server does
 * not group: which sections a surface wants (a spawn picker vs. a settings page)
 * is a rendering decision, and a pre-grouped payload imposes one of them on
 * every consumer.
 */

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentTemplateContext(auth);
    const templates = await listTemplates(ctx);
    return NextResponse.json({ templates });
  } catch (err) {
    return toAgentTemplateErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, AgentTemplateCreateSchema);
    const ctx = buildAgentTemplateContext(auth);
    const template = await createTemplate(ctx, input);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return toAgentTemplateErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
