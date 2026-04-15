import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { getCheckoutSessionStatus } from "@/lib/billing/stripe";

async function handleGet(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const status = await getCheckoutSessionStatus(sessionId);
  return NextResponse.json(status);
}

export const GET = withUserAuth(handleGet);
