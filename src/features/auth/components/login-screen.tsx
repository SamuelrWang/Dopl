"use client";

import { AuthSplitLayout } from "@/shared/layout/auth-split";
import { GoogleOneTap } from "./google-one-tap";
import { LoginForm } from "./login-form";

/** Two-pane sign-in: left form column, right crystal/glass panel (shared with
 *  onboarding). The panel collapses on mobile. */
export function LoginScreen() {
  return (
    <AuthSplitLayout>
      <GoogleOneTap />
      <LoginForm />
    </AuthSplitLayout>
  );
}
