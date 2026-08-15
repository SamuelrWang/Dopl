"use client";

import { useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import {
  WEB_POST_AUTH_LANDING,
  explicitPostAuthTarget,
} from "@/shared/lib/url/post-auth-landing";
import { isDesktopApp } from "@/shared/lib/desktop";
import type { LoginActions, SocialProvider } from "./use-login-core";

export type { SocialProvider };

/** Origin Supabase sends auth emails / OAuth callbacks back to. Pinned to the
 *  canonical NEXT_PUBLIC_APP_URL in prod so links never embed a preview or
 *  localhost origin; local dev keeps window.location.origin. The deployed
 *  callback must also be allowlisted in Supabase Auth → URL Configuration. */
function authOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured && process.env.NODE_ENV === "production") return configured;
  return window.location.origin;
}

/**
 * The WEB binding of `LoginActions` — supabase-browser plus the Next router's
 * query string. Everything else about the login form (field state, the
 * in-flight slot, the banner, the password policy gate) lives in
 * `./use-login-core`, which the desktop SPA reuses with bridge-backed actions.
 */
export function useLoginActions(): LoginActions {
  const searchParams = useSearchParams();
  // A deep link overrides the destination via `?redirectTo=`, same-origin only
  // (open-redirect guard). Absent one, a web sign-in lands on the post-auth
  // download page — see `shared/lib/url/post-auth-landing.ts` for why, and for
  // what it deliberately leaves alone.
  const explicitTarget = explicitPostAuthTarget(searchParams.get("redirectTo"));
  const redirectTo = explicitTarget ?? WEB_POST_AUTH_LANDING;
  // Optional "install this cluster after sign-in" intent, threaded through to
  // /auth/callback so OAuth + email flows can run the fork server-side.
  const installCluster = searchParams.get("installCluster");

  function buildCallbackUrl(): string {
    const params = new URLSearchParams();
    // ONLY when the URL actually named a target. The callback reads the presence
    // of this param as "this sign-in came from somewhere and owes it a return
    // trip", and a deep link OVERRIDES the download-page landing on the strength
    // of it. Threading the DEFAULT through here would make every plain signup
    // look like a deep link, which is how `redirectTo=/canvas` on every callback
    // URL used to defeat the landing change. (It also used to force the web
    // onboarding detour; that detour is gone with F-136, but the signal still
    // has to mean what it says.)
    if (explicitTarget) params.set("redirectTo", explicitTarget);
    if (installCluster) params.set("installCluster", installCluster);
    const qs = params.toString();
    return `${authOrigin()}/auth/callback${qs ? `?${qs}` : ""}`;
  }

  const supabase = getSupabaseBrowser();

  return {
    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      // Session persisted by the browser client; land on the resolved destination.
      window.location.assign(redirectTo);
      return {};
    },

    async signUpWithPassword(email, password) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: buildCallbackUrl() },
      });
      return error ? { error: error.message } : {};
    },

    // NO `sendMagicLink`. `signInWithOtp` was the form's third credential path
    // ("Email me a sign-in link instead"); the control and the action member
    // both went on 2026-08-13, leaving password + OAuth. A pre-password user
    // with no password on file still has a road in: "Forgot password?" (which
    // is the same email round-trip, ending on a page that SETS one) and Google
    // or GitHub, which auto-provision on first sign-in.
    async resetPassword(email) {
      // Route the recovery link through /auth/callback (which exchanges the code
      // into a live session) and forward to the set-new-password page.
      const params = new URLSearchParams({ redirectTo: "/auth/reset-password" });
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${authOrigin()}/auth/callback?${params.toString()}`,
      });
      return error ? { error: error.message } : {};
    },

    async oauth(provider) {
      // Desktop app: OAuth can't run in the wrapper window (Supabase PKCE needs
      // the code-verifier in the same context that exchanges the code). Open the
      // system browser; it hands the session back via a dopl:// deep link. Only
      // Google has the desktop handoff today.
      if (isDesktopApp() && provider === "google") {
        window.open(`${window.location.origin}/auth/desktop-start`, "_blank");
        return {
          message:
            "Continue signing in with Google in your browser. You'll be returned to the Dopl app automatically.",
        };
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: buildCallbackUrl() },
      });
      return error ? { error: error.message } : {};
    },
  };
}
