"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-base)] px-6">
      {/* Ambient orbs behind the card */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
      </div>

      <div
        className="relative z-10 w-full max-w-sm"
        style={{ animation: "loginFadeIn 0.6s ease-out both" }}
      >
        {/* Logo + tagline */}
        <div className="mb-8 text-center">
          <h1
            className="text-4xl font-bold text-[var(--text-primary)]"
            style={{
              fontFamily: "var(--font-playfair), 'Playfair Display', serif",
              fontStyle: "italic",
            }}
          >
            Dopl
          </h1>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Your AI workspace
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 shadow-2xl">
          {/* Continue with Google */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 mb-3 rounded-lg
              border border-[var(--border-strong)] bg-[var(--bg-inset)] hover:bg-[var(--bg-inset-hover)]
              transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg className="w-[17px] h-[17px]" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9086c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9086-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853" />
              <path d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1022-1.17.2822-1.71V4.9582H.9573A8.9961 8.9961 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z" fill="#FBBC05" />
              <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5813C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z" fill="#EA4335" />
            </svg>
            <span className="font-mono text-[11px] text-[var(--text-primary)]">
              Continue with Google
            </span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-[var(--border-default)]" />
            <span className="font-mono text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
              or
            </span>
            <div className="flex-1 h-px bg-[var(--border-default)]" />
          </div>

          {error && (
            <div className="mb-3 p-3 rounded-lg border border-red-400/20 bg-red-400/[0.06]">
              <p className="font-mono text-[10px] text-red-300">{error}</p>
            </div>
          )}
          {message && (
            <div className="mb-3 p-3 rounded-lg border border-accent-primary/20 bg-accent-primary/[0.06]">
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
                className="peer w-full bg-transparent border-0 border-b border-[var(--border-strong)]
                  px-0 py-3 text-sm text-[var(--text-primary)]
                  placeholder:text-transparent
                  focus:outline-none focus:border-[var(--border-highlight)] focus:ring-0
                  transition-colors"
              />
              <label
                htmlFor="login-email"
                className={`pointer-events-none absolute left-0 font-mono uppercase tracking-[0.1em] transition-all duration-300 ${
                  email.length > 0
                    ? "-top-[10px] text-[9px] text-[var(--text-secondary)]"
                    : "top-[12px] text-[11px] text-[var(--text-muted)]"
                } peer-focus:-top-[10px] peer-focus:text-[9px] peer-focus:text-accent-primary`}
              >
                Email
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-5 px-4 py-2.5 rounded-lg font-mono text-[11px] uppercase tracking-wider
                bg-[var(--bg-inset)] hover:bg-[var(--bg-inset-hover)]
                border border-[var(--border-default)] hover:border-[var(--border-strong)]
                text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? "Sending link..." : "Continue with Email"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="font-mono text-[9px] text-[var(--text-muted)] mt-6 text-center uppercase tracking-wide leading-relaxed">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline hover:text-[var(--text-secondary)] transition-colors">Terms of Service</Link>
          {" "}and{" "}
          <Link href="/privacy" className="underline hover:text-[var(--text-secondary)] transition-colors">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
