import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireConsentId, toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  decideConsentRequest,
  getConsentRequest,
} from "@/features/channels/server/service";
import { ConsentDecisionSchema } from "@/features/channels/schema";

// Single consent request: GET is the desktop's status poll, PATCH records the operator's
// decision. Both operator-only (the service 404s a foreign/missing id rather than leaking it).
// PATCH is `sessionOnly` — see the export at the bottom of this file.
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildChannelContext(auth);
    const consentRequest = await getConsentRequest(ctx, requireConsentId(auth.params));
    return NextResponse.json({ request: consentRequest });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, ConsentDecisionSchema);
    const ctx = buildChannelContext(auth);
    const consentRequest = await decideConsentRequest(
      ctx,
      requireConsentId(auth.params),
      input.decision,
      input.decidedBy
    );
    return NextResponse.json({ request: consentRequest });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
/**
 * ⚠ `sessionOnly`: answering a consent request IS the human-in-the-loop gate, so it must come
 * from an interactive session and never an agent token.
 *
 * The threat: the contained session is spawned with `--mcp-config` holding a 90-day
 * `dopl.read`+`dopl.write` device token, processes an untrusted teammate's message, and has Bash.
 * Ungated it reads that token and PATCHes `{decision:'allow'}` on its OWN outbound review —
 * approving its reply out of the machine with no human, which is exactly what approve-out
 * prevents. Device tokens go through `validateAccessToken`, so `sessionOnly` refuses them; the
 * desktop's Electron Supabase cookies pass untouched.
 *
 * GET stays open: polling a status decides nothing.
 */
export const PATCH = withWorkspaceAuth(handlePatch, { sessionOnly: true });
