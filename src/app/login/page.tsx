import { Suspense } from "react";
import { LoginScreen } from "@/features/auth";

/**
 * SIGN IN. The other half is `/signup`, and the split is the point: the mode
 * is the ROUTE, so the URL always names the flow on screen, the switch under
 * the submit button is a navigation, and a link can point at either one.
 *
 * `/login` stays the DEFAULT destination for everything that bounces an
 * unauthenticated caller — the middleware, `/auth/callback`, the reset-password
 * page, the OAuth consent screen — because those all send someone who already
 * has an account. `/signup` is the acquisition surface, and the landing page's
 * "Get Started" is what points there (`features/marketing/constants.ts`).
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen defaultMode="signin" />
    </Suspense>
  );
}
