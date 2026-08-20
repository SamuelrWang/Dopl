"use client";

import { GoogleOneTap } from "./google-one-tap";
import { LoginForm } from "./login-form";
import type { LoginMode } from "../hooks/use-login-core";

/**
 * The auth entry FORM COLUMN — what `/login` and `/signup` render.
 *
 * ⚠ No `AuthSplitLayout` here. The split shell (banner, glass, brand lockup)
 * lives in `src/app/(auth)/layout.tsx` so it PERSISTS across navigation between
 * the two routes — wrapping it here again would remount the banner on every
 * switch and bring back the decode flash that layout exists to kill. Desktop's
 * signed-out screen composes its own shell
 * (`apps/desktop-ui/src/pages/boot/signed-out-screen.tsx`).
 *
 * `defaultMode` threaded from page, never defaulted here — on web it's a
 * property of the URL (`/authenticate?mode=signup`→signup, else signin; the
 * legacy `/signup` and `/login` slugs 307 in). The in-form switch swaps mode IN
 * PLACE and rewrites the query to match (`./login-form`), so the URL still
 * always names the flow on screen.
 */
export function LoginScreen({ defaultMode }: { defaultMode: LoginMode }) {
  return (
    <>
      <GoogleOneTap />
      <LoginForm defaultMode={defaultMode} />
    </>
  );
}
