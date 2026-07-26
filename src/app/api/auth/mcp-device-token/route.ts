import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { issueDeviceToken } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/mcp-device-token — mint a long-lived (90-day) Dopl MCP
 * access token for a signed-in user's CLI / desktop listener.
 *
 * `sessionOnly` gates this to interactive (cookie) callers: an OAuth agent
 * token — of any scope — is refused, so a background agent can never bootstrap
 * a fresh 90-day credential for itself. The desktop app calls this after
 * sign-in (and on startup when signed in) to auto-configure `claude mcp add`
 * for the CLI. The token is returned ONCE (only its hash is stored) and is
 * revocable/listable from the settings "Connected apps" list via its label.
 */
const BodySchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
});

async function readLabel(request: NextRequest): Promise<string> {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (parsed.success && parsed.data.label) return parsed.data.label;
  } catch {
    // Empty / non-JSON body is fine — fall back to the default label.
  }
  return "Dopl Desktop CLI";
}

export const POST = withUserAuth(
  async (request, { userId }) => {
    const label = await readLabel(request);
    const { token, expiresAt } = await issueDeviceToken({
      userId,
      deviceLabel: label,
      scopes: ["dopl.read", "dopl.write"],
    });
    return NextResponse.json(
      { token, expiresAt },
      // A bearer credential must never be cached by any intermediary.
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { sessionOnly: true },
);
