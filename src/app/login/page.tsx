"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

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
  // Default to /welcome so first-time users hit the onboarding flow.
  // /welcome itself server-redirects to /canvas for already-onboarded
  // users, so returning sign-ins cost one extra redirect and nothing else.
  // Deep links that pass an explicit ?redirectTo= override this.
  const redirectTo = searchParams.get("redirectTo") || "/welcome";
  // Optional "install this cluster after sign-in" intent. Threaded
  // through to /auth/callback so OAuth + email-confirm flows can run
  // the fork server-side; on the email/password path we run it from
  // here just before pushing to redirectTo.
  const installCluster = searchParams.get("installCluster");

  // Build the callback URL for OAuth / email-confirm flows. Only safe
  // to call inside event handlers — `window` isn't defined during
  // server render.
  function buildCallbackUrl(): string {
    const params = new URLSearchParams({ redirectTo });
    if (installCluster) params.set("installCluster", installCluster);
    return `${window.location.origin}/auth/callback?${params.toString()}`;
  }

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
        // Email/password login skips /auth/callback, so we run the
        // install-on-sign-in intent client-side here. Self-fork and
        // duplicate-import errors are swallowed — the visitor still
        // lands on /canvas with the cluster (already) present.
        if (installCluster) {
          try {
            await fetch(`/api/community/${encodeURIComponent(installCluster)}/fork`, {
              method: "POST",
            });
          } catch {
            // Intentional: install is best-effort here.
          }
        }
        router.push(redirectTo);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: buildCallbackUrl(),
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
        redirectTo: buildCallbackUrl(),
      },
    });
    if (error) {
      setError(error.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Background image — same as landing hero */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/img/background_image.png')" }}
      />
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/30" />
      {/* Content */}
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 relative z-10"
        style={{ animation: "loginFadeIn 0.6s ease-out both" }}
      >
        {/* Title */}
        <div
          className="text-center mb-6 relative z-10"
          style={{ animation: "loginFadeIn 0.6s ease-out both" }}
        >
          <h1
            className="text-xl font-bold mb-2"
            style={{
              fontFamily: "var(--font-playfair), 'Playfair Display', serif",
              fontStyle: "italic",
              color: "white",
            }}
          >
            Dopl
          </h1>
        </div>

        {/* Glass panel */}
        <div
          className="w-full max-w-sm relative z-10 p-6 rounded-2xl bg-[var(--card-surface-elevated)] border border-white/[0.2] shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.15)]"
          style={{
            animation: "loginFadeIn 0.6s ease-out both",
            animationDelay: "0.1s",
          }}
        >
          {/* OAuth buttons */}
          <div className="space-y-2 mb-4">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5
                border border-white/20 bg-white/10 hover:bg-white/20 transition-colors cursor-pointer disabled:opacity-50"
            >
              <svg className="w-[17px] h-[17px]" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9086c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" fill="#4285F4" />
                <path d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9086-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853" />
                <path d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1022-1.17.2822-1.71V4.9582H.9573A8.9961 8.9961 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z" fill="#FBBC05" />
                <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5813C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z" fill="#EA4335" />
              </svg>
              <span className="font-mono text-[11px] text-white">
                {mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
              </span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-white/20" />
            <span className="font-mono text-[10px] text-white/50 uppercase tracking-wide">
              or
            </span>
            <div className="flex-1 h-px bg-white/20" />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 border border-red-400/20 bg-red-400/[0.06]">
              <p className="font-mono text-[10px] text-red-300">{error}</p>
            </div>
          )}

          {/* Success */}
          {message && (
            <div className="mb-4 p-3 border border-accent-primary/20 bg-accent-primary/[0.06]">
              <p className="font-mono text-[10px] text-accent-primary">{message}</p>
            </div>
          )}

          {/* Email/Password Form — floating labels (FennaHub style) */}
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="relative mt-4 w-full">
              <input
                type="email"
                id="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder=" "
                className="peer w-full bg-transparent border-0 border-b border-white/20
                  px-0 py-3 text-sm text-white/90
                  placeholder:text-transparent
                  focus:outline-none focus:border-white/60 focus:ring-0
                  transition-colors"
              />
              <label
                htmlFor="login-email"
                className={`pointer-events-none absolute left-0 font-mono uppercase tracking-[0.1em] transition-all duration-300 ${
                  email.length > 0
                    ? "-top-[10px] text-[9px] text-white/80"
                    : "top-[12px] text-[11px] text-white/40"
                } peer-focus:-top-[10px] peer-focus:text-[9px] peer-focus:text-accent-primary`}
              >
                Email
              </label>
            </div>
            <div className="relative mt-4 w-full">
              <input
                type="password"
                id="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder=" "
                className="peer w-full bg-transparent border-0 border-b border-white/20
                  px-0 py-3 text-sm text-white/90
                  placeholder:text-transparent
                  focus:outline-none focus:border-white/60 focus:ring-0
                  transition-colors"
              />
              <label
                htmlFor="login-password"
                className={`pointer-events-none absolute left-0 font-mono uppercase tracking-[0.1em] transition-all duration-300 ${
                  password.length > 0
                    ? "-top-[10px] text-[9px] text-white/80"
                    : "top-[12px] text-[11px] text-white/40"
                } peer-focus:-top-[10px] peer-focus:text-[9px] peer-focus:text-accent-primary`}
              >
                Password
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 px-4 py-2.5 rounded-full font-mono text-[11px] uppercase tracking-wider
                bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.15] hover:border-white/[0.3]
                text-white/70 hover:text-white/95
                transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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

        {/* Footer links */}
        <p
          className="w-full max-w-sm relative z-10 font-mono text-[9px] text-white/40 text-center mt-4 uppercase tracking-wide"
          style={{ animation: "loginFadeIn 0.6s ease-out both", animationDelay: "0.3s" }}
        >
          <a href="/terms" className="underline hover:text-white transition-colors">Terms of Service</a>
          <span style={{ margin: "0 4px" }}>&middot;</span>
          <a href="/privacy" className="underline hover:text-white transition-colors">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
