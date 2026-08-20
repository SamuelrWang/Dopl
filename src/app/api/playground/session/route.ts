import { NextRequest, NextResponse } from "next/server";
import {
  createPlaygroundSession,
  PlaygroundRateLimited,
} from "@/features/playground/server/service";

/**
 * POST /api/playground/session — provision an anonymous playground session
 * (guest user + seeded workspace + short-lived MCP bearer). Deliberately
 * unauthenticated: the entire audience is visitors with no account. Listed in
 * `src/proxy.ts › SELF_AUTH_ROUTES`; abuse is bounded by the per-IP limiter
 * inside the service plus the free-plan MCP credit allowance the guest
 * workspace inherits.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // First forwarded hop = the client, per Vercel's proxy contract.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  try {
    const session = await createPlaygroundSession(ip);
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    if (err instanceof PlaygroundRateLimited) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: err.message },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    console.error("[playground] session provisioning failed:", err);
    return NextResponse.json(
      { error: "PLAYGROUND_UNAVAILABLE", message: "Could not start a playground session." },
      { status: 500 },
    );
  }
}
