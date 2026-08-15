"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLoginActions } from "../hooks/use-login";
import { LoginFormCore } from "./login-form-core";
import type { LoginMode } from "../hooks/use-login-core";

/** Left column of the login screen: email/password form with Google/GitHub
 *  social sign-in. Light theme.
 *
 *  The markup and the state machine live in `./login-form-core` — this file is
 *  only the Next binding (supabase-backed actions, `next/link` legal links, and
 *  the mode switch as a ROUTE change), so the desktop SPA's signed-out screen
 *  renders the identical form over the Electron bridge.
 *
 *  No `brand`: on the web the lockup lives in the page's upper-left corner
 *  (`./login-screen` → `AuthSplitLayout`'s `brand`), not at the top of this
 *  column. The desktop binding still passes one. */
export function LoginForm({ defaultMode }: { defaultMode: LoginMode }) {
  const actions = useLoginActions();
  const searchParams = useSearchParams();

  // THE SWITCH CARRIES THE QUERY. `?redirectTo=` is the whole reason a deep
  // link (an invite, a join token, an OAuth consent) survives a sign-in, and
  // `useLoginActions` reads it off the URL — so a switch that navigated to a
  // BARE `/signup` would silently drop the return trip for exactly the visitor
  // who was sent here from somewhere. Same for `installCluster`.
  const query = searchParams.toString();
  const href = (mode: LoginMode) =>
    `${mode === "signup" ? "/signup" : "/login"}${query ? `?${query}` : ""}`;

  return (
    <LoginFormCore
      actions={actions}
      defaultMode={defaultMode}
      modeSwitch={({ to, className, children }) => (
        <Link href={href(to)} className={className}>
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
