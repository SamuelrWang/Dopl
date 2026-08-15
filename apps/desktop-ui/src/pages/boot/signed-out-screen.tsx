import { AuthSplitLayout } from "@/shared/layout/auth-split";
import { LoginFormCore } from "@/features/auth/components/login-form-core";
import type { LoginActions } from "@/features/auth/hooks/use-login-core";
import { getBridge } from "#/lib/dopl-bridge";
import { openInBrowser } from "#/lib/open-in-browser";
// Bundled as a data URI (`?inline`): the packaged renderer is a `file://`
// document under `img-src 'self' data: blob:`, so the web form's absolute
// `/favicons/...` src resolves to the filesystem root and never loads.
import doplMark from "#/assets/dopl-mark.png?inline";
// The auth split's right-pane banner, for the same reason — the shared layout
// defaults to `/img/framework-banner.jpg`, which is a `public/` path only the
// web can serve. A COPY of that JPEG lives in this SPA's assets and is emitted
// as a bundled file (not `?inline`: it is ~1MB, and `base: "./"` in
// vite.config.ts means the emitted URL is relative, so `file://` resolves it —
// the knowledge hero is the precedent).
import frameworkBanner from "#/assets/framework-banner.jpg";

/**
 * The SPA's signed-out view — journey-audit GAP-1, which had no owner: the
 * route table has no `/login`, the shell renders `PageLoading`/`PageError` on an
 * unauthenticated boot, and only the tray menu could start a sign-in.
 *
 * This IS the web app's `/login`: the same `AuthSplitLayout` around the same
 * `LoginFormCore` (`src/features/auth/components/login-form-core.tsx`), down to
 * the brand mark, the strength meter and the banner panel. Only the actions,
 * the bundled asset paths and the starting mode differ — the renderer has no supabase client and never
 * holds a token, so every credential op runs in MAIN over the bridge:
 *
 *   password sign-in / sign-up → `passwordSignIn({ mode, email, password })`
 *   Google / GitHub            → `beginSignIn(provider)`, which arms the
 *                                login-CSRF nonce and opens the system browser
 *                                (Supabase PKCE needs the code-verifier in the
 *                                context that exchanges the code, so OAuth
 *                                cannot run in this window).
 *
 * None of them navigate on success: main stores the session and pushes an
 * auth-state transition, and `useAuthPhase` is subscribed to it, so this screen
 * swaps itself out with no reload.
 *
 * An op missing from the bridge means an older main process. That path's
 * control is disabled with a one-line reason (`LoginActions`) instead of
 * pretending to work — a renderer-built OAuth URL, for instance, skips the
 * nonce and its returning `dopl://` fragment is correctly refused.
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
        // The mark stays IN the form here — this window has no page chrome for
        // the web's upper-left corner placement to belong to, so the web hosts
        // pass no `brand` and this one does.
        brand={
          // next/image is forbidden here — there is no Next runtime in this SPA.
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

/** Feature-detected, per render: an absent op leaves its member undefined,
 *  which is how the form knows to disable that control. */
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
    // No magic link: `LoginActions` dropped the member with the form's
    // "Email me a sign-in link instead" control (2026-08-13). The bridge op
    // and main's `sendMagicLink` handler are untouched — nothing in the UI
    // calls them now.
    oauth: beginSignIn ? (provider) => beginSignIn(provider).then(toResult) : undefined,
    // Password recovery is an email round-trip that ends on the public site's
    // /auth/reset-password page; there is no bridge op for it, so the form's
    // (already conditional) "Forgot password?" link stays hidden.
  };
}

function toResult(answer: { ok: boolean; error?: string }): { error?: string } {
  return answer.ok ? {} : { error: answer.error ?? "Something went wrong" };
}
