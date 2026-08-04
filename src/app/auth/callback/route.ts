import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/shared/supabase/admin";
import { cookies } from "next/headers";
import { logConversionEvent, hasFiredEvent } from "@/features/analytics/server/conversion-events";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { isOnboarded } from "@/features/onboarding/server/service";
import {
  WEB_POST_AUTH_LANDING,
  explicitPostAuthTarget,
} from "@/shared/lib/url/post-auth-landing";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // A default workspace is provisioned below before redirect. A deep link
  // overrides the destination via ?redirectTo=, same-origin only (open-redirect
  // guard); `explicitTarget` is null when the URL named nothing usable, and
  // BOTH the destination and the onboarding detour below hang off that
  // distinction. See shared/lib/url/post-auth-landing.ts.
  const explicitTarget = explicitPostAuthTarget(searchParams.get("redirectTo"));
  const redirectTo = explicitTarget ?? WEB_POST_AUTH_LANDING;
  // Desktop app flow: this callback runs in the user's system browser. After
  // the exchange we hand the session back to the app via /auth/desktop-handoff
  // (which redirects to a dopl:// deep link). Skip the onboarding detour — the
  // user finishes onboarding inside the app once the session lands there.
  const isDesktop = searchParams.get("desktop") === "1";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Onboarding detour for new users; set inside the try below so a
      // failed status read falls back to redirectTo and never blocks sign-in.
      // The desktop app's login-CSRF nonce rides through as ?state so the
      // handoff can echo it in the dopl:// fragment (exact-match gate).
      const desktopState = searchParams.get("state") || "";
      let destination = isDesktop
        ? `/auth/desktop-handoff${desktopState ? `?state=${encodeURIComponent(desktopState)}` : ""}`
        : redirectTo;
      // Post-auth side effects. Wrapped in try/catch so any failure here
      // can never block the redirect. (The per-user 24h trial is retired —
      // billing is workspace-level now, so no trial is stamped on sign-in.)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          // If this is the user's very first sign-in, log a signup event.
          const alreadySignedUp = await hasFiredEvent(user.id, "signup");
          if (!alreadySignedUp) {
            await logConversionEvent({
              userId: user.id,
              eventType: "signup",
            });
          }

          // Provision a default workspace for every signed-in user.
          // Idempotent — a returning user just pays one cheap SELECT.
          // New users land here on first sign-in and get the workspace
          // they'll use as soon as they hit /canvas.
          await ensureDefaultWorkspace(user.id);

          // First-run users detour to /onboarding (survey + MCP connect) ONLY
          // when this sign-in owes somewhere a return trip — an invite, a join
          // link, an OAuth consent screen. That deep link is threaded through so
          // onboarding can finish the journey it interrupted.
          //
          // A PLAIN signup no longer detours. It goes to the download page and
          // onboards INSIDE the desktop app, which is where onboarding already
          // happens for everybody who signs in through the app (the `!isDesktop`
          // guard on this branch has always said so) and where the SPA's own
          // /onboarding route now lives. Sending a brand-new account through a
          // web survey it will never see again, on the way to installing the app
          // that asks the same questions, is the detour this change removes.
          if (!isDesktop && explicitTarget && !(await isOnboarded(user.id))) {
            destination = `/onboarding?${new URLSearchParams({ redirectTo })}`;
          }
        }
      } catch (err) {
        // Swallow — event/provisioning failures must not break sign-in.
        console.error(
          `[auth.callback] post-auth side effects failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }

  // If there's an error or no code, redirect to login
  return NextResponse.redirect(new URL("/login", request.url));
}
