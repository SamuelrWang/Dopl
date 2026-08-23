import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import {
  requireTemplateId,
  toAgentTemplateErrorResponse,
} from "@/shared/api/agent-template-route";
import {
  buildAgentTemplateContext,
  resolveTemplateForLaunch,
} from "@/features/agent-templates/server/service";

/**
 * `GET /api/agent-templates/{templateId}/resolve` — THE LAUNCH CONTRACT.
 *
 * The desktop calls this at spawn time, as the operator, and gets back the
 * flattened payload it needs to start an agent, and nothing else:
 *
 *   200 → { name, instructions, model, fields: [{key,value}],
 *           knowledgeBases: [{id,name}], authoredByCaller }
 *   404 → { error: { code: "AGENT_TEMPLATE_NOT_FOUND", message } }
 *
 * ⚠ THE MECHANISM, CORRECTED 2026-08-22 (G-2). This said the desktop calls it
 * "with its device token". It cannot: `dopl-desktop-app/main/api.js › apiFetch`
 * is COOKIE-authed, and the device token
 * (`main/mcp-config.js › deviceTokenForSpawn`) is the MCP bearer and nothing
 * else. Both resolve to the same `userId`, so the BEHAVIOUR the rest of this
 * block describes was right and only the mechanism was wrong.
 *
 * ⚠ WHY IT IS NOT JUST `GET /{id}`, since it returns a subset of that. A launch
 * payload and a template RECORD are different contracts with different lifetimes:
 * the record grows fields as the product does (sharing state, timestamps,
 * ownership, whatever the settings UI needs next), and the launcher must not have
 * to re-decide which of them matter every time. This endpoint is the promise that
 * those SIX keys are what starting an agent needs — a field added to
 * `AgentTemplate` does not appear here unless someone decides it belongs in a
 * launch.
 *
 * ⚠ `authoredByCaller` IS THE SIXTH, ADDED 2026-08-22 (G-1), AND IT IS THE ONE
 * OWNERSHIP-SHAPED FACT ON THIS PAYLOAD. The desktop's ROLE block wears a
 * different SECURITY HEADER for another member's instructions than for the
 * operator's own, and that gate cannot be built without it. A COMPUTED BOOLEAN,
 * never `createdBy`: the boolean discloses nothing the caller does not already
 * know from the list endpoint, and a raw creator id in a launch payload is a fact
 * the launcher has no use for. Full argument at
 * `service-reads.ts › resolveTemplateForLaunch`.
 *
 * ⚠ NOT `sessionOnly`, and it must not become so. The caller is a desktop that
 * may be presenting either credential this user holds; session-gating this would
 * refuse the only caller it exists for on the OAuth half.
 *
 * ⚠ IT IS GATED BY THE SAME VISIBILITY MATRIX AS EVERY OTHER READ (it composes
 * `getTemplateById`), so it is not a second, weaker door onto the row. Two
 * consequences the integration builder should expect rather than debug:
 *   1. a template the caller may not see is a 404 here, exactly as it is on the
 *      record endpoint — never a 403, which would confirm it exists;
 *   2. `knowledgeBases` is VIEWER-FILTERED, so two people resolving the SAME
 *      template can legitimately get different arrays. A shared template cannot
 *      be used to hand someone a pointer to a base they cannot read.
 *
 * `viewer` is enough: resolving is a read.
 */

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildAgentTemplateContext(auth);
    const resolved = await resolveTemplateForLaunch(
      ctx,
      requireTemplateId(auth.params)
    );
    return NextResponse.json(resolved);
  } catch (err) {
    return toAgentTemplateErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
