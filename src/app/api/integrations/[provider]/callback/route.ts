import { NextRequest, NextResponse } from "next/server";
import { ProviderSchema } from "@/features/integrations/schema";
import { finalizeConnectionCallback } from "@/features/integrations/server/service";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * GET /api/integrations/[provider]/callback
 *
 * Public endpoint hit after the broker finishes the provider's OAuth
 * flow. The broker passes its `connectedAccountId` as
 * `?status=...&connectedAccountId=...` (Composio's standard callback
 * shape). We look up the row keyed by the broker id, finalize status,
 * derive alias from the broker's account email, and auto-grant every
 * workspace the user belongs to.
 *
 * On success: redirect to /connect/[provider]/popup-success which
 * sends a postMessage to the opener and closes the popup.
 * On failure: redirect to /connect/[provider]/popup-error with the
 * same self-close behavior.
 */
export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ provider: string }> }
): Promise<Response> {
  const { provider: rawProvider } = await routeContext.params;
  const parsed = ProviderSchema.safeParse(rawProvider);
  if (!parsed.success) {
    return NextResponse.redirect(
      new URL(
        `/connect/unknown/popup-error?reason=unknown_provider`,
        request.url
      )
    );
  }
  const provider = parsed.data;
  const search = request.nextUrl.searchParams;
  const brokerConnectionId =
    search.get("connectedAccountId") ?? search.get("connection_id");

  if (!brokerConnectionId) {
    return NextResponse.redirect(
      new URL(`/connect/${provider}/popup-error?reason=missing_params`, request.url)
    );
  }

  try {
    await finalizeConnectionCallback({ brokerConnectionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "GET /api/integrations/[provider]/callback",
      message: `Callback finalize failed: ${message}`,
      fingerprintKeys: ["integrations_callback_failed", provider],
      metadata: { provider, error: message, brokerConnectionId },
    });
    return NextResponse.redirect(
      new URL(`/connect/${provider}/popup-error?reason=finalize_failed`, request.url)
    );
  }

  return NextResponse.redirect(
    new URL(`/connect/${provider}/popup-success`, request.url)
  );
}
