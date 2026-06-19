"use client";

import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { evaluatePassword, PASSWORD_REQUIREMENT_MESSAGE } from "../password-policy";

type Status = "checking" | "ready" | "invalid";

/** Drives the set-new-password form reached from a recovery email. The recovery
 *  link is routed through /auth/callback, which exchanges the code into a live
 *  session before forwarding here — so on mount we just confirm a session
 *  exists. We also listen for PASSWORD_RECOVERY to cover the hash-based flow. */
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
      window.location.assign("/canvas");
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
