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

// 🔒 `minRole: "guest"` (2026-09-09, Samuel's home-ontology ruling; closes F-685).
// A home channel's peer is admitted at the role the LINK grants and that
// DEFAULTS to `guest`, so at the `viewer` default the whole `guests_level`
// column was a word nobody could exercise. **THE FLOOR GRANTS NOTHING** — it
// only lets the request reach the fence that refuses it:
// `ontology/server/service-audience.ts › resolveOntologyAudience` answers `none`
// for a guest with no share and the read comes back EMPTY, exactly as a 404
// would. A deliberate entry in `channels/guest-route-floor.test.ts ›
// GUEST_ALLOWED`.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
