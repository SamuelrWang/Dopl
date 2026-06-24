"use client";

import type { ReactNode } from "react";
import { AuthCrystalPanel } from "./auth-crystal-panel";

/**
 * Full-viewport light split used by the auth-adjacent surfaces (login,
 * onboarding): a left content column (form / questionnaire) beside the crystal
 * panel. Fixed cover so the app's dark frame never bleeds and the page can't
 * scroll; the left column scrolls internally if a viewport is too short. The
 * panel collapses on mobile. Login's typeface is scoped here.
 */
export function AuthSplitLayout({ children }: { children: ReactNode }) {
  return (
    <main
      className="fixed inset-0 z-50 overflow-hidden bg-white"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <div className="mx-auto flex h-full max-w-[1500px] items-stretch gap-10 p-6 md:p-10">
        <div className="flex-[4] overflow-y-auto">
          <div className="flex min-h-full items-center justify-center">{children}</div>
        </div>
        <div className="hidden flex-[5] md:block">
          <AuthCrystalPanel />
        </div>
      </div>
    </main>
  );
}
