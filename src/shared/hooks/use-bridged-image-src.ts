"use client";

/**
 * THE one `<img src>` resolver for images this app does not host.
 *
 * WHY IT EXISTS. The packaged desktop SPA is a `file://` document under
 * `img-src 'self' data: blob: <supabase-storage>` (apps/desktop-ui/
 * vite.config.ts). `profiles.avatar_url` is whatever the OAuth provider put in
 * `raw_user_meta_data` — `lh3.googleusercontent.com`,
 * `avatars.githubusercontent.com`, and whatever a future provider returns — an
 * open-ended origin set that CANNOT be pinned in a policy, so every OAuth
 * avatar rendered as initials. Main can fetch it though: it holds no CSP and
 * already has a bounded, cached image proxy (`dopl-desktop-app/main/
 * avatar-cache.js`), reached here through `bridge.avatarDataUri`.
 *
 * WHAT IT PROMISES.
 *  - On the WEB (no SPA bridge) the input is returned VERBATIM, synchronously,
 *    with no request and no state change. Web rendering is byte-identical to
 *    what it was before this hook existed — including under SSR, where the
 *    effect never runs.
 *  - In the SPA, a URL the CSP already permits (relative/bundled asset,
 *    `data:`, `blob:`, same-origin, Supabase storage) is likewise passed
 *    through: proxying it would be a pointless round trip.
 *  - Only a FOREIGN http(s) URL goes to main. It is `undefined` while the
 *    round trip is in flight and `undefined` forever if main refuses — which
 *    is exactly the "no image" state every caller already renders initials
 *    for, so a refusal needs no new branch at any call site.
 *
 * Main is the authority on WHICH foreign hosts are fetchable
 * (`dopl-desktop-app/main/avatar-policy.js`). This hook decides only whether
 * to ASK; it never widens anything.
 */

import { useEffect, useState } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";

const HTTP_URL_RE = /^https?:\/\//i;

/**
 * Resolutions live for the process: main memoizes the fetch, but a component
 * that remounts (a virtualized member list, a reopened dialog) would still pay
 * an IPC round trip AND flash back to initials for a frame. The map makes a
 * second mount of the same avatar synchronous. `null` is a remembered refusal,
 * so a broken avatar is asked about once.
 */
const resolved = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

function resolveOnce(
  url: string,
  ask: (url: string) => Promise<string | null>
): Promise<string | null> {
  const pending = inFlight.get(url);
  if (pending) return pending;
  const p = ask(url)
    .then((uri) => {
      // The bridge answers a `data:` URI or null. Anything else (an older or
      // tampered main) is treated as a refusal rather than dropped into
      // `img.src` unexamined.
      const value =
        typeof uri === "string" && uri.startsWith("data:image/") ? uri : null;
      resolved.set(url, value);
      return value;
    })
    .catch(() => {
      // A rejected bridge call is a refusal, not a crash. NOT remembered: an
      // IPC failure (window tearing down, main restarting) is transient in a
      // way a policy refusal is not.
      return null;
    })
    .finally(() => {
      inFlight.delete(url);
    });
  inFlight.set(url, p);
  return p;
}

/** True when the packaged renderer can load this URL directly under its CSP. */
function isDirectlyRenderable(url: string): boolean {
  // Relative paths, `data:` and `blob:` are bundled or already inline — the
  // CSP allows all three, and `new URL()` would need a base for the first.
  if (!HTTP_URL_RE.test(url)) return true;
  try {
    const u = new URL(url);
    if (
      typeof window !== "undefined" &&
      window.location &&
      u.origin === window.location.origin
    ) {
      return true;
    }
    // Supabase storage is the one remote origin the packaged CSP names —
    // workspace icons are public-bucket objects there.
    return u.hostname.toLowerCase().endsWith(".supabase.co");
  } catch {
    // Unparseable: hand it to the <img> untouched, exactly as before.
    return true;
  }
}

/**
 * `url` → the src to render, or `undefined` for "no image yet" (keep the
 * caller's initials/letter fallback). Safe to call unconditionally at the top
 * of any component; pass `null` when the record has no image.
 */
export function useBridgedImageSrc(
  url: string | null | undefined
): string | undefined {
  const raw = url || undefined;
  const bridge = getSpaBridge();
  const ask =
    raw !== undefined &&
    bridge != null &&
    typeof bridge.avatarDataUri === "function" &&
    !isDirectlyRenderable(raw)
      ? bridge.avatarDataUri.bind(bridge)
      : null;

  // Seeded from the cache so a remount of an already-resolved avatar paints
  // the image on its FIRST render rather than flashing initials.
  const [proxied, setProxied] = useState<string | undefined>(() =>
    ask && raw !== undefined ? resolved.get(raw) || undefined : undefined
  );

  useEffect(() => {
    if (!ask || raw === undefined) return;
    const cached = resolved.get(raw);
    if (cached !== undefined) {
      setProxied(cached || undefined);
      return;
    }
    let live = true;
    setProxied(undefined);
    void resolveOnce(raw, ask).then((uri) => {
      if (live) setProxied(uri || undefined);
    });
    return () => {
      live = false;
    };
    // `ask` is a fresh bound function each render; the URL is the real key and
    // the bridge identity never changes within a renderer's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, ask === null]);

  return ask ? proxied : raw;
}

/** Test seam: drop the process-lifetime memo between cases. */
export function __resetBridgedImageCache(): void {
  resolved.clear();
  inFlight.clear();
}
