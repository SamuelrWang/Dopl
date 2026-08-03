import { getAppOrigin } from "@/shared/lib/app-origin";
import { getBridge } from "#/lib/dopl-bridge";

/**
 * The SPA's signed-out view — journey-audit GAP-1, which had no owner: the
 * route table has no `/login`, the shell renders `PageLoading`/`PageError` on an
 * unauthenticated boot, and only the tray menu could start a sign-in.
 *
 * Sign-in cannot happen in this window. OAuth runs in the system browser
 * (`/auth/desktop-start`, on the Phase-4 KEEP list) and comes back through the
 * `dopl://auth#tokens` deep link, so this screen's only job is to open that URL
 * externally — the same call the tray's `beginSignIn` makes. The origin comes
 * from `getAppOrigin()` (the bridge constant), never from `window.location`,
 * which under `file://` would build `file:///auth/desktop-start`.
 *
 * Once main captures the tokens it pushes an auth-state transition; `useAuthPhase`
 * is subscribed to it, so this screen swaps itself out with no reload.
 */
export function SignedOutScreen() {
  function signIn() {
    const url = `${getAppOrigin()}/auth/desktop-start`;
    const bridge = getBridge();
    if (bridge) {
      void bridge.openExternal(url);
      return;
    }
    // Browser dev mode: no bridge, so the "external" browser is this one.
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
      <h1 className="text-title font-semibold tracking-tight text-text-primary">Dopl</h1>
      <p className="max-w-[320px] text-center text-caption text-text-secondary">
        Continue with Google to sign in. Your browser opens to finish, then Dopl
        picks up where it left off.
      </p>
      <button
        type="button"
        onClick={signIn}
        className="btn-light rounded-md px-3 py-1.5 text-small font-medium text-text-primary"
      >
        Continue with Google
      </button>
    </div>
  );
}
