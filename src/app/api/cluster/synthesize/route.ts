/**
 * GET /api/cluster/synthesize — return the canonical skill synthesis
 * prompt + output template. No LLM call runs on our server.
 *
 * All brain synthesis happens in the user's Claude Code (or equivalent
 * client). This endpoint exists so any client that needs the prompt —
 * MCP via get_skill_template, the web UI's brain panel, etc. — can
 * fetch it consistently without embedding a copy of the template in
 * multiple codebases.
 *
 * The previous version of this route performed a server-side Claude
 * call to synthesize brain instructions. That was removed as part of
 * the pivot to client-only synthesis: we supply the prompt, the
 * agent runs the model.
 */

import { NextResponse } from "next/server";
import {
  SKILL_TEMPLATE_VERSION,
  SKILL_SYNTHESIS_PROMPT,
  SKILL_BODY_TEMPLATE,
  buildSkillTemplatePayload,
} from "@/shared/prompts/skill-template";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    version: SKILL_TEMPLATE_VERSION,
    prompt: SKILL_SYNTHESIS_PROMPT,
    template: SKILL_BODY_TEMPLATE,
    payload: buildSkillTemplatePayload(),
  });
}

// Kill the old POST handler. Anyone still calling this with a synthesis
// request gets an explicit 410 Gone so the failure mode is legible, not
// a silent shape mismatch. Callers should migrate to fetching the
// prompt here (GET) and running synthesis in their own context.
export async function POST() {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "Server-side brain synthesis has been removed. Fetch the synthesis prompt via GET /api/cluster/synthesize (or the `get_skill_template` MCP tool) and run synthesis in your own client, then write the result via PATCH /api/clusters/{slug}/brain.",
    },
    { status: 410 }
  );
}
