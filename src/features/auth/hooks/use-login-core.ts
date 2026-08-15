"use client";

import { useState } from "react";
import { evaluatePassword, PASSWORD_REQUIREMENT_MESSAGE } from "../password-policy";

export type SocialProvider = "google" | "github";

/**
 * `error` — red banner; on password sign-in also reveals "Forgot password?".
 * `message` — overrides default success copy (only web desktop-OAuth handoff).
 */
export type LoginActionResult = { error?: string; message?: string };

/**
 * Login form's outside world, injected. Web binding `./use-login`
 * (supabase-browser); desktop SPA over Electron bridge (`window.dopl`).
 *
 * ABSENT member = "this app cannot do that" — form disables that control and
 * says why (desktop: older main process lacking the IPC op).
 * Expected failures answer `{ error }`, never throw; throws still caught.
 */
export interface LoginActions {
  /** Resolve without error = signed in. Navigation belongs to the binding;
   *  desktop SPA needs none (main pushes the auth transition). */
  signInWithPassword?(email: string, password: string): Promise<LoginActionResult>;
  signUpWithPassword?(email: string, password: string): Promise<LoginActionResult>;
  oauth?(provider: SocialProvider): Promise<LoginActionResult>;
  resetPassword?(email: string): Promise<LoginActionResult>;
}

/** Credential flow on screen. HOST picks the starting one (web: route per
 *  mode; desktop: sign-in). Switch flips it — by navigation on web, in place
 *  on desktop (`LoginFormCoreProps`). */
export type LoginMode = "signin" | "signup";

/** Action in flight — one at a time; names the button's label. */
export type LoginPending = null | "password" | "signup" | "reset" | SocialProvider;

const SIGNUP_SENT = "Check your email to confirm your account.";
const RESET_SENT = "Check your email to reset your password.";

/**
 * Login form state machine. ⚠ Must stay free of `next/*` and supabase — both
 * apps share it; host-specific work arrives through `actions`.
 *
 * No "remember me" state: sessions are ALWAYS persisted (web = cookies via
 * `shared/supabase/browser.ts` › getSupabaseBrowser; desktop = on disk in main,
 * `dopl:password-sign-in` → authTokens). Neither binding has an opt-out path.
 */
export function useLoginCore(actions: LoginActions, defaultMode: LoginMode) {
  const [mode, setModeState] = useState<LoginMode>(defaultMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<LoginPending>(null);
  // Gates the otherwise-hidden "Forgot password?" link.
  const [signInFailed, setSignInFailed] = useState(false);

  /** Mode switch clears banner — a stale sign-in failure under a "Sign up"
   *  heading reads as a complaint about an unsubmitted form. */
  function setMode(next: LoginMode) {
    setModeState(next);
    setError(null);
    setMessage(null);
    setSignInFailed(false);
  }

  async function run(
    kind: LoginPending,
    action: () => Promise<LoginActionResult>,
    successMessage?: string
  ): Promise<boolean> {
    setError(null);
    setMessage(null);
    setPending(kind);
    try {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return false;
      }
      const next = result.message ?? successMessage;
      if (next) setMessage(next);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setPending(null);
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    const signIn = actions.signInWithPassword;
    if (!signIn) return;
    setSignInFailed(false);
    const ok = await run("password", () => signIn(email, password));
    if (!ok) setSignInFailed(true);
  }

  /** Form submit handler in signup mode — hence the optional event, matching
   *  its sign-in twin. */
  async function signUpWithPassword(e?: React.FormEvent) {
    e?.preventDefault();
    const signUp = actions.signUpWithPassword;
    if (!signUp) return;
    await run(
      "signup",
      async () => {
        // Only SET-password surfaces enforce policy; sign-in just matches.
        if (!evaluatePassword(password).valid) {
          return { error: PASSWORD_REQUIREMENT_MESSAGE };
        }
        return signUp(email, password);
      },
      SIGNUP_SENT
    );
  }

  async function resetPassword() {
    const reset = actions.resetPassword;
    if (!reset) return;
    await run(
      "reset",
      async () => {
        if (!email) {
          return { error: "Enter your email first, then click Forgot Password." };
        }
        return reset(email);
      },
      RESET_SENT
    );
  }

  async function signInWithProvider(provider: SocialProvider) {
    const oauth = actions.oauth;
    if (!oauth) return;
    await run(provider, () => oauth(provider));
  }

  return {
    mode,
    setMode,
    email,
    setEmail,
    password,
    setPassword,
    error,
    message,
    pending,
    signInFailed,
    signInWithPassword,
    signUpWithPassword,
    resetPassword,
    signInWithProvider,
  };
}
