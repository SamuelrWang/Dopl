import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import {
  buildOntologyContext,
  getSnapshot,
  getSummary,
} from "@/features/ontology/server/service";

/**
 * `?view=summary` — THE PROJECTION PARAMETER, and why it is a parameter rather
 * than a second route (P0-3).
 *
 * Both views answer the same question about the same resource — "what is in
 * this workspace's ontology" — and differ only in how much of each row comes
 * back. That is what a projection is, and splitting it into `/api/ontology` +
 * `/api/ontology/map` would give the two views separate auth wrappers, separate
 * error mapping and separate futures, for one resource whose shape is meant to
 * stay in lockstep. It also keeps the client contract additive: an existing
 * caller that sends nothing is byte-for-byte where it was.
 *
 * FULL IS THE DEFAULT, DELIBERATELY. The board and the graph view read
 * `attributes` / `methods` / `template` / `layout` straight off this response,
 * so a default that dropped them would not be a diet — it would be a silent
 * data loss on the two surfaces that consume it, and on the MCP ops
 * (`op="get"`, the attribute/action writes) that resolve an object out of the
 * snapshot. Anything wanting the cheap view has to say so; nothing gets a
 * thinner answer than it asked for.
 *
 * An unrecognised `view` is a 400, not a silent fall-through to `full`: the one
 * failure this parameter can have is a caller believing it opted into the cheap
 * read and quietly getting the expensive one.
 */
const VIEWS = ["full", "summary"] as const;

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const view = request.nextUrl.searchParams.get("view") ?? "full";
    if (!(VIEWS as readonly string[]).includes(view)) {
      throw HttpError.badRequest(`Unknown view. Use "full" (default) or "summary".`);
    }
    const ctx = buildOntologyContext(auth);
    const body = view === "summary" ? await getSummary(ctx) : await getSnapshot(ctx);
    return NextResponse.json(body);
  } catch (err) {
    return toHttpErrorResponse("ontology", err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
