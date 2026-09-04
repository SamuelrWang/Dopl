"use client";

import { useEffect, useState } from "react";

/**
 * Reached in the SYSTEM BROWSER at the end of a desktop sign-in. Both legs land here with the
 * session in the URL FRAGMENT: `/auth/callback?desktop=1` puts it there after exchanging the
 * PKCE code, and GoTrue's magic-link `redirect_to` does the same on its own. We read it and
 * bounce to a `dopl://auth#<tokens>` deep link so the desktop app adopts it.
 *
 * ⚠ THIS PAGE MUST NOT CONSTRUCT A SUPABASE CLIENT (2026-09-04 sign-out root cause). It used to
 * call `getSupabaseBrowser().auth.getSession()`, which meant the browser HELD the same session
 * the app was about to adopt — and `detectSessionInUrl` would have re-planted it here even if
 * the callback stopped writing cookies. Supabase rotates the refresh token on every use and
 * revokes the WHOLE family when a rotated one is presented again (`refresh_token_already_used`,
 * "Possible abuse attempt"). The desktop rotates hourly; this browser copy never rotated at all,
 * so the next time anything refreshed it — the page's own supabase-js, or `src/proxy.ts`'s
 * `getClaims()` on a later visit — GoTrue killed the family and the app's LIVE token died
 * mid-life. Field evidence: refresh_tokens 3781 reused 2026-09-04T01:33:57Z and 3784 reused
 * 22:45:16Z, each revoking the desktop's current token minutes before it signed the user out.
 *
 * ONE FAMILY, ONE HOLDER: after this page runs, the app is the only holder.
 */
function buildDeepLink(params: URLSearchParams, state: string): string {
  const out = new URLSearchParams({
    access_token: params.get("access_token") || "",
    refresh_token: params.get("refresh_token") || "",
  });
  for (const key of ["expires_in", "expires_at"]) {
    const value = params.get(key);
    if (value) out.set(key, value);
  }
  // ⚠ Echo the app's login-CSRF nonce (armed by main, threaded desktop-start → callback → here)
  // so captureFromFragment can demand an EXACT match, not the weaker presence+TTL gate.
  if (state) out.set("state", state);
  return `dopl://auth#${out.toString()}`;
}

export default function DesktopHandoffPage() {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // ⚠ OFF THE MOUNT RENDER, deliberately (and as this page has always been written): the
    // real effect here is a NAVIGATION, and the two `setState`s only dress the fallback UI
    // behind it. Calling them synchronously in the effect body cascades a render for a page
    // that is about to leave — `react-hooks/set-state-in-effect` says so and it is right.
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const search = new URLSearchParams(window.location.search);
      // The nonce has always ridden in the query: GoTrue's magic-link `redirect_to` carries it
      // there, and the callback keeps the same shape so there is one rule, not two.
      const state = search.get("state") || "";

      if (!hash.get("access_token") || !hash.get("refresh_token")) {
        setError(
          hash.get("error_description") ||
            hash.get("error") ||
            "No session was handed back. Please return to the app and try signing in again."
        );
        return;
      }

      const link = buildDeepLink(hash, state);
      // Scrub the tokens out of the address bar and history BEFORE navigating away. The deep
      // link still carries them (that is the transport), but this page's URL need not keep them.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setDeepLink(link);
      window.location.href = link;
    });
    return () => {
      alive = false;
    };
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
