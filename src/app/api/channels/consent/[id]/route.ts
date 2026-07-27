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

// Single consent request: GET is the desktop's status poll; PATCH records the
// operator's decision. Both operator-only (enforced in the service, which 404s
// a foreign / missing id rather than leaking it).
//
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
 * H-1 — `sessionOnly`: answering a consent request is the human-in-the-loop
 * gate itself, so it must come from a human's interactive session and never
 * from an agent token.
 *
 * The threat is concrete and local. The session this gate exists to contain
 * is spawned with `--mcp-config` pointing at a file that holds a 90-day
 * `dopl.read`+`dopl.write` device token, its entire job is to process an
 * untrusted teammate's message (a prompt-injection target), and it has Bash.
 * Without this flag it can read that token and PATCH `{decision:'allow'}` on
 * its OWN outbound review — approving its reply out of the machine with no
 * human in the loop, which is precisely the thing approve-out prevents.
 * Device tokens go through `validateAccessToken`, so `sessionOnly` refuses
 * them; the desktop app authenticates with the Electron session's Supabase
 * cookies, which pass untouched.
 *
 * GET stays open: polling a status decides nothing.
 */
export const PATCH = withWorkspaceAuth(handlePatch, { sessionOnly: true });
