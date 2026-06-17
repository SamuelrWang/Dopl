"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CrystalShell } from "@/shared/design/crystal-field";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";
import { isDesktopApp } from "@/shared/lib/desktop";

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

    // Desktop app: OAuth can't run in the wrapper window (Supabase PKCE needs
    // the code-verifier to live in the same context that exchanges the code).
    // Open the system browser to run the flow there; it hands the finished
    // session back to the app via a dopl:// deep link. window.open is routed
    // to the system browser by the desktop shell's window-open handler.
    if (isDesktopApp()) {
      window.open(`${window.location.origin}/auth/desktop-start`, "_blank");
      setMessage(
        "Continue signing in with Google in your browser. You'll be returned to the Dopl app automatically.",
      );
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: buildCallbackUrl() },
    });
    if (error) {
      setError(error.message);
    }
  }

  // Dark crystal-cave shell: tiled field behind a single dark card.
  return (
    <CrystalShell>
      <div
        className="relative w-full max-w-sm"
        style={{ animation: "loginFadeIn 0.6s ease-out both" }}
      >
        {/* Logo + tagline — outside the card, so they sit over the tiling */}
        <div className="mb-8 text-center">
          <h1
            className="text-4xl font-medium text-[#ECF1F6]"
            style={{
              fontFamily: "var(--font-playfair), Georgia, serif",
              fontStyle: "italic",
            }}
          >
            Dopl
          </h1>
          <p className="mt-3 text-[15px] text-[#B4BFCB]">
            Everything your agents know, in one place.
          </p>
        </div>

        <div
          data-crystal-panel
          className="rounded-[20px] border border-[#2C3A4E] bg-[#131A24] p-8 shadow-[0_12px_50px_rgba(0,0,0,0.6)]"
        >
          {/* Continue with Google */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 mb-3 rounded-[11px]
              border-[1.5px] border-[#33414F] bg-[#1E2836] text-[#ECF1F6] hover:border-[#44566A] hover:bg-[#273341]
              transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg className="w-[17px] h-[17px]" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9086c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9086-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853" />
              <path d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1022-1.17.2822-1.71V4.9582H.9573A8.9961 8.9961 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z" fill="#FBBC05" />
              <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5813C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z" fill="#EA4335" />
            </svg>
            <span className="text-[15px] font-semibold">Continue with Google</span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-[#33414F]" />
            <span className="font-mono text-[10px] text-[#74808C] uppercase tracking-wide">
              or
            </span>
            <div className="flex-1 h-px bg-[#33414F]" />
          </div>

          {error && (
            <div className="mb-3 p-3 rounded-[11px] border-[1.5px] border-red-500/30 bg-red-500/10">
              <p className="text-[13px] text-red-300">{error}</p>
            </div>
          )}
          {message && (
            <div className="mb-3 p-3 rounded-[11px] border-[1.5px] border-[#4C8DF5]/40 bg-[#1C3252]">
              <p className="text-[13px] text-[#E4EAF1]">{message}</p>
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
                className="peer w-full bg-transparent border-0 border-b-[1.5px] border-[#33414F]
                  px-0 py-3 text-[15px] text-[#ECF1F6]
                  placeholder:text-transparent
                  focus:outline-none focus:border-[#4C8DF5] focus:ring-0
                  transition-colors"
              />
              <label
                htmlFor="login-email"
                className={`pointer-events-none absolute left-0 font-mono uppercase tracking-[0.1em] transition-all duration-300 ${
                  email.length > 0
                    ? "-top-[10px] text-[9px] text-[#B4BFCB]"
                    : "top-[12px] text-[11px] text-[#74808C]"
                } peer-focus:-top-[10px] peer-focus:text-[9px] peer-focus:text-[#4C8DF5]`}
              >
                Email
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-6 px-4 py-3 rounded-[11px] text-[15px] font-semibold
                bg-[#2E6FD8] text-white hover:bg-[#3B82F6]
                transition-colors disabled:bg-[#1E2836] disabled:text-[#7E8794] disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? "Sending link..." : "Continue with Email"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-[12px] text-[#74808C] mt-6 text-center leading-relaxed">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline hover:text-[#B4BFCB] transition-colors">Terms of Service</Link>
          {" "}and{" "}
          <Link href="/privacy" className="underline hover:text-[#B4BFCB] transition-colors">Privacy Policy</Link>.
        </p>
      </div>
    </CrystalShell>
  );
}
