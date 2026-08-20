import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { reapExpiredPlaygroundSessions } from "@/features/playground/server/service";

/**
 * GET /api/cron/playground-reaper — scheduled deletion of expired playground
 * guest sessions: the guest's workspaces, then the guest `auth.users` row
 * (token rows follow the user). Expiry itself already cut off access —
 * `validateAccessToken` refuses an expired bearer — so this run is about
 * storage, not security. Double-gated inside the service: playground client
 * id on the token AND the guest metadata marker on the user, or the row is
 * skipped and logged.
 * Auth: CRON_SECRET bearer. Schedule: vercel.json.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const result = await reapExpiredPlaygroundSessions();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[playground-reaper] run failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
