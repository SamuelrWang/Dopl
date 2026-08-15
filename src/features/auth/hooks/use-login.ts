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

/** Origin Supabase sends auth emails / OAuth callbacks to. ⚠ Pinned to
 *  NEXT_PUBLIC_APP_URL in prod so links never embed a preview or localhost
 *  origin; dev keeps window.location.origin. Deployed callback must also be
 *  allowlisted in Supabase Auth → URL Configuration. */
function authOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured && process.env.NODE_ENV === "production") return configured;
  return window.location.origin;
}

/** WEB binding of `LoginActions` — supabase-browser + Next query string. Rest
 *  of the form lives in `./use-login-core` (desktop SPA reuses it). */
export function useLoginActions(): LoginActions {
  const searchParams = useSearchParams();
  // `?redirectTo=` overrides destination, same-origin only (open-redirect
  // guard). See `shared/lib/url/post-auth-landing.ts`.
  const explicitTarget = explicitPostAuthTarget(searchParams.get("redirectTo"));
  const redirectTo = explicitTarget ?? WEB_POST_AUTH_LANDING;
  // "install this cluster after sign-in" intent, threaded to /auth/callback so
  // OAuth + email flows fork server-side.
  const installCluster = searchParams.get("installCluster");

  function buildCallbackUrl(): string {
    const params = new URLSearchParams();
    // ⚠ ONLY when the URL named a target. /auth/callback reads this param's
    // PRESENCE as "sign-in owes a return trip" and lets it override the
    // download-page landing — threading the default here makes every plain
    // signup look like a deep link.
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

    async resetPassword(email) {
      // Recovery link goes through /auth/callback (exchanges code → session),
      // then forwards to the set-new-password page.
      const params = new URLSearchParams({ redirectTo: "/auth/reset-password" });
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${authOrigin()}/auth/callback?${params.toString()}`,
      });
      return error ? { error: error.message } : {};
    },

    async oauth(provider) {
      // ⚠ Desktop: OAuth cannot run in the wrapper window — Supabase PKCE needs
      // the code-verifier in the context that exchanges the code. System browser
      // hands the session back via dopl:// deep link. Google only, today.
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
