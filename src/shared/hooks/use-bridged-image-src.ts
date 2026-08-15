"use client";

/**
 * THE one `<img src>` resolver for images this app does not host.
 *
 * The packaged SPA is a `file://` document under `img-src 'self' data: blob:
 * <supabase-storage>`, while `profiles.avatar_url` is an open-ended provider
 * origin set that cannot be pinned in a policy — so OAuth avatars rendered as
 * initials. Main holds no CSP and has a bounded cached image proxy, reached via
 * `bridge.avatarDataUri`.
 *
 * Contract:
 *  - ⚠ WEB (no SPA bridge): input returned VERBATIM, synchronously, no request,
 *    no state change — byte-identical rendering, including under SSR.
 *  - SPA: a URL the CSP already permits (relative/bundled, `data:`, `blob:`,
 *    same-origin, Supabase storage) also passes through.
 *  - Only a FOREIGN http(s) URL goes to main. `undefined` while in flight and
 *    forever if main refuses — the "no image" state callers already render
 *    initials for, so a refusal needs no new call-site branch.
 *
 * ⚠ Main is the authority on WHICH foreign hosts are fetchable
 * (`dopl-desktop-app/main/avatar-policy.js`); this hook decides only whether to
 * ASK, and never widens anything.
 */

import { useEffect, useState } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";

const HTTP_URL_RE = /^https?:\/\//i;

/** Process-lifetime memo: a remount (virtualized list, reopened dialog) would
 *  otherwise pay an IPC round trip AND flash back to initials for a frame.
 *  `null` is a remembered refusal, so a broken avatar is asked about once. */
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
      // ⚠ Anything not a `data:image/` URI (older or tampered main) is a
      // refusal — never dropped into `img.src` unexamined.
      const value =
        typeof uri === "string" && uri.startsWith("data:image/") ? uri : null;
      resolved.set(url, value);
      return value;
    })
    .catch(() => {
      // Refusal, not a crash. ⚠ NOT remembered — an IPC failure (window
      // tearing down, main restarting) is transient, a policy refusal is not.
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
  // Relative, `data:`, `blob:` — CSP allows all three, and `new URL()` would
  // need a base for the first.
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
    // Supabase storage is the one remote origin the packaged CSP names.
    return u.hostname.toLowerCase().endsWith(".supabase.co");
  } catch {
    // Unparseable: hand it to the <img> untouched.
    return true;
  }
}

/** `url` → src to render, or `undefined` for "no image yet" (keep the caller's
 *  initials fallback). Safe to call unconditionally; pass `null` for no image. */
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

  // Seeded from cache so a remount paints on FIRST render, not after a flash.
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
    // ⚠ `ask` is a fresh bound fn each render; URL is the real key and bridge
    // identity never changes within a renderer's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, ask === null]);

  return ask ? proxied : raw;
}

/** Test seam: drop the process-lifetime memo between cases. */
export function __resetBridgedImageCache(): void {
  resolved.clear();
  inFlight.clear();
}
