import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";

/**
 * Legacy credits endpoint. The credit system has been retired in favor
 * of a flat $7.99/mo subscription with a 24-hour free trial. This route
 * returns a static stub so any client still polling it gets a benign
 * response rather than 404 / 5xx. Delete in the post-launch cleanup pass.
 */
async function handleGet(
  _request: Request,
  _ctx: { userId: string }
) {
  return NextResponse.json({
    balance: null,
    tier: "legacy",
    monthlyCredits: null,
    cycleStart: null,
    cycleEnd: null,
    cycleCreditsGranted: null,
    dailyBonus: null,
    dailyBonusAvailable: false,
    earlySupporterGrantedAt: null,
    deprecated: true,
    replaced_by: "/api/billing/access",
  });
}

export const GET = withUserAuth(handleGet);
