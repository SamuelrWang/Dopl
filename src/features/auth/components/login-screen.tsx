"use client";

import Link from "next/link";
import { AuthSplitLayout } from "@/shared/layout/auth-split";
import { GoogleOneTap } from "./google-one-tap";
import { LoginForm } from "./login-form";
import type { LoginMode } from "../hooks/use-login-core";

/** Two-pane sign-in: left form column, right banner/glass panel (shared with
 *  onboarding). Panel collapses on mobile.
 *
 *  `defaultMode` threaded from page, never defaulted here — on web it's a
 *  property of the ROUTE (`/signup`→signup, `/login`→signin) and the switch
 *  NAVIGATES (`./login-form`). Desktop SPA has its own binding
 *  (`apps/desktop-ui/src/pages/boot/signed-out-screen.tsx`), no routes. */
export function LoginScreen({ defaultMode }: { defaultMode: LoginMode }) {
  return (
    <AuthSplitLayout brand={<WebBrand />}>
      <GoogleOneTap />
      <LoginForm defaultMode={defaultMode} />
    </AuthSplitLayout>
  );
}

/** Brand lockup, auth page upper-left. ⚠ Must stay in sync with
 *  `.lp-brand`/`.lp-brand-mark`/`.lp-brand-word` in
 *  `features/marketing/marketing.css`: 26px mark, 6px radius, 11px gap,
 *  Playfair italic wordmark. */
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
