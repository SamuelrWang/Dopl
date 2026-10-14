import { AuthSplitLayout, BrandLockup } from "@/shared/layout/auth-split";
import {
  LOGIN_CARD_KEY,
  loginGlassCard,
  type LoginJourneyImages,
} from "@/features/onboarding/components/login-journey-showcase";
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
// The login card's images (Samuel 2026-10-13). `?inline`, same `file://`
// reason as the mark; all small (photos ~14KB, SVG marks).
import avatar from "#/assets/onboarding-avatar.jpg?inline";
import avatar2 from "#/assets/onboarding-avatar-2.jpg?inline";
import avatar3 from "#/assets/onboarding-avatar-3.jpg?inline";
import claudeLogo from "#/assets/claude-logo.svg?inline";
import grokLogo from "#/assets/grok-logo.svg?inline";
import chatgptLogo from "#/assets/chatgpt-logo.svg?inline";
import hubspotLogo from "#/assets/hubspot-logo.svg?inline";
import slackLogo from "#/assets/slack-logo.svg?inline";
import sheetsLogo from "#/assets/sheets-logo.svg?inline";
import avatar4 from "#/assets/onboarding-avatar-4.jpg?inline";
// Samuel's own laptop image (trimmed, 128px transparent PNG, ~1.6KB).
import laptopIcon from "#/assets/laptop-icon.png?inline";
// Stripe "S": Font Awesome Free brands icon, CC BY 4.0
// (https://fontawesome.com/license/free) — attribution kept here.
import stripeLogo from "#/assets/stripe-logo.svg?inline";
// Figma's official mark (public domain).
import figmaLogo from "#/assets/figma-logo.svg?inline";
import museLogo from "#/assets/muse-logo.svg?inline";

/** Exported for the onboarding preview's Login page, so both wear one card. */
export const LOGIN_IMAGES: LoginJourneyImages = {
  you: avatar,
  teammate: avatar2,
  teammate2: avatar3,
  dopl: doplMark,
  claude: claudeLogo,
  grok: grokLogo,
  chatgpt: chatgptLogo,
  hubspot: hubspotLogo,
  slack: slackLogo,
  sheets: sheetsLogo,
  grokPerson: avatar4,
  laptop: laptopIcon,
  stripe: stripeLogo,
  figma: figmaLogo,
  muse: museLogo,
};
/** Module-level so the layout's card map never churns. */
const LOGIN_CARD = loginGlassCard(LOGIN_IMAGES);

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
    <AuthSplitLayout
      bannerSrc={frameworkBanner}
      // ⚠ THE LOGIN CARD (Samuel 2026-10-13): naming a pose is what turns
      // the white card on (`AuthSplitLayout` › glassPose). Desktop-only — the
      // web /login, /signup and /oauth/authorize pass no pose and stay plain.
      // Its own key: step 4 shares `"default"`.
      glassPose="default"
      glassCardKey={LOGIN_CARD_KEY}
      glassCardContent={LOGIN_CARD}
      // The same corner lockup every onboarding step pins, mark styled to
      // match (`pages/onboarding` › BRAND_MARK), so it holds still across
      // sign-in → onboarding.
      cornerBrand={
        <BrandLockup
          mark={
            // next/image forbidden — no Next runtime in this SPA.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={doplMark}
              alt=""
              draggable={false}
              className="auth-logo-3d h-8 w-8 rounded-[8px]"
            />
          }
        />
      }
    >
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
        // No `brand`: the lockup is the layout's `cornerBrand` above.
        legalLink={({ href, className, children }) => (
          // `file:///services-agreement` would 404; the public site owns these pages.
          <button
            type="button"
            className={className}
            // The public site owns /services-agreement and /privacy — one shared helper
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
    // No magic link: `LoginActions` has no such member.
    oauth: beginSignIn ? (provider) => beginSignIn(provider).then(toResult) : undefined,
    // No password recovery: it ends on the public site's /auth/reset-password
    // and has no bridge op, so the form's conditional link stays hidden.
  };
}

function toResult(answer: { ok: boolean; error?: string }): { error?: string } {
  return answer.ok ? {} : { error: answer.error ?? "Something went wrong" };
}
