"use client";

import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { evaluatePassword, PASSWORD_REQUIREMENT_MESSAGE } from "../password-policy";
import { WEB_POST_AUTH_LANDING } from "@/shared/lib/url/post-auth-landing";

type Status = "checking" | "ready" | "invalid";

/** Set-new-password form reached from a recovery email. /auth/callback already
 *  exchanged the code into a session, so mount just confirms one exists;
 *  PASSWORD_RECOVERY listener covers the hash-based flow too. */
export function useResetPassword() {
  const supabase = getSupabaseBrowser();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let active = true;

    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (active) setStatus(data.session ? "ready" : "invalid");
    };
    void check();

    const { data: sub } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === "PASSWORD_RECOVERY" || session) setStatus("ready");
      },
    );

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!evaluatePassword(password).valid) {
      setError(PASSWORD_REQUIREMENT_MESSAGE);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setPending(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage("Password updated. Redirecting…");
      window.location.assign(WEB_POST_AUTH_LANDING);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPending(false);
    }
  }

  return {
    password,
    setPassword,
    confirm,
    setConfirm,
    error,
    message,
    pending,
    status,
    submit,
  };
}
