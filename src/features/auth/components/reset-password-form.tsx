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
        <h2 className="text-[30px] font-bold leading-none tracking-[-0.8px] text-[#181818]">
          Link expired
        </h2>
        <p className="mt-5 text-[14px] text-[#666]">
          This password reset link is invalid or has expired.
        </p>
        <Link
          href="/login"
          className="auth-btn-3d mt-7 inline-flex h-[46px] w-full items-center justify-center rounded-[10px] text-[15px] font-semibold text-white"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
      <h2 className="text-[30px] font-bold leading-tight tracking-[-0.8px] text-[#181818]">
        Set a new password
      </h2>
      <p className="mt-3 text-[14px] text-[#666]">Choose a new password for your account.</p>

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
          className="auth-btn-3d mt-7 flex h-[46px] w-full cursor-pointer items-center justify-center rounded-[10px] text-[15px] font-semibold text-white"
        >
          {pending ? "Updating…" : "Update password"}
        </button>
      </form>

      <Link href="/login" className="mt-6 inline-block text-[14px] text-[#181818] hover:underline">
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
    <div className="mt-5 first:mt-7">
      <label htmlFor={id} className="mb-2 block text-[14px] font-medium text-[#181818]">
        {label}
      </label>
      <div className="auth-field-3d flex h-[46px] items-center gap-2.5 rounded-[10px] px-[16px]">
        <LockIcon />
        <input
          id={id}
          type={type}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          className="w-full bg-transparent text-[14px] text-[#181818] placeholder:text-[#9a9a9a] focus:outline-none"
        />
        {toggle && (
          <button
            type="button"
            onClick={toggle}
            className="cursor-pointer text-[#9a9a9a] transition-colors hover:text-[#181818]"
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
