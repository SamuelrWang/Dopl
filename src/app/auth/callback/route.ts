import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/shared/supabase/admin";
import { cookies } from "next/headers";
import { logConversionEvent, hasFiredEvent } from "@/features/analytics/server/conversion-events";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { webPostAuthDestination } from "@/shared/lib/url/post-auth-landing";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // A default workspace is provisioned below before redirect. A deep link
  // overrides the destination via ?redirectTo=, same-origin only (open-redirect
  // guard); a URL that named nothing usable — and a hostile value, which is not
  // a request but an attack — lands on `/get-started` instead. See
  // shared/lib/url/post-auth-landing.ts.
  //
  // A VALID DEEP LINK NOW WINS OUTRIGHT, INCLUDING FOR A NEVER-ONBOARDED USER
  // (F-136). This used to detour a first-run arrival through
  // `/onboarding?redirectTo=<target>` so the survey could finish the journey it
  // interrupted. Web `/onboarding` is retired (F-135): it 302s to
  // `/get-started`, and that hop REPLACES the query — so the detour deleted the
  // destination it existed to carry. An invite arrived at the download page; so
  // did an MCP OAuth consent screen, whose client then never received its code.
  // The retry failed identically, because `onboarded_at` is only stamped inside
  // the desktop app now: no state reachable from the web could have made a
  // second attempt behave differently.
  //
  // Removing the detour rather than repointing it is safe because of WHAT these
  // arrivals target. Every one is on the retirement KEEP list —
  // `/oauth/authorize`, `/invite/*`, `/join/*`, `/auth/reset-password`,
  // `/billing/*` — and not one of them reads onboarding state. Onboarding
  // happens inside the desktop app, which is what the `!isDesktop` guard below
  // has always said for app sign-ins, and where the SPA's own `/onboarding`
  // route now lives. The onboarding READ is gone with the branch: this handler
  // no longer has an opinion about who has onboarded, which is the only way the
  // destination can stop depending on a column the web cannot stamp.
  //
  // A PLAIN signup is unchanged — no `redirectTo` means nothing was
  // interrupted, so it lands on the download page and onboards after install.
  const redirectTo = webPostAuthDestination(searchParams.get("redirectTo"));
  // Desktop app flow: this callback runs in the user's system browser. After
  // the exchange we hand the session back to the app via /auth/desktop-handoff
  // (which redirects to a dopl:// deep link) — never at a web landing, and
  // never at a `?redirectTo=` riding alongside `desktop=1`.
  const isDesktop = searchParams.get("desktop") === "1";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // THE DESTINATION IS DECIDED HERE AND NOTHING BELOW CAN MOVE IT. The
      // try/catch that follows is side effects only, so no failure inside it —
      // and no row it reads — can change where this sign-in lands.
      // The desktop app's login-CSRF nonce rides through as ?state so the
      // handoff can echo it in the dopl:// fragment (exact-match gate).
      const desktopState = searchParams.get("state") || "";
      const destination = isDesktop
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
