import { Suspense } from "react";
import { LoginScreen } from "@/features/auth";

/**
 * SIGN IN. The mode is the ROUTE (`/login` vs `/signup`), so the URL always names the flow on
 * screen and a link can point at either.
 * `/login` is the DEFAULT bounce destination for every unauthenticated caller (middleware,
 * `/auth/callback`, reset-password, the OAuth consent screen) — those all carry someone who
 * already has an account. `/signup` is the acquisition surface.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen defaultMode="signin" />
    </Suspense>
  );
}
