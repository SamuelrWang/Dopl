import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * POST /api/welcome/complete
 *
 * Fired from the /welcome flow as soon as the user's MCP connection goes
 * live. Flips `profiles.onboarded_at` so the /welcome server component
 * redirects them straight to /canvas next time.
 *
 * Idempotent — if `onboarded_at` is already set, we just report `ok: true`
 * without re-stamping (keeps the original timestamp intact for analytics).
 */
export const POST = withUserAuth(async (_request, { userId }) => {
  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", userId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  if (profile?.onboarded_at) {
    return NextResponse.json({ ok: true, already: true });
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", userId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, already: false });
});
