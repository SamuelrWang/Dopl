import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { HttpError } from "@/shared/lib/http-error";
import {
  buildOntologyContext,
  getSnapshot,
  getSummary,
} from "@/features/ontology/server/service";
import { withLegacySnapshotKeys } from "@/features/ontology/legacy-aliases";

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
    // LEGACY (≤ 1.36.0 desktops): the old list keys beside the new — `legacy-aliases.ts`.
    return NextResponse.json(withLegacySnapshotKeys(body, auth.appVersion));
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
