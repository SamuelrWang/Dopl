"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLoginActions } from "../hooks/use-login";
import { LoginFormCore } from "./login-form-core";
import type { LoginMode } from "../hooks/use-login-core";

/** Next binding for `./login-form-core` (markup + state machine live there):
 *  supabase actions, `next/link` legal links, and the mode switch.
 *
 *  ⚠ The switch swaps IN PLACE (`onSelect`, the core's crossfade) and rewrites
 *  the URL with `history.pushState` — it no longer performs a route navigation
 *  on a plain click. Both keep their old guarantees by other means: the URL
 *  still always names the flow on screen (the pushState lands the moment the
 *  swap is requested), and back/forward still work because pushState creates a
 *  real history entry — Next then serves the traversal as a client navigation,
 *  which the shared `(auth)` layout absorbs without remounting the banner.
 *  Modifier/middle clicks fall through to the real `<Link>` navigation, so
 *  open-in-new-tab still lands on the right route.
 *
 *  No `brand` — web lockup lives page upper-left (`src/app/(auth)/layout.tsx`).
 *  Desktop binding does pass one. */
export function LoginForm({ defaultMode }: { defaultMode: LoginMode }) {
  const actions = useLoginActions();
  const searchParams = useSearchParams();

  // ⚠ Switch must carry the query. `useLoginActions` reads `?redirectTo=` (and
  // `installCluster`) off the URL; moving to a BARE URL silently drops the deep
  // link for visitors who arrived from one. One slug now — the modes differ
  // only in `?mode=` (absent = sign-in, matching /authenticate's default).
  const href = (mode: LoginMode) => {
    const params = new URLSearchParams(searchParams);
    if (mode === "signup") params.set("mode", "signup");
    else params.delete("mode");
    const qs = params.toString();
    return `/authenticate${qs ? `?${qs}` : ""}`;
  };

  return (
    <LoginFormCore
      actions={actions}
      defaultMode={defaultMode}
      modeSwitch={({ to, className, children, onSelect }) => (
        <Link
          href={href(to)}
          className={className}
          onClick={(event) => {
            // A modified or non-primary click is a request for a NEW context
            // (tab, window, download) — leave those to the browser and the
            // real route.
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            window.history.pushState(null, "", href(to));
            onSelect();
          }}
        >
          {children}
        </Link>
      )}
      legalLink={({ href: legalHref, className, children }) => (
        <Link href={legalHref} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
