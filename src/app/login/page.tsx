"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { Orb } from "@/components/design";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/canvas";

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = getSupabaseBrowser();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push(redirectTo);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${redirectTo}`,
          },
        });
        if (error) throw error;
        setMessage("Check your email for a confirmation link.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirectTo=${redirectTo}`,
      },
    });
    if (error) {
      setError(error.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Background image */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: "url('/img/landing_background.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      {/* Dark overlay — heavy to push the image way back */}
      <div className="absolute inset-0 z-[1] bg-black/70" />

      {/* Content */}
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 relative z-10"
        style={{ animation: "loginFadeIn 0.6s ease-out both" }}
      >
        {/* Title */}
        <div
          className="text-center mb-6"
          style={{ animation: "loginFadeIn 0.6s ease-out both" }}
        >
          <div className="flex justify-center mb-3">
            <Orb size="lg" glow="strong" />
          </div>
          <h1 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/70">
            Setup Intelligence Engine
          </h1>
        </div>

        {/* Glass panel — matches Surface elevated + card shape */}
        <div
          className="w-full max-w-sm relative z-10 p-6 rounded-2xl border border-[var(--border-default)] backdrop-blur-xl backdrop-saturate-[1.4]"
          style={{
            animation: "loginFadeIn 0.6s ease-out both",
            animationDelay: "0.1s",
            background: "var(--gradient-elevated)",
            boxShadow:
              "var(--shadow-elevated), var(--inset-highlight)",
          }}
        >
          {/* OAuth buttons */}
          <div className="space-y-2 mb-4">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg
                border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="white" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="white" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="white" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="white" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span className="font-mono text-[11px] text-white">
                {mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-white/[0.08]" />
            <span className="font-mono text-[10px] text-white/40 uppercase tracking-wide">
              or
            </span>
            <div className="flex-1 h-px bg-white/[0.08]" />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 rounded-lg border border-red-400/20 bg-red-400/[0.06]">
              <p className="font-mono text-[10px] text-red-300">{error}</p>
            </div>
          )}

          {/* Success */}
          {message && (
            <div className="mb-4 p-3 rounded-lg border border-accent-primary/20 bg-accent-primary/[0.06]">
              <p className="font-mono text-[10px] text-accent-primary">{message}</p>
            </div>
          )}

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="font-mono text-[9px] text-white/40 uppercase tracking-wide block mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg text-sm
                  bg-black/[0.3] border border-white/[0.08] text-white/90
                  placeholder:text-white/30
                  focus:outline-none focus:border-white/[0.18]
                  transition-all"
              />
            </div>
            <div>
              <label className="font-mono text-[9px] text-white/40 uppercase tracking-wide block mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2.5 rounded-lg text-sm
                  bg-black/[0.3] border border-white/[0.08] text-white/90
                  placeholder:text-white/30
                  focus:outline-none focus:border-white/[0.18]
                  transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-full bg-accent-primary text-black font-mono text-[11px] uppercase tracking-wide
                hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading
                ? "Loading..."
                : mode === "login"
                  ? "Sign In"
                  : "Sign Up"}
            </button>
          </form>

          {/* Toggle mode */}
          <div className="mt-1.5 text-center">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
                setMessage(null);
              }}
              className="font-mono text-[9px] text-white/50 hover:text-white uppercase tracking-wide transition-colors cursor-pointer"
            >
              {mode === "login" ? "Or sign up" : "Already have an account? Sign in \u2192"}
            </button>
          </div>
        </div>
      </div>

      {/* loginFadeIn keyframe defined in globals.css */}
    </div>
  );
}
