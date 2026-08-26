import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getBootState } from "@/features/workspaces/server/segment";

export const dynamic = "force-dynamic";

const BootRequestSchema = z.object({
  /** Omit for a cold launch at `/`; pass the routed `{workspaceSlug}` for a specific workspace. */
  segment: z.string().trim().min(1).max(256).optional(),
});

/**
 * POST /api/boot — the ONE round trip a launch costs. Answers `{ isOnboarded, surveyCompleted,
 * userId, workspace, segment, needsRedirect, role, myAccess }`, collapsing four serial hops
 * (`user/onboarding-state` → `workspaces/ensure-default` → `workspaces/resolve` →
 * `workspaces/me`, plus `my-access`) into one `getBootState`. Additive: all four stay live.
 *
 * POST because the no-segment mode may PROVISION. Idempotent by contract ⇒ 200, never 201.
 *
 * ⚠ FAIL-CLOSED (ENGINEERING §9 "Workspace resolution"): with a `segment` it resolves that
 * segment or 404s (membership-scoped, so non-member and nonexistent are indistinguishable) and
 * NEVER falls back to a default. Membership is proven server-side before `role`/`myAccess`.
 *
 * 🔒 ⚠ AND THE CONTAINER LOCK RIDES ALONG (2026-08-26). This route took NO segment and answered
 * the operator's HOME workspace id + canonical segment to anything holding a valid credential —
 * including a container-locked child token, for which that is the FIRST STEP of walking out of
 * the container: learn the segment here, then hit the 19 `resolveApiWorkspace` routes with it.
 * `apiKeyWorkspaceId` is threaded into `getBootState`, which refuses the provisioning mode
 * outright for a locked caller and fences the segment mode through the resolver's own lock.
 */
export const POST = withUserAuth(async (request: NextRequest, { userId, apiKeyWorkspaceId }) => {
  try {
    const input = await readBody(request);
    const state = await getBootState(userId, input.segment ?? null, apiKeyWorkspaceId);
    if (!state) {
      return NextResponse.json(
        { error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" } },
        { status: 404 }
      );
    }
    // ⚠ Per-user payload (role + effective access) — never CDN-cacheable by URL alone.
    return NextResponse.json(state, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toHttpErrorResponse("api/boot", err);
  }
});

/** ⚠ Body is OPTIONAL: absent/empty is the no-segment mode, not a 400. Present bodies validate. */
async function readBody(request: NextRequest): Promise<z.infer<typeof BootRequestSchema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {};
  }
  if (raw === null || raw === undefined) return {};
  const parsed = BootRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      400,
      "VALIDATION_FAILED",
      "Request body failed validation",
      parsed.error.issues
    );
  }
  return parsed.data;
}
