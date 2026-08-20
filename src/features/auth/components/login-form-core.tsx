"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLoginCore, type LoginActions, type LoginMode } from "../hooks/use-login-core";
import { PasswordRequirements } from "./password-requirements";

/** ToS/Privacy link shape. Web wraps `next/link`; desktop SPA opens system
 *  browser — `file://` document cannot navigate to `/terms`. */
export type LegalLinkProps = { href: string; className?: string; children: ReactNode };
export type LegalLinkComponent = (props: LegalLinkProps) => ReactNode;

/** Mode-switch renderer input: destination mode + class/label of in-place
 *  fallback, so host's link is same control, not lookalike. `onSelect` is the
 *  core's ANIMATED switch (fade out → swap → fade in) — a host that wants the
 *  in-place transition calls it instead of navigating; a host that navigates
 *  may ignore it. */
export type ModeSwitchProps = {
  to: LoginMode;
  className: string;
  children: ReactNode;
  onSelect: () => void;
};
export type ModeSwitchComponent = (props: ModeSwitchProps) => ReactNode;

/** One leg of the switch crossfade — out, then in, so the whole beat is 2×. */
const SWITCH_FADE_MS = 180;

export interface LoginFormCoreProps {
  /** Absent member disables that control and prints one-line reason. */
  actions: LoginActions;
  /** Brand mark above wordmark, INSIDE form column. Web hosts omit — lockup
   *  lives page upper-left (`shared/layout/auth-split/auth-split-layout.tsx`,
   *  `brand` prop). ⚠ Packaged SPA must pass BUNDLED asset: absolute
   *  `/favicons/…` under `file://` resolves to filesystem root. */
  brand?: ReactNode;
  /** Footer Terms/Privacy renderer. Defaults to plain `<a>`. */
  legalLink?: LegalLinkComponent;
  /** Sign-up ⇄ sign-in switch renderer. Web passes LINK — each mode own route
   *  (`/signup`, `/login`), so URL can't lie about on-screen flow. Desktop SPA
   *  has no router, omits it, falls back to in-place toggle — hence optional. */
  modeSwitch?: ModeSwitchComponent;
  /** Opening mode. Per host, never sniffed: web from ROUTE, desktop always
   *  "signin" (only reachable post-install). */
  defaultMode: LoginMode;
}

const DefaultLegalLink: LegalLinkComponent = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/**
 * Login screen left column: email/password + Google/GitHub. Light theme.
 *
 * ⚠ Whole visual surface; must stay free of `next/*` and supabase so web
 * `/signup` + `/login` and desktop signed-out screen render SAME pixels.
 * Bindings: `./login-form`, `apps/desktop-ui/src/pages/boot/signed-out-screen.tsx`.
 */
export function LoginFormCore({
  actions,
  brand,
  legalLink,
  modeSwitch,
  defaultMode,
}: LoginFormCoreProps) {
  const {
    mode,
    setMode,
    email,
    setEmail,
    password,
    setPassword,
    error,
    message,
    pending,
    signInFailed,
    signInWithPassword,
    signUpWithPassword,
    resetPassword,
    signInWithProvider,
  } = useLoginCore(actions, defaultMode);

  const [showPassword, setShowPassword] = useState(false);
  const busy = pending !== null;

  /**
   * The animated mode switch: fade the column to transparent, swap the mode
   * while nothing is visible, let the transition carry it back up. `exitingTo`
   * doubles as the re-entry guard — a second click mid-fade is ignored rather
   * than queued — and the effect owns the swap timer, so unmount mid-fade
   * cleans it up for free. The wrapper div below owns the opacity; content is
   * never unmounted, so typed email/password survive the switch (sign-up ⇄
   * sign-in share fields).
   */
  const [exitingTo, setExitingTo] = useState<LoginMode | null>(null);
  const requestModeSwitch = (to: LoginMode) => {
    if (busy || exitingTo !== null || to === mode) return;
    setExitingTo(to);
  };
  useEffect(() => {
    if (exitingTo === null) return;
    const id = window.setTimeout(() => {
      setMode(exitingTo);
      setExitingTo(null);
    }, SWITCH_FADE_MS);
    return () => window.clearTimeout(id);
    // ⚠ `setMode` deliberately not a dep: `useLoginCore` rebuilds it every
    // render, so keying on it would restart this timer on any re-render and a
    // fade could stretch or never land. `exitingTo` is the one real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitingTo]);

  const isSignUp = mode === "signup";
  // Heading + submit label share one string — screen can't claim one flow
  // while running the other.
  const title = isSignUp ? "Sign Up" : "Log In";
  const submitLabel = isSignUp
    ? pending === "signup"
      ? "Creating…"
      : title
    : pending === "password"
      ? "Signing in…"
      : title;

  const canPassword = Boolean(actions.signInWithPassword && actions.signUpWithPassword);
  const canOauth = Boolean(actions.oauth);
  const canReset = Boolean(actions.resetPassword);

  const LegalLink = legalLink ?? DefaultLegalLink;

  // Switch label = DESTINATION mode title, never current heading.
  const switchTo: LoginMode = isSignUp ? "signin" : "signup";
  const switchLabel = isSignUp ? "Log In" : "Sign Up";
  const switchClass =
    "cursor-pointer text-[14px] font-medium text-[#181818] hover:underline disabled:opacity-60";

  return (
    <div className="w-full max-w-[336px]" style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
      {/* ⚠ The switch crossfade needs its OWN element. The root's `loginFadeIn`
          runs with fill `both`, and a filled animation outranks a transition on
          the same property — opacity set on the root would simply lose. */}
      <div
        style={{
          opacity: exitingTo !== null ? 0 : 1,
          transition: `opacity ${SWITCH_FADE_MS}ms ease`,
        }}
      >
      {brand && (
        <div className="mb-7 flex flex-col items-start gap-1.5">
          {brand}
          <span
            className="text-[21px] font-medium text-[#181818]"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
          >
            Dopl
          </span>
        </div>
      )}

      {/* Must match `features/marketing/marketing.css` › .lp-mp-heading. Face
          inherited: `AuthSplitLayout` scopes landing grotesk. */}
      <h2
        className="text-[#181818]"
        style={{
          fontWeight: 400,
          fontSize: "clamp(23px, 2.5vw, 37px)",
          lineHeight: 1.04,
          letterSpacing: "-0.03em",
        }}
      >
        {title}
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

      <form onSubmit={isSignUp ? signUpWithPassword : signInWithPassword}>
        {/* ⚠ No visible label, no leading icon — placeholder is the label, so
            `aria-label` is the ONLY accessible name (placeholder is not one;
            vanishes on first keystroke). Tests find fields by label. */}
        <div className="mt-7">
          {/* `rounded-full` at call site (not kit `rounded-[10px]`):
              `.auth-field-3d`/`.concave-field` carry no radius; every other
              concave surface keeps its rectangle. */}
          <div className="auth-field-3d flex h-[46px] items-center gap-2.5 rounded-full px-[16px]">
            <input
              id="login-email"
              type="email"
              required
              aria-label="Email Address"
              placeholder="Email Address"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent text-[14px] text-[#181818] placeholder:text-[#9a9a9a] focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="auth-field-3d flex h-[46px] items-center gap-2.5 rounded-full px-[16px]">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              aria-label="Password"
              placeholder="Password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-transparent text-[14px] text-[#181818] placeholder:text-[#9a9a9a] focus:outline-none"
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
          {/* Meter only — field doubles for sign-in, so no checklist. */}
          <PasswordRequirements password={password} showChecklist={false} />
          {signInFailed && canReset && (
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

        {/* No "Remember me": session always persisted (`../hooks/use-login-core`). */}

        <button
          type="submit"
          disabled={busy || !canPassword}
          className="auth-btn-3d mt-7 flex h-[46px] w-full cursor-pointer items-center justify-center rounded-full text-[15px] font-semibold text-white"
        >
          {submitLabel}
        </button>
        {!canPassword && (
          <UnavailableNote>Update the Dopl app to sign in with a password here.</UnavailableNote>
        )}
      </form>

      {/* 12px drop + right-aligned: reads as submit's alternative, not first
          item of socials block (28px break). */}
      <div className="mt-3 flex justify-end leading-[1.55]">
        {modeSwitch ? (
          modeSwitch({
            to: switchTo,
            className: switchClass,
            children: switchLabel,
            onSelect: () => requestModeSwitch(switchTo),
          })
        ) : (
          <button
            type="button"
            onClick={() => requestModeSwitch(switchTo)}
            disabled={busy}
            className={switchClass}
          >
            {switchLabel}
          </button>
        )}
      </div>

      <div className="mt-7 flex gap-5">
        <SocialButton
          label="Continue with Google"
          onClick={() => signInWithProvider("google")}
          disabled={busy || !canOauth}
        >
          <GoogleIcon />
        </SocialButton>
        <SocialButton
          label="Continue with GitHub"
          onClick={() => signInWithProvider("github")}
          disabled={busy || !canOauth}
        >
          <GitHubIcon />
        </SocialButton>
      </div>
      {!canOauth && (
        <UnavailableNote>Update the Dopl app to continue with Google or GitHub.</UnavailableNote>
      )}

      <p className="mt-7 text-[12px] leading-relaxed text-[#9a9a9a]">
        By continuing, you agree to our{" "}
        <LegalLink href="/terms" className="text-[#181818] underline">Terms of Service</LegalLink> and{" "}
        <LegalLink href="/privacy" className="text-[#181818] underline">Privacy Policy</LegalLink>.
      </p>
      </div>
    </div>
  );
}

/** Why control disabled — beats dead button. */
function UnavailableNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[12px] leading-relaxed text-[#9a9a9a]">{children}</p>;
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
