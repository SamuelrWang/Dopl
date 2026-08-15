"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

/**
 * Desktop OAuth entry point — opened in the user's SYSTEM BROWSER by the Dopl
 * desktop app. Running the OAuth here (not in the app's wrapper window) is
 * required: Supabase PKCE stores the code-verifier in this browser context, and
 * /auth/callback must exchange the code in the same context. The `desktop=1`
 * flag tells the callback to hand the finished session back to the app via
 * /auth/desktop-handoff → a dopl:// deep link.
 */
export default function DesktopStartPage() {
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<"google" | "github">("google");

  useEffect(() => {
    (async () => {
      // Closed enum from the query string — the desktop app's OAuth buttons
      // pass ?provider=github; anything unrecognized degrades to google.
      const search = new URLSearchParams(window.location.search);
      const requested = search.get("provider");
      const p: "google" | "github" = requested === "github" ? "github" : "google";
      setProvider(p);
      // Echo the app's login-CSRF nonce through the whole flow: it rides
      // the callback redirect into /auth/desktop-handoff, which puts it in
      // the dopl:// fragment — letting the app demand an EXACT state match
      // instead of the weaker presence+TTL gate.
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
    // Same shell as its sibling /auth/desktop-handoff, class for class: no
    // font-family of its own (`body` already sets `var(--font-app)`, the
    // landing page's grotesk — the `system-ui` this used to hard-set was the
    // only reason the redirect read as a different product than the page the
    // user came from). `bg-white` matches the login page's surface
    // (`auth-split-layout.tsx` › AuthSplitLayout) — without an explicit
    // surface the body's `.mosaic-bg` app-frame navy shows through.
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-white p-6 text-center text-text-primary">
      {children}
    </div>
  );
}

function Spinner() {
  // Ring drawn from the ink token at two strengths (15% track, solid head)
  // instead of the literal #232a31 pair, and spun by Tailwind's own
  // `animate-spin` — the hand-rolled `@keyframes` this injected into the
  // document was a local recipe for something the framework already ships.
  return (
    <div className="size-7 animate-spin rounded-full border-[3px] border-text-primary/15 border-t-text-primary" />
  );
}
