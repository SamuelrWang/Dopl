"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

/**
 * Desktop OAuth entry point, opened in the user's SYSTEM BROWSER by the desktop app.
 * ⚠ Running the OAuth here rather than in the app's wrapper window is REQUIRED: Supabase PKCE
 * stores the code-verifier in this browser context and /auth/callback must exchange the code in
 * the same one. `desktop=1` tells the callback to hand the session back via /auth/desktop-handoff
 * → a dopl:// deep link.
 */
export default function DesktopStartPage() {
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<"google" | "github">("google");

  useEffect(() => {
    (async () => {
      // Closed enum: ?provider=github; anything unrecognized degrades to google.
      const search = new URLSearchParams(window.location.search);
      const requested = search.get("provider");
      const p: "google" | "github" = requested === "github" ? "github" : "google";
      setProvider(p);
      // ⚠ Echo the app's login-CSRF nonce through the whole flow (callback → desktop-handoff →
      // dopl:// fragment) so the app can demand an EXACT state match, not presence+TTL.
      const state = search.get("state") || "";
      const stateQs = state ? `&state=${encodeURIComponent(state)}` : "";
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: p,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?desktop=1${stateQs}`,
        },
      });
      if (error) setError(error.message);
    })();
  }, []);

  return (
    <Shell>
      {error ? (
        <>
          <p className="text-display font-semibold tracking-tight text-text-primary">
            Couldn’t start sign-in
          </p>
          <p className="max-w-sm text-title text-text-secondary">{error}</p>
        </>
      ) : (
        <>
          <Spinner />
          <p className="max-w-sm text-title text-text-secondary">
            Redirecting to {provider === "github" ? "GitHub" : "Google"}…
          </p>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    // ⚠ Same shell as /auth/desktop-handoff, class for class. No font-family of its own (`body`
    // sets `var(--font-app)`); `bg-white` matches the login surface, without which the body's
    // `.mosaic-bg` app-frame navy shows through.
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-white p-6 text-center text-text-primary">
      {children}
    </div>
  );
}

function Spinner() {
  // Ring from the ink token at two strengths (15% track, solid head), spun by Tailwind's
  // `animate-spin` — no hand-rolled `@keyframes`.
  return (
    <div className="size-7 animate-spin rounded-full border-[3px] border-text-primary/15 border-t-text-primary" />
  );
}
