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
 * `?view=summary` — a PROJECTION parameter, not a second route: both views answer the same
 * question about the same resource and differ only in how much of each row comes back. A split
 * would give them separate auth wrappers, error mapping and futures for one resource whose shape
 * must stay in lockstep.
 *
 * ⚠ FULL IS THE DEFAULT. The board and graph view read `attributes` / `methods` / `template` /
 * `layout` straight off this response, as do the MCP ops that resolve an object out of the
 * snapshot — a thinner default is silent data loss, not a diet.
 *
 * ⚠ An unrecognised `view` is a 400, never a fall-through to `full`: the one failure this
 * parameter can have is a caller believing it opted into the cheap read and getting the expensive
 * one.
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
