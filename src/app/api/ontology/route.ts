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
 * `?view=summary` — a projection param, not a second route (one resource, one shape).
 *
 * ⚠ FULL is the default: the board, graph view and MCP ops read `attributes` / `methods` /
 * `template` / `layout` off this response — a thinner default is silent data loss.
 * ⚠ Unrecognised `view` → 400, never a fall-through to `full`.
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

// 🔒 `minRole: "guest"` (2026-09-09, Samuel's home-ontology ruling; closes F-685):
// home-channel peers default to `guest`, so `guests_level` needs this floor. It
// grants nothing — `service-audience.ts › resolveOntologyAudience` answers `none`
// for a guest with no share (empty read). Listed in
// `channels/guest-route-floor.test.ts › GUEST_ALLOWED`.
export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
