import { NextRequest, NextResponse } from "next/server";
import { ProviderSchema } from "@/features/integrations/schema";
import { finalizeConnectionCallback } from "@/features/integrations/server/service";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * GET /api/integrations/[provider]/callback
 *
 * Public endpoint hit after the broker finishes the provider's OAuth
 * flow. Our `callbackUrl` (configured at `initiate` time) carries
 * `workspace_id` and `user_id` as query params — those identify which
 * `oauth_connections` row to mark as connected. The broker connection
 * id is already on the row (we wrote it during initiate), so the
 * service re-verifies status against the broker and flips the row.
 *
 * On success: 302 to /connect/[provider]/done (Dopl-branded).
 * On failure: 302 to /connect/[provider]/error?reason=...
 */
export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ provider: string }> }
): Promise<Response> {
  const { provider: rawProvider } = await routeContext.params;
  const parsed = ProviderSchema.safeParse(rawProvider);
  if (!parsed.success) {
    return NextResponse.redirect(
      new URL(`/connect/unknown/error?reason=unknown_provider`, request.url)
    );
  }
  const provider = parsed.data;
  const search = request.nextUrl.searchParams;
  const workspaceId = search.get("workspace_id");
  const userId = search.get("user_id");

  if (!workspaceId || !userId) {
    return NextResponse.redirect(
      new URL(`/connect/${provider}/error?reason=missing_params`, request.url)
    );
  }

  try {
    await finalizeConnectionCallback({ workspaceId, userId, provider });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "GET /api/integrations/[provider]/callback",
      message: `Callback finalize failed: ${message}`,
      fingerprintKeys: ["integrations_callback_failed", provider],
      metadata: { provider, error: message },
      userId,
    });
    return NextResponse.redirect(
      new URL(`/connect/${provider}/error?reason=finalize_failed`, request.url)
    );
  }

  return NextResponse.redirect(
    new URL(`/connect/${provider}/done`, request.url)
  );
}
