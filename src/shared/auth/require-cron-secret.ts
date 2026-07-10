import "server-only";
import { NextResponse } from "next/server";

/**
 * Gate for /api/cron/* routes: CRON_SECRET bearer, fail-closed (503 when
 * the secret is unset so a misconfigured deploy can't run crons openly).
 * Returns null when authorized, otherwise the response to return.
 */
export function requireCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
