"use client";

import { useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";
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
  // Workspace + canvas are auto-provisioned in /auth/callback before redirect,
  // so first-time users land in their workspace. Deep links override via an
  // explicit ?redirectTo= but only if same-origin (open-redirect guard).
  const redirectTo = safeRedirect(searchParams.get("redirectTo"));
  // Optional "install this cluster after sign-in" intent, threaded through to
  // /auth/callback so OAuth + email flows can run the fork server-side.
  const installCluster = searchParams.get("installCluster");

  function buildCallbackUrl(): string {
    const params = new URLSearchParams({ redirectTo });
    if (installCluster) params.set("installCluster", installCluster);
    return `${authOrigin()}/auth/callback?${params.toString()}`;
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

    async sendMagicLink(email) {
      // Works for new and existing users — Supabase creates the auth row on
      // first link. Keeps pre-password (magic-link era) users able to sign in.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: buildCallbackUrl() },
      });
      return error ? { error: error.message } : {};
    },

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
