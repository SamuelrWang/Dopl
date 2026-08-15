"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

/**
 * Reached in the SYSTEM BROWSER right after a desktop OAuth exchange (`/auth/callback?desktop=1`
 * redirects here). The browser holds the session; we read it and bounce to a
 * `dopl://auth#<tokens>` deep link so the desktop app adopts it in its own window.
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
  // ⚠ Echo the app's login-CSRF nonce (armed by main, threaded desktop-start → callback → here)
  // so captureFromFragment can demand an EXACT match, not the weaker presence+TTL gate.
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
      window.location.href = link;
    })();
  }, []);

  return (
    // ⚠ No font-family of its own — `body` already sets `var(--font-app)`; a hard-set
    // `system-ui` makes the handoff read as a different product than the page before it.
    // ⚠ `bg-white` matches the login surface (`auth-split-layout.tsx` › AuthSplitLayout); without
    // an explicit surface the body's `.mosaic-bg` app-frame navy shows through.
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
            // Kit raised primary CTA (`.auth-btn-3d`, globals.css). ⚠ `rounded-full` belongs at
            // the CALL SITE — the kit class carries no radius, same as the login submit button.
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
