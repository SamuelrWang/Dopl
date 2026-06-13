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

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?desktop=1` },
      });
      if (error) setError(error.message);
    })();
  }, []);

  return (
    <Shell>
      {error ? (
        <>
          <p style={{ fontWeight: 600 }}>Couldn’t start sign-in</p>
          <p style={{ color: "#646d78", fontSize: 14 }}>{error}</p>
        </>
      ) : (
        <>
          <Spinner />
          <p style={{ color: "#646d78", fontSize: 14 }}>Redirecting to Google…</p>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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
      {children}
    </div>
  );
}

function Spinner() {
  return (
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
  );
}
