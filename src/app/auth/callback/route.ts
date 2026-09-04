import { NextRequest, NextResponse } from "next/server";
import {
  createServerSupabaseClient,
  createDesktopHandoffSupabaseClient,
} from "@/shared/supabase/admin";
import { cookies } from "next/headers";
import { logConversionEvent, hasFiredEvent } from "@/features/analytics/server/conversion-events";
import { ensurePersonalContainer } from "@/features/workspaces/server/service";
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
    // ⚠ THE DESKTOP LEG LEAVES NO SESSION IN THIS BROWSER (2026-09-04). Supabase rotates the
    // refresh token on use and revokes the whole family when a rotated one comes back; a browser
    // copy of the session the desktop is about to adopt is a second, never-rotating holder of
    // that family, and it is what has been signing the app out mid-session. The web leg keeps
    // the cookie-writing client — there the browser IS the holder.
    // See shared/supabase/admin.ts › createDesktopHandoffSupabaseClient.
    const supabase = isDesktop
      ? createDesktopHandoffSupabaseClient(cookieStore)
      : createServerSupabaseClient(cookieStore);
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // ⚠ DESTINATION IS DECIDED HERE; nothing below can move it. The try/catch that follows is
      // side effects only. The desktop's login-CSRF nonce rides through as ?state so the handoff
      // can echo it in the dopl:// fragment (exact-match gate).
      const desktopState = searchParams.get("state") || "";
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

          // The caller's HOME, and the only container signup mints — ruling
          // B10 leaves nothing else to provision. Idempotent: a returning user
          // pays one advisory-locked SELECT.
          await ensurePersonalContainer(user.id);
        }
      } catch (err) {
        // Swallow: event/provisioning failures must not break sign-in.
        console.error(
          `[auth.callback] post-auth side effects failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
      // ⚠ DESKTOP: the session travels in the URL FRAGMENT, which the browser never sends to a
      // server, and it is the ONLY copy that leaves this handler — nothing was written to the
      // cookie jar above. /auth/desktop-handoff reads the fragment and bounces to dopl://.
      if (isDesktop) {
        const session = data?.session;
        if (!session?.access_token || !session.refresh_token) {
          return NextResponse.redirect(new URL("/login", request.url));
        }
        return desktopHandoffRedirect(request, session, desktopState);
      }
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

/**
 * The desktop hand-back: `/auth/desktop-handoff?state=<nonce>#access_token=…&refresh_token=…`.
 *
 * ⚠ FRAGMENT, NOT QUERY — a fragment is never transmitted to any server, and the handoff page
 * strips it from history the moment it reads it. The state nonce stays in the query because the
 * page has always read it from there (the magic-link leg arrives that way from GoTrue), and it
 * is a single-use CSRF nonce, not a credential.
 */
function desktopHandoffRedirect(
  request: NextRequest,
  session: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number },
  state: string
) {
  const fragment = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (session.expires_in) fragment.set("expires_in", String(session.expires_in));
  if (session.expires_at) fragment.set("expires_at", String(session.expires_at));

  const url = new URL("/auth/desktop-handoff", request.url);
  if (state) url.searchParams.set("state", state);
  const response = NextResponse.redirect(`${url.toString()}#${fragment.toString()}`);

  // The PKCE code-verifier /auth/desktop-start wrote is spent. Expiring it is hygiene, not the
  // fix — and note what is NOT touched: a `sb-*-auth-token` cookie from an earlier WEB sign-in
  // in this browser belongs to a DIFFERENT session family and must survive; clearing it would
  // sign the user out of the site as a side effect of signing in to the app.
  for (const { name } of request.cookies.getAll()) {
    if (name.startsWith("sb-") && name.endsWith("-code-verifier")) {
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
  }
  return response;
}
