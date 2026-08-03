"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

/**
 * Reached in the SYSTEM BROWSER right after a successful desktop OAuth exchange
 * (/auth/callback?desktop=1 redirects here). The browser now holds the session;
 * we read it and bounce to a `dopl://auth#<tokens>` deep link so the desktop app
 * can adopt the session in its own window. The app loads /auth/desktop-complete
 * with the same tokens and calls setSession there.
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "#d6dee7",
        color: "#232a31",
        textAlign: "center",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {error ? (
        <>
          <p style={{ fontWeight: 600 }}>Sign-in incomplete</p>
          <p style={{ color: "#646d78", fontSize: 14, maxWidth: 360 }}>{error}</p>
        </>
      ) : (
        <>
          <p style={{ fontWeight: 600, fontSize: 18 }}>You’re signed in ✓</p>
          <p style={{ color: "#646d78", fontSize: 14, maxWidth: 360 }}>
            Returning you to the Dopl app… If nothing happens, click below.
          </p>
          {deepLink && (
            <a
              href={deepLink}
              style={{
                marginTop: 8,
                padding: "10px 22px",
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                background: "#1c2127",
                borderRadius: 8,
                textDecoration: "none",
              }}
            >
              Open the Dopl app
            </a>
          )}
          <p style={{ color: "#98a2ad", fontSize: 12, marginTop: 8 }}>
            You can close this tab once the app opens.
          </p>
        </>
      )}
    </div>
  );
}
