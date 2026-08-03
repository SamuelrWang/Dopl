"use client";

import { useState } from "react";
import { evaluatePassword, PASSWORD_REQUIREMENT_MESSAGE } from "../password-policy";

export type SocialProvider = "google" | "github";

/**
 * What every injected action answers.
 *
 * `error` — shown in the form's red banner (and, for a password sign-in, it is
 * what reveals the "Forgot password?" link).
 * `message` — overrides the core's default success copy. Only the web app's
 * desktop-OAuth handoff needs its own line; everything else takes the default.
 */
export type LoginActionResult = { error?: string; message?: string };

/**
 * The login form's whole outside world, injected.
 *
 * The web binding (`./use-login`) implements these with `supabase-browser`; the
 * desktop SPA implements them over the Electron bridge (`window.dopl`), where
 * there is no supabase client and no `next/navigation` to redirect with. An
 * ABSENT member means "this app cannot do that" — the form disables that
 * control and explains why, instead of shipping a button that does nothing.
 * (Desktop: an older main process without the matching IPC op.)
 *
 * An action never throws for an expected failure; it answers `{ error }`. A
 * thrown error is still caught by the core and shown, so a binding may be
 * sloppy without breaking the screen.
 */
export interface LoginActions {
  /** Resolving without an error means signed in. Navigation, if the host needs
   *  any, belongs to the binding — the desktop SPA needs none (main pushes the
   *  auth transition and the boot screen swaps itself out). */
  signInWithPassword?(email: string, password: string): Promise<LoginActionResult>;
  signUpWithPassword?(email: string, password: string): Promise<LoginActionResult>;
  sendMagicLink?(email: string): Promise<LoginActionResult>;
  oauth?(provider: SocialProvider): Promise<LoginActionResult>;
  resetPassword?(email: string): Promise<LoginActionResult>;
}

/** Which action is in flight — one at a time, and it names the button's label. */
export type LoginPending =
  | null
  | "password"
  | "signup"
  | "magic"
  | "reset"
  | SocialProvider;

const SIGNUP_SENT = "Check your email to confirm your account.";
const MAGIC_SENT = "Check your email for a sign-in link.";
const RESET_SENT = "Check your email to reset your password.";

/**
 * The login form's state machine, free of `next/*` and of supabase.
 *
 * Everything host-specific arrives through `actions`; what stays here is the
 * part both apps must agree on — field state, the single in-flight slot, the
 * error/message banner, the password policy gate on sign-up, and the
 * "email first" guards. See `./use-login` for the web binding.
 */
export function useLoginCore(actions: LoginActions) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<LoginPending>(null);
  // True after a failed password sign-in — used to surface the otherwise-hidden
  // "Forgot password?" link only when it's actually relevant.
  const [signInFailed, setSignInFailed] = useState(false);

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

  async function signUpWithPassword() {
    const signUp = actions.signUpWithPassword;
    if (!signUp) return;
    await run(
      "signup",
      async () => {
        // Only the surfaces that SET a password enforce the policy; sign-in
        // just has to match whatever the account already has.
        if (!evaluatePassword(password).valid) {
          return { error: PASSWORD_REQUIREMENT_MESSAGE };
        }
        return signUp(email, password);
      },
      SIGNUP_SENT
    );
  }

  async function sendMagicLink() {
    const send = actions.sendMagicLink;
    if (!send) return;
    await run(
      "magic",
      async () => {
        if (!email) return { error: "Enter your email first." };
        return send(email);
      },
      MAGIC_SENT
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
