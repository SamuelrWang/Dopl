"use client";

import { useState } from "react";
import Link from "next/link";
import { useResetPassword } from "../hooks/use-reset-password";
import { PasswordRequirements } from "./password-requirements";

/** Set-new-password form reached from a recovery email. Light Arcana styling,
 *  matching login-form.tsx. */
export function ResetPasswordForm() {
  const { password, setPassword, confirm, setConfirm, error, message, pending, status, submit } =
    useResetPassword();
  const [show, setShow] = useState(false);

  if (status === "checking") {
    return <p className="text-[15px] text-[#9a9a9a]">Verifying your reset link…</p>;
  }

  if (status === "invalid") {
    return (
      <div>
        <h2 className="text-[42px] font-bold leading-none tracking-[-1px] text-[#181818]">
          Link expired
        </h2>
        <p className="mt-6 text-[15px] text-[#666]">
          This password reset link is invalid or has expired.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex h-[50px] w-full items-center justify-center rounded-[10px] bg-[#181818] text-[16px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
      <h2 className="text-[42px] font-bold leading-none tracking-[-1px] text-[#181818]">
        Set a new password
      </h2>
      <p className="mt-4 text-[15px] text-[#666]">Choose a new password for your account.</p>

      {(error || message) && (
        <div
          className={`mt-6 rounded-[10px] border px-4 py-3 text-[14px] ${
            error
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-[#cfd8e3] bg-[#eef3fa] text-[#1f3a5f]"
          }`}
          role="status"
        >
          {error ?? message}
        </div>
      )}

      <form onSubmit={submit}>
        <Field
          id="new-password"
          label="New Password"
          type={show ? "text" : "password"}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          toggle={() => setShow((s) => !s)}
          showToggle={show}
        />
        <PasswordRequirements password={password} />
        <Field
          id="confirm-password"
          label="Confirm Password"
          type={show ? "text" : "password"}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />

        <button
          type="submit"
          disabled={pending}
          className="mt-[30px] flex h-[50px] w-full items-center justify-center rounded-[10px] bg-[#181818] text-[16px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Updating…" : "Update password"}
        </button>
      </form>

      <Link href="/login" className="mt-6 inline-block text-[15px] text-[#181818] hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  toggle,
  showToggle,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  toggle?: () => void;
  showToggle?: boolean;
}) {
  return (
    <div className="mt-[26px] first:mt-9">
      <label htmlFor={id} className="mb-3 block text-[16px] font-medium text-[#181818]">
        {label}
      </label>
      <div className="flex h-[50px] items-center gap-3 rounded-[10px] bg-white px-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-within:ring-2 focus-within:ring-[#181818]/10">
        <LockIcon />
        <input
          id={id}
          type={type}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          className="w-full bg-transparent text-[15px] text-[#181818] placeholder:text-[#9a9a9a] focus:outline-none"
        />
        {toggle && (
          <button
            type="button"
            onClick={toggle}
            className="text-[#9a9a9a] transition-colors hover:text-[#181818]"
            aria-label={showToggle ? "Hide password" : "Show password"}
          >
            <EyeIcon off={!!showToggle} />
          </button>
        )}
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg className="h-[18px] w-[18px] flex-none text-[#181818]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}
