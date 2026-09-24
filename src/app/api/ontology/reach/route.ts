import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { buildOntologyContext, getReach } from "@/features/ontology/server/service";

/**
 * `GET /api/ontology/reach` — which ontologies the CALLING CREDENTIAL reaches in
 * the container it named, and at what rung. The producer F-681 was missing.
 *
 * ⚠ **ITS ONE CONSUMER IS THE DESKTOP'S PROMPT FRAMING**
 * (`dopl-desktop-app/main/ontology-reach.js` → `main/prompt-framing-ontology.js
 * › ontologyReachLines`), which is a COMPENSATING CONTROL and never a gate
 * (INVARIANTS §4A). Nothing here decides anything: the answer is
 * `service-audience.ts › levelForOntology` per ontology, the same function every
 * ontology read and write already asks.
 *
 * ⚠ **THE ANSWER IS THE CALLER'S, WHICH IS WHY THE DESKTOP PRESENTS THE SESSION'S
 * AGENT BEARER RATHER THAN THE OPERATOR'S COOKIE.** `buildOntologyContext`
 * derives `source` from the presence of an agent token, and the OWNER's own
 * agent is the one row of Samuel's matrix that is not simply its human's
 * (`agents_may_edit` / `owner_agents_level`). A cookie-authed call here would
 * answer the OPERATOR's rung and the framing would promise `EDIT` on a lane the
 * server refuses — over-promising, which is the failure direction that sends an
 * agent to guess.
 *
 * ⚠ **NO `?channelId=`.** The ceiling is resolved per CONTAINER and a home
 * channel is the one channel in its `kind='link'` container — `service-reach.ts
 * › getReach`'s docblock carries the argument.
 *
 * 🔒 `minRole: "guest"` — the same floor as the two ontology READ routes, and for
 * the same reason: a guest's agent is told what a guest reaches, which is the
 * half of Samuel's ruling F-685 closed. It grants nothing; a guest with no share
 * gets `[]`.
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
