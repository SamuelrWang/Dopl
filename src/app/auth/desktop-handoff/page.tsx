"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

/**
 * Reached in the SYSTEM BROWSER right after a successful desktop OAuth exchange
 * (/auth/callback?desktop=1 redirects here). The browser now holds the session;
 * we read it and bounce to a `dopl://auth#<tokens>` deep link so the desktop app
 * can adopt the session in its own window.
 *
 * The app used to finish by loading /auth/desktop-complete with the same tokens and
 * calling setSession there — a page that existed so the retired remote shell could plant
 * its cookie jar. Stage D (2026-08-06) deleted both: the desktop captures the tokens
 * straight off the deep-link fragment, and loading that page stranded the window on
 * "Signing you in…". This page is unchanged; only what happens after the handoff is.
 */
function buildDeepLink(
  accessToken: string,
  refreshToken: string,
  state: string
): string {
  const params = new URLSearchParams({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  // Echo the app's login-CSRF nonce (armed by main, threaded through
  // desktop-start → callback → here) so captureFromFragment can demand an
  // EXACT match instead of the weaker presence+TTL gate.
  if (state) params.set("state", state);
  return `dopl://auth#${params.toString()}`;
}

export default function DesktopHandoffPage() {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setError("No active session found. Please return to the app and try signing in again.");
        return;
      }
      const state = new URLSearchParams(window.location.search).get("state") || "";
      const link = buildDeepLink(
        data.session.access_token,
        data.session.refresh_token,
        state
      );
      setDeepLink(link);
      // Auto-trigger the app. The browser will prompt to open "Dopl".
      window.location.href = link;
    })();
  }, []);

  return (
    // No font-family of its own: `body` already sets `var(--font-app)`, which
    // globals.css pins to the landing page's grotesk (`.lp` --grotesk =
    // Helvetica Neue). The `system-ui` this used to hard-set was the only
    // reason the handoff read as a different product than the page the user
    // came from. `bg-white` matches the login page's surface
    // (`auth-split-layout.tsx` › AuthSplitLayout) — without an explicit
    // surface the body's `.mosaic-bg` app-frame navy shows through.
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-white p-6 text-center text-text-primary">
      {error ? (
        <>
          <p className="text-display font-semibold tracking-tight text-text-primary">
            Sign-in incomplete
          </p>
          <p className="max-w-sm text-title text-text-secondary">{error}</p>
        </>
      ) : (
        <>
          <p className="text-display font-semibold tracking-tight text-text-primary">
            You’re signed in ✓
          </p>
          <p className="max-w-sm text-title text-text-secondary">
            Returning you to the Dopl app… If nothing happens, click below.
          </p>
          {deepLink && (
            // The kit's raised primary CTA (`.auth-btn-3d`, globals.css) — the
            // same 3D face the landing hero's "Get Started" wears
            // (`.lp-btn--3d` is a copy of this recipe). `rounded-full` is
            // applied HERE, at the call site, because the kit class carries no
            // radius of its own — the same call-site pill the login submit
            // button uses (`features/auth/components/login-form-core.tsx`).
            <a
              href={deepLink}
              className="auth-btn-3d mt-2 inline-flex h-10 cursor-pointer items-center justify-center rounded-full px-6 text-title font-semibold text-white no-underline"
            >
              Open the Dopl app
            </a>
          )}
          <p className="mt-2 text-small text-text-muted">
            You can close this tab once the app opens.
          </p>
        </>
      )}
    </div>
  );
}
