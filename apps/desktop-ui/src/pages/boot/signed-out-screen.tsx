import { AuthSplitLayout } from "@/shared/layout/auth-split";
import { LoginFormCore } from "@/features/auth/components/login-form-core";
import type { LoginActions } from "@/features/auth/hooks/use-login-core";
import { getBridge } from "#/lib/dopl-bridge";
import { openInBrowser } from "#/lib/open-in-browser";
// ⚠ Data URI (`?inline`): packaged renderer is a `file://` doc under
// `img-src 'self' data: blob:`, so the web form's absolute `/favicons/...` src
// resolves to filesystem root and never loads.
import doplMark from "#/assets/dopl-mark.png?inline";
// Same reason — shared layout defaults to `/img/framework-banner.jpg`, a
// `public/` path only web serves. Local COPY, emitted as a bundled file (NOT
// `?inline`: ~1MB); `base: "./"` in vite.config.ts makes the URL relative so
// `file://` resolves it.
import frameworkBanner from "#/assets/framework-banner.jpg";

/**
 * SPA signed-out view. Route table has no `/login`; this is it — same
 * `AuthSplitLayout` + `LoginFormCore` as the web app's.
 *
 * ⚠ Renderer has NO supabase client and never holds a token, so every
 * credential op runs in MAIN over the bridge:
 *
 *   password sign-in / sign-up → `passwordSignIn({ mode, email, password })`
 *   Google / GitHub            → `beginSignIn(provider)` — arms login-CSRF
 *                                nonce, opens system browser. OAuth cannot run
 *                                in this window: Supabase PKCE needs the
 *                                code-verifier in the exchanging context.
 *
 * None navigate on success — main stores the session and pushes an auth-state
 * transition `useAuthPhase` subscribes to, so this screen swaps out, no reload.
 *
 * Op missing from bridge = older main process; that control is disabled with a
 * reason (`LoginActions`) rather than faking it — a renderer-built OAuth URL
 * skips the nonce and its returning `dopl://` fragment is correctly refused.
 */
export function SignedOutScreen() {
  return (
    <AuthSplitLayout bannerSrc={frameworkBanner}>
      <LoginFormCore
        actions={bridgeActions()}
        // Anyone reaching this screen already installed the app, so the
        // acquisition flow is behind them — open on sign-in. (The web has a
        // route per mode; `/signup` is the one that opens on the other.)
        //
        // NO `modeSwitch`: that prop turns the switch into a navigation
        // between `/signup` and `/login`, and this renderer has neither. The
        // core's fallback toggles the mode IN PLACE, which is what a
        // single-screen host needs.
        defaultMode="signin"
        // Mark stays IN the form: no page chrome here for the web's upper-left
        // placement, so web hosts pass no `brand` and this one does.
        brand={
          // next/image forbidden — no Next runtime in this SPA.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doplMark} alt="Dopl" className="auth-logo-3d h-8 w-8 rounded-[6px]" />
        }
        legalLink={({ href, className, children }) => (
          // `file:///terms` would 404; the public site owns these pages.
          <button
            type="button"
            className={className}
            // The public site owns /terms and /privacy — one shared helper
            // decides how a link leaves this app (bridge, else window.open).
            onClick={() => openInBrowser(href)}
          >
            {children}
          </button>
        )}
      />
    </AuthSplitLayout>
  );
}

/** Feature-detected per render: absent op → undefined member → form disables
 *  that control. */
function bridgeActions(): LoginActions {
  const bridge = getBridge();
  const passwordSignIn = bridge?.passwordSignIn;
  const beginSignIn = bridge?.beginSignIn;

  return {
    signInWithPassword: passwordSignIn
      ? (email, password) =>
          passwordSignIn({ mode: "sign-in", email, password }).then(toResult)
      : undefined,
    signUpWithPassword: passwordSignIn
      ? (email, password) =>
          passwordSignIn({ mode: "sign-up", email, password }).then(toResult)
      : undefined,
    // No magic link: `LoginActions` has no such member. Bridge op and main's
    // `sendMagicLink` handler still exist but nothing in the UI calls them.
    oauth: beginSignIn ? (provider) => beginSignIn(provider).then(toResult) : undefined,
    // No password recovery: it ends on the public site's /auth/reset-password
    // and has no bridge op, so the form's conditional link stays hidden.
  };
}

function toResult(answer: { ok: boolean; error?: string }): { error?: string } {
  return answer.ok ? {} : { error: answer.error ?? "Something went wrong" };
}
