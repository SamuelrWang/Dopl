"use client";

import { ResetPasswordForm } from "./reset-password-form";

/** Centered single-column reset surface. Shares the login bg + scoped typeface;
 *  no right panel — this is a focused recovery step. */
export function ResetPasswordScreen() {
  return (
    <main
      className="flex min-h-screen w-full items-center justify-center bg-white px-6 py-10"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <div className="w-full max-w-[336px]">
        <h1
          className="mb-2 text-[22px] font-medium text-[#181818]"
          style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
        >
          Dopl
        </h1>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
