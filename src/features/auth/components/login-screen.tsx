"use client";

import { GoogleOneTap } from "./google-one-tap";
import { LoginForm } from "./login-form";
import { LoginRightPanel } from "./login-right-panel";

/** Two-pane sign-in: left form column, right crystal/glass panel. The right
 *  panel collapses on mobile, leaving a centered form. Arcana's typeface is
 *  scoped here so it doesn't leak into the rest of the app. */
export function LoginScreen() {
  return (
    <main
      className="min-h-screen w-full bg-[#F3F3F3]"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <GoogleOneTap />
      <div className="mx-auto flex min-h-screen max-w-[1280px] items-center gap-12 px-6 py-10">
        <div className="flex flex-1 items-center justify-center">
          <LoginForm />
        </div>
        <div className="hidden h-[88vh] max-h-[920px] min-h-[600px] flex-1 md:block">
          <LoginRightPanel />
        </div>
      </div>
    </main>
  );
}
