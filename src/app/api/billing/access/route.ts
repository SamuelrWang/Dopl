import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { hasActiveAccess } from "@/lib/billing/access";

async function handleGet(
  _request: NextRequest,
  { userId }: { userId: string }
) {
  const access = await hasActiveAccess(userId);
  return NextResponse.json(access);
}

export const GET = withUserAuth(handleGet);
