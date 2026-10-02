import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { buildOntologyContext, getReach } from "@/features/ontology/server/service";

/**
 * `GET /api/ontology/reach` — which ontologies the CALLING CREDENTIAL reaches in
 * the container it named, and at what rung. The producer F-681 was missing.
 *
 * ⚠ One consumer: the desktop's prompt framing
 * (`main/prompt-framing-ontology.js › ontologyReachLines`) — a compensating
 * control, never a gate (INVARIANTS §4A). The answer is
 * `service-audience.ts › levelForOntology`, the same check every read/write uses.
 *
 * ⚠ The desktop must call with the session's AGENT bearer, not the operator
 * cookie: the owner's agent rung can differ from its human's
 * (`owner_agents_level`), and answering the human's would over-promise `EDIT`.
 *
 * ⚠ No `?channelId=` — reach is per container (`service-reach.ts › getReach`).
 *
 * 🔒 `minRole: "guest"` like the ontology reads (F-685); grants nothing — a
 * guest with no share gets `[]`.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ontologies = await getReach(buildOntologyContext(auth));
    return NextResponse.json({ ontologies });
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
