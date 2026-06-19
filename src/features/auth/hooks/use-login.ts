"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";
import { isDesktopApp } from "@/shared/lib/desktop";
import { evaluatePassword, PASSWORD_REQUIREMENT_MESSAGE } from "../password-policy";

export type SocialProvider = "google" | "github";

/** Origin Supabase sends auth emails / OAuth callbacks back to. Pinned to the
 *  canonical NEXT_PUBLIC_APP_URL in prod so links never embed a preview or
 *  localhost origin; local dev keeps window.location.origin. The deployed
 *  callback must also be allowlisted in Supabase Auth → URL Configuration. */
function authOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured && process.env.NODE_ENV === "production") return configured;
  return window.location.origin;
}

type Pending = null | "password" | "signup" | "magic" | "reset" | SocialProvider;

export function useLogin() {
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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  // True after a failed password sign-in — used to surface the otherwise-hidden
  // "Forgot password?" link only when it's actually relevant.
  const [signInFailed, setSignInFailed] = useState(false);

  const supabase = getSupabaseBrowser();

  async function run(kind: Pending, fn: () => Promise<void>) {
    setError(null);
    setMessage(null);
    setPending(kind);
    try {
      await fn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(null);
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSignInFailed(false);
    setPending("password");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Session persisted by the browser client; land on the resolved destination.
      window.location.assign(redirectTo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSignInFailed(true);
    } finally {
      setPending(null);
    }
  }

  async function signUpWithPassword() {
    await run("signup", async () => {
      if (!evaluatePassword(password).valid) throw new Error(PASSWORD_REQUIREMENT_MESSAGE);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: buildCallbackUrl() },
      });
      if (error) throw error;
      setMessage("Check your email to confirm your account.");
    });
  }

  async function sendMagicLink() {
    await run("magic", async () => {
      if (!email) throw new Error("Enter your email first.");
      // Works for new and existing users — Supabase creates the auth row on
      // first link. Keeps pre-password (magic-link era) users able to sign in.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: buildCallbackUrl() },
      });
      if (error) throw error;
      setMessage("Check your email for a sign-in link.");
    });
  }

  async function resetPassword() {
    await run("reset", async () => {
      if (!email) throw new Error("Enter your email first, then click Forgot Password.");
      // Route the recovery link through /auth/callback (which exchanges the code
      // into a live session) and forward to the set-new-password page.
      const params = new URLSearchParams({ redirectTo: "/auth/reset-password" });
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${authOrigin()}/auth/callback?${params.toString()}`,
      });
      if (error) throw error;
      setMessage("Check your email to reset your password.");
    });
  }

  async function signInWithProvider(provider: SocialProvider) {
    await run(provider, async () => {
      // Desktop app: OAuth can't run in the wrapper window (Supabase PKCE needs
      // the code-verifier in the same context that exchanges the code). Open the
      // system browser; it hands the session back via a dopl:// deep link. Only
      // Google has the desktop handoff today.
      if (isDesktopApp() && provider === "google") {
        window.open(`${window.location.origin}/auth/desktop-start`, "_blank");
        setMessage(
          "Continue signing in with Google in your browser. You'll be returned to the Dopl app automatically.",
        );
        return;
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: buildCallbackUrl() },
      });
      if (error) throw error;
    });
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    remember,
    setRemember,
    error,
    message,
    pending,
    signInFailed,
    signInWithPassword,
    signUpWithPassword,
    sendMagicLink,
    resetPassword,
    signInWithProvider,
  };
}
