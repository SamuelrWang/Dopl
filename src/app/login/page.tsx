"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  // Workspace + canvas are auto-provisioned in /auth/callback before
  // redirect, so first-time users land directly in their workspace.
  // Deep links override via an explicit ?redirectTo= but only if
  // same-origin (open redirect guard — see safeRedirect doc).
  const redirectTo = safeRedirect(searchParams.get("redirectTo"));
  // Optional "install this cluster after sign-in" intent. Threaded
  // through to /auth/callback so OAuth + magic-link flows can run the
  // fork server-side; visitor lands on /canvas with the cluster present.
  const installCluster = searchParams.get("installCluster");

  function buildCallbackUrl(): string {
    const params = new URLSearchParams({ redirectTo });
    if (installCluster) params.set("installCluster", installCluster);
    return `${window.location.origin}/auth/callback?${params.toString()}`;
  }

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = getSupabaseBrowser();

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      // Magic link: works for both new and existing users — Supabase
      // creates the auth.users row on first link if it doesn't exist.
      // Collapses sign-in / sign-up into a single "continue" flow.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: buildCallbackUrl() },
      });
      if (error) throw error;
      setMessage("Check your email for a sign-in link.");
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
      options: { redirectTo: buildCallbackUrl() },
    });
    if (error) {
      setError(error.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-black">
      {/* Left — auth */}
      <div className="flex flex-1 items-center justify-center px-6 lg:px-12 bg-[var(--card-surface-elevated)]">
        <div
          className="w-full max-w-sm"
          style={{ animation: "loginFadeIn 0.6s ease-out both" }}
        >
          {/* Logo */}
          <div className="mb-10">
            <h1
              className="text-3xl font-bold"
              style={{
                fontFamily: "var(--font-playfair), 'Playfair Display', serif",
                fontStyle: "italic",
                color: "white",
              }}
            >
              Dopl
            </h1>
          </div>

          {/* Continue with Google */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 mb-3
              border border-white/20 bg-white/[0.04] hover:bg-white/[0.10] transition-colors
              cursor-pointer disabled:opacity-50"
          >
            <svg className="w-[17px] h-[17px]" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9086c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9086-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853" />
              <path d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1022-1.17.2822-1.71V4.9582H.9573A8.9961 8.9961 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z" fill="#FBBC05" />
              <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5813C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z" fill="#EA4335" />
            </svg>
            <span className="font-mono text-[11px] text-white">
              Continue with Google
            </span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-white/15" />
            <span className="font-mono text-[10px] text-white/40 uppercase tracking-wide">
              or
            </span>
            <div className="flex-1 h-px bg-white/15" />
          </div>

          {error && (
            <div className="mb-3 p-3 border border-red-400/20 bg-red-400/[0.06]">
              <p className="font-mono text-[10px] text-red-300">{error}</p>
            </div>
          )}
          {message && (
            <div className="mb-3 p-3 border border-accent-primary/20 bg-accent-primary/[0.06]">
              <p className="font-mono text-[10px] text-accent-primary">{message}</p>
            </div>
          )}

          {/* Email — single "continue" flow via magic link */}
          <form onSubmit={handleEmailSubmit}>
            <div className="relative w-full">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-5 px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider
                bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.15] hover:border-white/[0.3]
                text-white/70 hover:text-white/95
                transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? "Sending link..." : "Continue with Email"}
            </button>
          </form>

          {/* Footer */}
          <p className="font-mono text-[9px] text-white/30 mt-10 uppercase tracking-wide leading-relaxed">
            By continuing, you agree to our{" "}
            <a href="/terms" className="underline hover:text-white/70 transition-colors">Terms of Service</a>
            {" "}and{" "}
            <a href="/privacy" className="underline hover:text-white/70 transition-colors">Privacy Policy</a>.
          </p>
        </div>
      </div>

      {/* Right — quote + animated orbs (hidden on narrow viewports) */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/img/background_image.png')" }}
        />
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
        <div className="absolute inset-0 bg-gradient-to-br from-black/50 via-black/20 to-black/40" />

        <div
          className="relative z-10 flex flex-col justify-center px-16 max-w-2xl"
          style={{ animation: "loginFadeIn 0.8s ease-out 0.2s both" }}
        >
          <p
            className="text-4xl text-white leading-snug mb-8"
            style={{
              fontFamily: "var(--font-playfair), 'Playfair Display', serif",
              fontStyle: "italic",
            }}
          >
            &ldquo;The future is built by those who refuse to wait for it.&rdquo;
          </p>
          <p className="font-mono text-[11px] text-white/70 uppercase tracking-[0.2em]">
            Dopl &mdash; Your AI workspace
          </p>
        </div>
      </div>
    </div>
  );
}
