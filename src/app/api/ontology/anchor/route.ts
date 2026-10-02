import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { buildOntologyContext, getAnchor } from "@/features/ontology/server/service";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const object = await getAnchor(buildOntologyContext(auth));
    return NextResponse.json({ object });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

// 🔒 `minRole: "guest"` (2026-09-09, Samuel's home-ontology ruling; closes F-685):
// home-channel peers default to `guest`, so `guests_level` needs this floor. It
// grants nothing — `service-audience.ts › resolveOntologyAudience` answers `none`
// for a guest with no share (empty read). Listed in
// `channels/guest-route-floor.test.ts › GUEST_ALLOWED`.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
