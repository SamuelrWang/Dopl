import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Public endpoint — returns how many of the 100 early-supporter slots have
 * been claimed. Used by the landing page badge to show progress.
 *
 * No auth: the number is intentionally public (it's a marketing signal).
 *
 * Display floor: we seed the counter at SEED_USED so the badge shows
 * meaningful momentum from day one. The real count takes over the moment it
 * passes the seed.
 */
const TOTAL = 100;
const SEED_USED = 37;

export async function GET() {
  try {
    const { count, error } = await supabaseAdmin()
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .not("early_supporter_granted_at", "is", null);

    if (error) {
      // Pre-migration the column doesn't exist — still seed so UI looks alive.
      return NextResponse.json({ used: SEED_USED, total: TOTAL });
    }

    const real = count ?? 0;
    return NextResponse.json({ used: Math.max(real, SEED_USED), total: TOTAL });
  } catch {
    return NextResponse.json({ used: SEED_USED, total: TOTAL });
  }
}
