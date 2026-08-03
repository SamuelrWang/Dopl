"use client";

import Link from "next/link";
import { useLoginActions } from "../hooks/use-login";
import { LoginFormCore } from "./login-form-core";

/** Left column of the login screen: Dopl brand + email/password form with a
 *  magic-link fallback and Google/GitHub social sign-in. Light theme.
 *
 *  The markup and the state machine live in `./login-form-core` — this file is
 *  only the Next binding (supabase-backed actions, `next/link` legal links, the
 *  web app's brand mark), so the desktop SPA's signed-out screen renders the
 *  identical form over the Electron bridge. */
export function LoginForm() {
  const actions = useLoginActions();

  return (
    <LoginFormCore
      actions={actions}
      brand={
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/favicons/android-chrome-512x512.png" alt="Dopl" className="auth-logo-3d h-8 w-8 rounded-[6px]" />
      }
      legalLink={({ href, className, children }) => (
        <Link href={href} className={className}>
          {children}
        </Link>
      )}
    />
  );
}
