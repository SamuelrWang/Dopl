import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/shared/supabase/admin";
import { cookies } from "next/headers";
import { logConversionEvent, hasFiredEvent } from "@/features/analytics/server/conversion-events";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { webPostAuthDestination } from "@/shared/lib/url/post-auth-landing";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // `?redirectTo=` overrides the destination, same-origin only (open-redirect guard); anything
  // unusable or hostile lands on `/get-started`. See shared/lib/url/post-auth-landing.ts.
  //
  // ⚠ A VALID DEEP LINK WINS OUTRIGHT, INCLUDING FOR A NEVER-ONBOARDED USER. Do not reinstate an
  // `/onboarding?redirectTo=` detour: web `/onboarding` 302s to `/get-started` and that hop
  // REPLACES the query, deleting the destination it carries. This handler holds no opinion about
  // who has onboarded — `onboarded_at` is stamped only inside the desktop app, so no
  // web-reachable state could make a retry behave differently.
  const redirectTo = webPostAuthDestination(searchParams.get("redirectTo"));
  // Desktop flow: this runs in the user's system browser; the session goes back to the app via
  // /auth/desktop-handoff → `dopl://` deep link. Never a web landing, and never a `?redirectTo=`
  // riding alongside `desktop=1`.
  const isDesktop = searchParams.get("desktop") === "1";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // ⚠ DESTINATION IS DECIDED HERE; nothing below can move it. The try/catch that follows is
      // side effects only. The desktop's login-CSRF nonce rides through as ?state so the handoff
      // can echo it in the dopl:// fragment (exact-match gate).
      const desktopState = searchParams.get("state") || "";
      const destination = isDesktop
        ? `/auth/desktop-handoff${desktopState ? `?state=${encodeURIComponent(desktopState)}` : ""}`
        : redirectTo;
      // Side effects only — try/catch so no failure here can block the redirect.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          const alreadySignedUp = await hasFiredEvent(user.id, "signup");
          if (!alreadySignedUp) {
            await logConversionEvent({
              userId: user.id,
              eventType: "signup",
            });
          }

          // Idempotent — a returning user pays one cheap SELECT.
          await ensureDefaultWorkspace(user.id);
        }
      } catch (err) {
        // Swallow: event/provisioning failures must not break sign-in.
        console.error(
          `[auth.callback] post-auth side effects failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login", request.url));
}
