import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/shared/supabase/admin";
import { cookies } from "next/headers";
import { logConversionEvent, hasFiredEvent } from "@/features/analytics/server/conversion-events";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { ensureDefaultCanvas } from "@/features/workspaces/server/canvases";
import { isOnboarded } from "@/features/onboarding/server/service";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // Workspace + canvas are provisioned below before redirect, so a
  // first-time user lands directly in their workspace. Deep links
  // override via ?redirectTo= but only if same-origin path (open
  // redirect guard — see safeRedirect doc).
  const redirectTo = safeRedirect(searchParams.get("redirectTo"));
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
      let destination = isDesktop ? "/auth/desktop-handoff" : redirectTo;
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

          // Provision a default workspace + canvas for every signed-in
          // user. Both helpers are idempotent — a returning user just
          // pays two cheap SELECTs. New users land here on first sign-in
          // and get the workspace + canvas they'll use as soon as they
          // hit /canvas.
          const workspace = await ensureDefaultWorkspace(user.id);
          await ensureDefaultCanvas(workspace.id);

          // First-run users detour to /onboarding (survey + MCP connect).
          // Only an EXPLICIT deep link is threaded — the /canvas default
          // isn't, since onboarding computes the workspace landing itself.
          if (!isDesktop && !(await isOnboarded(user.id))) {
            destination = searchParams.get("redirectTo")
              ? `/onboarding?${new URLSearchParams({ redirectTo })}`
              : "/onboarding";
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
