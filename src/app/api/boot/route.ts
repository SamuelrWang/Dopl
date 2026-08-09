import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getBootState } from "@/features/workspaces/server/segment";

export const dynamic = "force-dynamic";

const BootRequestSchema = z.object({
  /** Omit for a cold launch at `/`; pass the routed `{workspaceSlug}` to
   *  resolve a specific workspace (the shell, a deep link). */
  segment: z.string().trim().min(1).max(256).optional(),
});

/**
 * POST /api/boot — the ONE round trip a launch costs (launch-blocker P0-2c).
 *
 * Answers `{ isOnboarded, surveyCompleted, userId, workspace, segment,
 * needsRedirect, role, myAccess }`, collapsing four strictly serial hops
 * (`user/onboarding-state` → `workspaces/ensure-default` →
 * `workspaces/resolve` → `workspaces/me`, plus the shell's `my-access`) into
 * one composition (`getBootState`). Each of those endpoints stays live and
 * unchanged — the web app, `@dopl/client`'s MCP handshake and deep links keep
 * using them; this route is additive, not a replacement.
 *
 * POST because the no-segment mode may PROVISION (it is the same
 * `ensureDefaultWorkspace` the SPA already called). Idempotent by contract,
 * so it answers **200, never 201**, and the SPA models it as a query.
 *
 * FAIL-CLOSED (ENGINEERING §9 "Workspace resolution"): with a `segment` this
 * resolves that segment or 404s — membership-scoped, so "not a member" and
 * "does not exist" are indistinguishable — and never falls back to a default.
 * Without one it takes the documented provisioning path and nothing else.
 * Membership is proven server-side before `role`/`myAccess` are computed.
 */
export const POST = withUserAuth(async (request: NextRequest, { userId }) => {
  try {
    const input = await readBody(request);
    const state = await getBootState(userId, input.segment ?? null);
    if (!state) {
      return NextResponse.json(
        { error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" } },
        { status: 404 }
      );
    }
    // Audit A-010: per-user payload (role + effective access). Never let a
    // CDN cache it by URL alone.
    return NextResponse.json(state, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toHttpErrorResponse("api/boot", err);
  }
});

/**
 * The body is OPTIONAL — a cold launch posts nothing. An absent or empty body
 * is the no-segment mode, not a 400; anything present is still validated.
 */
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
