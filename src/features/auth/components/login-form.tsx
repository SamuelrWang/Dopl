"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLoginActions } from "../hooks/use-login";
import { LoginFormCore } from "./login-form-core";
import type { LoginMode } from "../hooks/use-login-core";

/** Next binding for `./login-form-core` (markup + state machine live there):
 *  supabase actions, `next/link` legal links, mode switch as ROUTE change.
 *
 *  No `brand` — web lockup lives page upper-left (`./login-screen` →
 *  `AuthSplitLayout` `brand`). Desktop binding does pass one. */
export function LoginForm({ defaultMode }: { defaultMode: LoginMode }) {
  const actions = useLoginActions();
  const searchParams = useSearchParams();

  // ⚠ Switch must carry the query. `useLoginActions` reads `?redirectTo=` (and
  // `installCluster`) off the URL; navigating to a BARE `/signup` silently
  // drops the deep link for visitors who arrived from one.
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
