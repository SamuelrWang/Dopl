import { AuthSplitLayout } from "@/shared/layout/auth-split";
import { getAppOrigin } from "@/shared/lib/app-origin";
import { LoginFormCore } from "@/features/auth/components/login-form-core";
import type { LoginActions } from "@/features/auth/hooks/use-login-core";
import { getBridge } from "#/lib/dopl-bridge";
// Bundled as a data URI (`?inline`): the packaged renderer is a `file://`
// document under `img-src 'self' data: blob:`, so the web form's absolute
// `/favicons/...` src resolves to the filesystem root and never loads.
import doplMark from "#/assets/dopl-mark.png?inline";

/**
 * The SPA's signed-out view — journey-audit GAP-1, which had no owner: the
 * route table has no `/login`, the shell renders `PageLoading`/`PageError` on an
 * unauthenticated boot, and only the tray menu could start a sign-in.
 *
 * This IS the web app's `/login`: the same `AuthSplitLayout` around the same
 * `LoginFormCore` (`src/features/auth/components/login-form-core.tsx`), down to
 * the brand mark, the strength meter and the crystal panel. Only the actions
 * differ — the renderer has no supabase client and never holds a token, so
 * every credential op runs in MAIN over the bridge:
 *
 *   password sign-in / sign-up → `passwordSignIn({ mode, email, password })`
 *   magic link                 → `sendMagicLink({ email })`
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
    <AuthSplitLayout>
      <LoginFormCore
        actions={bridgeActions()}
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
            onClick={() => void openPublicPage(href)}
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
  const sendMagicLink = bridge?.sendMagicLink;
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
    sendMagicLink: sendMagicLink
      ? (email) => sendMagicLink({ email }).then(toResult)
      : undefined,
    oauth: beginSignIn ? (provider) => beginSignIn(provider).then(toResult) : undefined,
    // Password recovery is an email round-trip that ends on the public site's
    // /auth/reset-password page; there is no bridge op for it, so the form's
    // (already conditional) "Forgot password?" link stays hidden.
  };
}

function toResult(answer: { ok: boolean; error?: string }): { error?: string } {
  return answer.ok ? {} : { error: answer.error ?? "Something went wrong" };
}

function openPublicPage(path: string): Promise<unknown> {
  const url = `${getAppOrigin()}${path}`;
  const bridge = getBridge();
  if (bridge) return bridge.openExternal(url);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}
