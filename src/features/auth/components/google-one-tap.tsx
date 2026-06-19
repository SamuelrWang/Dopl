"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";

/**
 * Google One Tap — the auto-appearing "Sign in with Google" prompt (top-right
 * in most browsers, or the FedCM chip). Loads Google Identity Services, then
 * exchanges the returned ID token for a Supabase session via
 * `signInWithIdToken`. A nonce is bound to the request: the SHA-256 hash goes to
 * Google, the raw value to Supabase, so the token can't be replayed.
 *
 * Inert until configured — renders null and does nothing unless
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID is set. Setup also requires (a) that client ID's
 * authorized JavaScript origins to include this app's domains in Google Cloud,
 * and (b) the same client ID added to the Google provider's "Authorized Client
 * IDs" in the Supabase dashboard.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";

type CredentialResponse = { credential: string };

type GoogleIdConfig = {
  client_id: string;
  callback: (response: CredentialResponse) => void;
  nonce?: string;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfig) => void;
          prompt: () => void;
        };
      };
    };
  }
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${GIS_SRC}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
}

async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { raw, hashed };
}

export function GoogleOneTap() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    const init = async () => {
      const supabase = getSupabaseBrowser();
      // Don't prompt a user who's already signed in.
      const { data } = await supabase.auth.getSession();
      if (cancelled || data.session) return;

      const { raw, hashed } = await makeNonce();
      await loadGis();
      if (cancelled || !window.google) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        nonce: hashed,
        use_fedcm_for_prompt: true,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response) => {
          void (async () => {
            const { error } = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: response.credential,
              nonce: raw,
            });
            if (!error) window.location.assign(safeRedirect(searchParams.get("redirectTo")));
          })();
        },
      });
      window.google.accounts.id.prompt();
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [clientId, searchParams]);

  return null;
}
