import { NextRequest, NextResponse } from "next/server";
import { revokeToken } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * RFC 7009 token revocation. Accepts an access or refresh token. Per spec,
 * always returns 200 — even for unknown tokens — so callers can't probe
 * which tokens exist.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const token =
      typeof form.get("token") === "string"
        ? (form.get("token") as string).trim()
        : "";
    if (token) await revokeToken(token);
  } catch {
    // Malformed body — still return 200 per spec.
  }
  return new NextResponse(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
