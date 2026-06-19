"use client";

import { GoogleOneTap } from "./google-one-tap";
import { LoginForm } from "./login-form";
import { LoginRightPanel } from "./login-right-panel";

/** Two-pane sign-in: left form column, right crystal/glass panel. The right
 *  panel collapses on mobile, leaving a centered form. Arcana's typeface is
 *  scoped here so it doesn't leak into the rest of the app. */
export function LoginScreen() {
  return (
    // Fixed full-viewport cover so the app's dark frame (--body-bg) never shows
    // through and the page can't scroll — login fits the screen exactly.
    <main
      className="fixed inset-0 z-50 overflow-hidden bg-[#F3F3F3]"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <GoogleOneTap />
      <div className="mx-auto flex h-full max-w-[1500px] items-stretch gap-12 p-6 md:p-12">
        {/* Form column scrolls internally only when the viewport is too short to
            fit it — the page itself never scrolls and the panel stays put. */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center">
            <LoginForm />
          </div>
        </div>
        <div className="hidden flex-1 md:block">
          <LoginRightPanel />
        </div>
      </div>
    </main>
  );
}
