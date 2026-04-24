import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/shared/supabase/admin";
import { cookies } from "next/headers";
import { startTrialIfNew } from "@/features/billing/server/subscriptions";
import { logConversionEvent, hasFiredEvent } from "@/features/analytics/server/conversion-events";
import { forkPublishedCluster } from "@/features/community/server/service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // Default to /welcome so first-time users hit the onboarding flow.
  // /welcome itself server-redirects to /canvas for already-onboarded
  // users, so returning sign-ins cost one extra redirect and nothing else.
  const redirectTo = searchParams.get("redirectTo") || "/welcome";
  // Optional "install this cluster on landing" intent. Set by the
  // shared-cluster page's "Log in to install" CTA so the visitor lands
  // on /canvas with the cluster already imported, no extra click.
  const installCluster = searchParams.get("installCluster");

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Stamp a 24-hour trial on first sign-in. Idempotent — only runs
      // if trial_started_at is null. Wrapped in try/catch so a trial
      // failure can never block the redirect.
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

          const startedNew = await startTrialIfNew(user.id);
          if (startedNew) {
            await logConversionEvent({
              userId: user.id,
              eventType: "trial_started",
            });
          }

          // Fulfil install intent. Self-fork and "already imported"
          // failures are silent successes from the visitor's POV — they
          // still land on /canvas and the cluster is there.
          if (installCluster) {
            try {
              await forkPublishedCluster(installCluster, user.id);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (
                !msg.includes("already imported") &&
                !msg.includes("Cannot import your own cluster")
              ) {
                console.error(
                  `[auth.callback] auto-install failed for ${installCluster}:`,
                  msg
                );
              }
            }
          }
        }
      } catch (err) {
        // Swallow — trial/event/install failures must not break sign-in.
        console.error(
          `[auth.callback] post-auth side effects failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
  }

  // If there's an error or no code, redirect to login
  return NextResponse.redirect(new URL("/login", request.url));
}
