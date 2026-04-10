import { NextRequest, NextResponse } from "next/server";
import { createApiKey, listApiKeys } from "@/lib/auth/api-keys";

function checkAdminAuth(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token === secret;
}

/**
 * GET /api/admin/keys — List all API keys (prefix, name, dates).
 */
export async function GET(request: NextRequest) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const keys = await listApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/keys — Create a new API key.
 * Body: { "name": "My MCP server" }
 * Returns the plaintext key ONCE.
 */
export async function POST(request: NextRequest) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const name = body?.name;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const result = await createApiKey(name.trim());

    return NextResponse.json(
      {
        id: result.id,
        key: result.key, // Plaintext — shown ONCE
        prefix: result.prefix,
        name: result.name,
        message:
          "Save this key now — it will not be shown again.",
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
