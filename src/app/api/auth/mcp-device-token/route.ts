import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { issueDeviceToken, revokeDeviceTokens } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * POST — mint a 90-day Dopl MCP access token for a signed-in user's CLI / desktop listener.
 * DELETE — revoke one.
 *
 * ⚠ `sessionOnly` gates BOTH to cookie callers: an OAuth agent token of ANY scope is refused, so
 * a background agent can never bootstrap a fresh 90-day credential for itself.
 * The token is returned ONCE (only its hash is stored); revocable via its label from the settings
 * "Connected apps" list.
 */
const BodySchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
});

async function readLabel(request: NextRequest): Promise<string> {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (parsed.success && parsed.data.label) return parsed.data.label;
  } catch {
    // Empty / non-JSON body → default label.
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
      // ⚠ A bearer credential must never be cached by any intermediary.
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { sessionOnly: true },
);

/**
 * The revoke half. ⚠ The selector travels in the JSON BODY, not the query string, so a device
 * label (a hostname) never lands in a URL, an access log or a referrer.
 *
 * ⚠ `sessionOnly: true` is THE security property, not a copy-paste of the mint's option. A device
 * token is handed to every spawned agent; if a bearer could reach this route one agent could
 * revoke the credential its siblings depend on, and cover its tracks by killing the token whose
 * `last_used_at` records it. A bearer must never operate the controls that govern bearers.
 *
 * Selectors: `label` and/or `tokenId`. ⚠ At least one is required — an empty body is a 400, never
 * an accidental revoke-everything. Idempotent: unknown/already-revoked is a quiet 200 `revoked: 0`.
 */
const RevokeSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  tokenId: z.string().uuid().optional(),
});

export const DELETE = withUserAuth(
  async (request: NextRequest, { userId }) => {
    let raw: unknown = {};
    try {
      raw = (await request.json()) ?? {};
    } catch {
      // Empty / non-JSON body → the "no selector" 400 below.
      raw = {};
    }
    const parsed = RevokeSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "label must be a non-empty string and tokenId a uuid" },
        { status: 400 },
      );
    }
    const { label, tokenId } = parsed.data;
    if (!label && !tokenId) {
      return NextResponse.json(
        { error: "label or tokenId required" },
        { status: 400 },
      );
    }
    const revoked = await revokeDeviceTokens({ userId, label, tokenId });
    return NextResponse.json(
      { ok: true, revoked },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { sessionOnly: true },
);
