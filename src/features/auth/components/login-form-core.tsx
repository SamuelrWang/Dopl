"use client";

import { useState, type ReactNode } from "react";
import { useLoginCore, type LoginActions, type LoginMode } from "../hooks/use-login-core";
import { PasswordRequirements } from "./password-requirements";

/** Shape the ToS/Privacy links are rendered with. The web app wraps `next/link`;
 *  the desktop SPA opens the URL in the system browser (a `file://` document
 *  cannot navigate to `/terms`). */
export type LegalLinkProps = { href: string; className?: string; children: ReactNode };
export type LegalLinkComponent = (props: LegalLinkProps) => ReactNode;

/** What the mode-switch renderer is handed: the mode it must lead TO, plus the
 *  class and label the in-place fallback would have used, so a host's link is
 *  the same control rather than a lookalike. */
export type ModeSwitchProps = { to: LoginMode; className: string; children: ReactNode };
export type ModeSwitchComponent = (props: ModeSwitchProps) => ReactNode;

export interface LoginFormCoreProps {
  /** Everything the form cannot do by itself. An absent member disables that
   *  control and prints a one-line reason (see `LoginActions`). */
  actions: LoginActions;
  /** Brand mark above the wordmark, rendered INSIDE the form column. Omit it
   *  and the whole lockup goes — which is what the web hosts do, because there
   *  the brand sits in the page's upper-left corner instead
   *  (`shared/layout/auth-split/auth-split-layout.tsx`, `brand` prop). The
   *  packaged SPA still passes one: its window has no page chrome to put a
   *  corner mark in, and it must pass a BUNDLED asset because an absolute
   *  `/favicons/…` path under `file://` resolves to the filesystem root. */
  brand?: ReactNode;
  /** Renderer for the footer's Terms/Privacy links. Defaults to a plain `<a>`. */
  legalLink?: LegalLinkComponent;
  /** Renderer for the sign-up ⇄ sign-in switch. THE WEB PASSES A LINK: each
   *  mode is its own route (`/signup`, `/login`), so switching is a navigation
   *  and the URL never lies about which flow is on screen. The desktop SPA
   *  omits it — that renderer has no router and no routes — and the fallback
   *  below toggles `mode` in place, which is why this is optional rather than
   *  required. */
  modeSwitch?: ModeSwitchComponent;
  /** Which mode the screen OPENS on. Required, and set per host rather than
   *  sniffed at runtime: on the web it is a property of the ROUTE (`/signup`
   *  opens on "signup", `/login` on "signin"); the desktop app is only ever
   *  reached by someone who already installed it, so it opens on "signin". */
  defaultMode: LoginMode;
}

const DefaultLegalLink: LegalLinkComponent = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/**
 * Left column of the login screen: email/password form plus Google/GitHub
 * social sign-in. Light theme.
 *
 * This is the whole visual surface, free of `next/*` and of supabase, so the
 * web `/signup` + `/login` pages and the desktop app's signed-out screen render
 * the SAME pixels. `./login-form` is the web binding; the desktop SPA's binding
 * is `apps/desktop-ui/src/pages/boot/signed-out-screen.tsx`.
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
  const isSignUp = mode === "signup";
  // Heading and submit label are the SAME string, so the screen can never
  // claim one flow while running the other.
  const title = isSignUp ? "Sign Up" : "Log In";
  const submitLabel = isSignUp
    ? pending === "signup"
      ? "Creating…"
      : title
    : pending === "password"
      ? "Signing in…"
      : title;

  // Both password controls ride one host capability, so they share one note.
  const canPassword = Boolean(actions.signInWithPassword && actions.signUpWithPassword);
  const canOauth = Boolean(actions.oauth);
  const canReset = Boolean(actions.resetPassword);

  const LegalLink = legalLink ?? DefaultLegalLink;

  // The switch names its DESTINATION, with no preamble — so its label is the
  // OTHER mode's title, and never the current heading.
  const switchTo: LoginMode = isSignUp ? "signin" : "signup";
  const switchLabel = isSignUp ? "Log In" : "Sign Up";
  const switchClass =
    "cursor-pointer text-[14px] font-medium text-[#181818] hover:underline disabled:opacity-60";

  return (
    <div className="w-full max-w-[336px]" style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
      {/* Brand: logo mark above wordmark — IN-FORM, and only for a host that
          has nowhere else to put it (the desktop SPA). The web hosts pass no
          `brand` and the layout paints the same lockup in the page's
          upper-left corner instead, so this block disappears entirely rather
          than doubling it. */}
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

      {/* Landing-page display type (`features/marketing/marketing.css`
          › .lp-mp-heading): weight 400 at a fluid clamp with tight tracking.
          The face is inherited — `AuthSplitLayout` already scopes the same
          Helvetica grotesk the landing page uses. */}
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

      {/* One form, two flows — the active mode picks the submit handler, so
          Enter in a field does exactly what the button under it says. */}
      <form onSubmit={isSignUp ? signUpWithPassword : signInWithPassword}>
        {/* Email.

            THE FIELDS CARRY NO VISIBLE LABEL AND NO LEADING ICON — the
            placeholder is the label. `aria-label` therefore does the naming
            work the `<label htmlFor>` used to: a placeholder is not an
            accessible name (it vanishes on the first keystroke), so dropping
            one without the other would take the field's name away from every
            screen reader and from every test that finds it by label. */}
        <div className="mt-7">
          {/* `rounded-full` (not the kit's usual `rounded-[10px]`) is applied
              HERE, at the call site: `.auth-field-3d`/`.concave-field` carries
              no radius of its own, and every other surface using the concave
              recipe keeps its rectangle. */}
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

        {/* Password */}
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
          {/* Meter only — the field doubles for sign-in, so no nagging checklist. */}
          <PasswordRequirements password={password} showChecklist={false} />
          {/* Forgot link appears only after a failed sign-in, to reduce clutter. */}
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

        {/* There is no "Remember me": the session is always persisted (see
            `../hooks/use-login-core`), so a checkbox here would be decoration. */}

        {/* Submit — pill, per the call-site note on the fields above. */}
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

      {/* Mode switch — the label is the DESTINATION, with no preamble. A host
          that gave us `modeSwitch` renders it as a LINK to that mode's route;
          otherwise it toggles in place.

          It hangs off the RIGHT edge of the submit button (which is `w-full`,
          so the column's right edge is the button's) at a short 12px drop, so
          it reads as that button's alternative rather than as the first item
          of the block below it — the socials keep their own 28px break. */}
      <div className="mt-3 flex justify-end leading-[1.55]">
        {modeSwitch ? (
          modeSwitch({ to: switchTo, className: switchClass, children: switchLabel })
        ) : (
          <button
            type="button"
            onClick={() => setMode(switchTo)}
            disabled={busy}
            className={switchClass}
          >
            {switchLabel}
          </button>
        )}
      </div>

      {/* THE MAGIC LINK IS GONE (2026-08-13) — the "Email me a sign-in link
          instead" button, its unavailable note, and the action behind it. Two
          credential paths remain, password and OAuth; a user with no password
          on file reaches one through "Forgot password?" above. */}

      {/* Socials */}
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
  );
}

/** Why a control is disabled — an explanation beats a dead button. */
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

/** The eye is the ONLY field affordance left. `MailIcon` and `LockIcon` went
 *  with the visible labels (2026-08-13): a placeholder already says what the
 *  field is, and a decorative glyph repeating it is noise inside a 46px well. */
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
