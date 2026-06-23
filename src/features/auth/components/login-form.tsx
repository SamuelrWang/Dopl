"use client";

import { useState } from "react";
import Link from "next/link";
import { useLogin } from "../hooks/use-login";
import { PasswordRequirements } from "./password-requirements";

/** Left column of the login screen: Dopl brand + email/password form with a
 *  magic-link fallback and Google/GitHub social sign-in. Light theme. */
export function LoginForm() {
  const {
    email,
    setEmail,
    password,
    setPassword,
    remember,
    setRemember,
    error,
    message,
    pending,
    signInFailed,
    signInWithPassword,
    signUpWithPassword,
    sendMagicLink,
    resetPassword,
    signInWithProvider,
  } = useLogin();

  const [showPassword, setShowPassword] = useState(false);
  const busy = pending !== null;

  return (
    <div className="w-full max-w-[336px]" style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
      {/* Brand: logo mark above wordmark */}
      <div className="flex flex-col items-start gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicons/android-chrome-512x512.png" alt="Dopl" className="h-8 w-8 rounded-[6px]" />
        <span
          className="text-[21px] font-medium text-[#181818]"
          style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
        >
          Dopl
        </span>
      </div>

      <h2 className="mt-7 text-[30px] font-bold leading-none tracking-[-0.8px] text-[#181818]">
        Sign in
      </h2>

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

      <form onSubmit={signInWithPassword}>
        {/* Email */}
        <div className="mt-7">
          <label htmlFor="login-email" className="mb-2 block text-[14px] font-medium text-[#181818]">
            Email Address
          </label>
          <div className="auth-field-3d flex h-[46px] items-center gap-2.5 rounded-[10px] px-[16px]">
            <MailIcon />
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent text-[14px] text-[#181818] focus:outline-none"
            />
          </div>
        </div>

        {/* Password */}
        <div className="mt-5">
          <label htmlFor="login-password" className="mb-2 block text-[14px] font-medium text-[#181818]">
            Password
          </label>
          <div className="auth-field-3d flex h-[46px] items-center gap-2.5 rounded-[10px] px-[16px]">
            <LockIcon />
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent text-[14px] text-[#181818] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="cursor-pointer text-[#9a9a9a] transition-colors hover:text-[#181818]"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
          {/* Meter only — the field doubles for sign-in, so no nagging checklist. */}
          <PasswordRequirements password={password} showChecklist={false} />
          {/* Forgot link appears only after a failed sign-in, to reduce clutter. */}
          {signInFailed && (
            <button
              type="button"
              onClick={resetPassword}
              disabled={busy}
              className="mt-2 cursor-pointer text-[13px] text-[#181818] hover:underline disabled:opacity-60"
            >
              {pending === "reset" ? "Sending reset link…" : "Forgot password?"}
            </button>
          )}
        </div>

        {/* Remember */}
        <label className="mt-5 flex cursor-pointer items-center gap-2.5 select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-[18px] w-[18px] rounded-[4px] border-2 border-[#181818] accent-[#181818]"
          />
          <span className="text-[14px] text-[#181818]">Remember me</span>
        </label>

        {/* Sign in */}
        <button
          type="submit"
          disabled={busy}
          className="auth-btn-3d mt-7 flex h-[46px] w-full cursor-pointer items-center justify-center rounded-[10px] text-[15px] font-semibold text-white"
        >
          {pending === "password" ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* Links */}
      <div className="mt-5 leading-[1.55]">
        <p className="text-[14px] text-[#9a9a9a]">
          Don&apos;t have an account?{" "}
          <button
            type="button"
            onClick={signUpWithPassword}
            disabled={busy}
            className="cursor-pointer font-medium text-[#181818] hover:underline disabled:opacity-60"
          >
            {pending === "signup" ? "Creating…" : "Sign up"}
          </button>
        </p>
      </div>

      {/* Magic-link fallback */}
      <button
        type="button"
        onClick={sendMagicLink}
        disabled={busy}
        className="mt-2 block cursor-pointer text-[13px] text-[#9a9a9a] hover:text-[#181818] hover:underline disabled:opacity-60"
      >
        {pending === "magic" ? "Sending link…" : "Email me a sign-in link instead"}
      </button>

      {/* Socials */}
      <div className="mt-7 flex gap-5">
        <SocialButton label="Continue with Google" onClick={() => signInWithProvider("google")} disabled={busy}>
          <GoogleIcon />
        </SocialButton>
        <SocialButton label="Continue with GitHub" onClick={() => signInWithProvider("github")} disabled={busy}>
          <GitHubIcon />
        </SocialButton>
      </div>

      <p className="mt-7 text-[12px] leading-relaxed text-[#9a9a9a]">
        By continuing, you agree to our{" "}
        <Link href="/terms" className="text-[#181818] underline">Terms of Service</Link> and{" "}
        <Link href="/privacy" className="text-[#181818] underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}

function SocialButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="auth-btn-3d-light flex h-12 w-12 cursor-pointer items-center justify-center rounded-full"
    >
      {children}
    </button>
  );
}

function MailIcon() {
  return (
    <svg className="h-[18px] w-[18px] flex-none text-[#181818]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
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

function GoogleIcon() {
  return (
    <svg className="h-[22px] w-[22px]" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C36.2 6.6 30.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C36.2 6.6 30.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c6.4 0 12-2.5 16-6.5l-7.4-6.2C30.7 33 27.5 34 24 34c-5.2 0-9.6-3.3-11.3-7.9l-6.6 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.5l7.4 6.2C42.7 36.4 44 30.7 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="#181818">
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  );
}
