import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase";
import { cookies } from "next/headers";
import { tryClaimEarlySupporterGrant } from "@/lib/billing/early-supporter";
import { EARLY_SUPPORTER_ENABLED } from "@/lib/billing/early-supporter-flag";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") || "/canvas";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Gated by feature flag — disabled during beta so testers don't burn
      // the 100 slots before launch. Flip in early-supporter-flag.ts.
      if (EARLY_SUPPORTER_ENABLED) {
        // Best-effort: try to claim the early-supporter grant. The RPC is
        // idempotent and capped at 100 slots, so calling on every sign-in is
        // safe. Wrapped in try/catch so a grant failure can never block the
        // redirect.
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            await tryClaimEarlySupporterGrant(user.id);
          }
        } catch {
          // Swallow — grant failures must not break sign-in.
        }
      }
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
  }

  // If there's an error or no code, redirect to login
  return NextResponse.redirect(new URL("/login", request.url));
}
