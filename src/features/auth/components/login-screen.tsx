"use client";

import Link from "next/link";
import { AuthSplitLayout } from "@/shared/layout/auth-split";
import { GoogleOneTap } from "./google-one-tap";
import { LoginForm } from "./login-form";
import type { LoginMode } from "../hooks/use-login-core";

/** Two-pane sign-in: left form column, right banner/glass panel (shared with
 *  onboarding). The panel collapses on mobile.
 *
 *  `defaultMode` is threaded from the page rather than defaulted here, because
 *  on the web it is a property of the ROUTE: `/signup` renders "signup" and
 *  `/login` renders "signin", and the form's switch NAVIGATES between the two
 *  (see `./login-form`). The desktop SPA has its OWN binding of the same form
 *  (`apps/desktop-ui/src/pages/boot/signed-out-screen.tsx`), which has no
 *  routes and toggles in place. */
export function LoginScreen({ defaultMode }: { defaultMode: LoginMode }) {
  return (
    <AuthSplitLayout brand={<WebBrand />}>
      <GoogleOneTap />
      <LoginForm defaultMode={defaultMode} />
    </AuthSplitLayout>
  );
}

/** The landing page's brand lockup, in the auth page's upper-left corner —
 *  the same 26px mark, 6px radius and 11px gap as `.lp-brand`/`.lp-brand-mark`
 *  (`features/marketing/marketing.css`), with the wordmark keeping the auth
 *  screen's Playfair italic — which `.lp-brand-word` copied FROM here, so the
 *  two are already one lockup. It links home for the same reason the nav's
 *  does: a corner brand that does nothing is a dead affordance.
 *
 *  The mark is 26px, not the 32px it was: the placement only reads as "the
 *  same spot" if the thing placed there is also the same size. */
function WebBrand() {
  return (
    <Link href="/" className="inline-flex items-center gap-[11px]" aria-label="Dopl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicons/android-chrome-512x512.png"
        alt="Dopl"
        width={26}
        height={26}
        className="auth-logo-3d block h-[26px] w-[26px] rounded-[6px]"
      />
      <span
        className="text-[21px] font-medium text-[#181818]"
        style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
      >
        Dopl
      </span>
    </Link>
  );
}
