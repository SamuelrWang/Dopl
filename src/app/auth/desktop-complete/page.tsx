"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";

/**
 * Loaded INSIDE the desktop app window by the dopl:// deep-link handler, with
 * the session tokens in the URL fragment (#access_token=…&refresh_token=…).
 * We adopt the session into this window's Supabase client (cookie storage) and
 * redirect into the app — now authenticated.
 *
 * Tokens travel in the hash so they never hit the server or server logs.
 */
export default function DesktopCompletePage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(raw);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      setError("Missing sign-in tokens. Please try signing in again.");
      return;
    }

    (async () => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        setError(error.message);
        return;
      }
      // Clear tokens from the URL, then enter the app.
      window.location.replace("/canvas");
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
          <p style={{ fontWeight: 600 }}>Sign-in failed</p>
          <p style={{ color: "#646d78", fontSize: 14, maxWidth: 360 }}>{error}</p>
          <a
            href="/login"
            style={{
              marginTop: 8,
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              background: "#1c2127",
              borderRadius: 11,
              textDecoration: "none",
            }}
          >
            Back to sign in
          </a>
        </>
      ) : (
        <>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "3px solid rgba(35,42,49,0.15)",
              borderTopColor: "#232a31",
              animation: "doplSpin 0.8s linear infinite",
            }}
          >
            <style>{`@keyframes doplSpin{to{transform:rotate(360deg)}}`}</style>
          </div>
          <p style={{ color: "#646d78", fontSize: 14 }}>Signing you in…</p>
        </>
      )}
    </div>
  );
}
