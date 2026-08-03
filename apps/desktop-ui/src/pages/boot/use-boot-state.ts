import { useCallback, useEffect, useState } from "react";
import { getBridge } from "#/lib/dopl-bridge";

/**
 * The two endpoints the boot decision reads, as constants so the boot page and
 * the onboarding page share one query key (and therefore one request).
 */
export const ONBOARDING_STATE_PATH = "/api/user/onboarding-state";
export const ENSURE_DEFAULT_PATH = "/api/workspaces/ensure-default";

/** Boot's three-way answer to "is anyone signed in?" */
export type AuthPhase = "pending" | "signed-in" | "signed-out";

/**
 * The renderer's view of the session, straight off the Electron bridge.
 *
 * `window.dopl.getAuthState()` answers `{ signedIn, userId }` and NEVER a token
 * (dopl-bridge.ts), which is exactly the question boot needs. It is asked here
 * rather than through `useAuthUserState` (@/shared/auth/use-auth-user-core)
 * because that hook collapses "still loading" and "signed out" into one `null`
 * and additionally fetches `/api/user/profile` — a request that is guaranteed
 * to 401 on the one path where the distinction matters.
 *
 * Browser dev mode has no bridge to ask, so the phase starts at "signed-in" and
 * the API's own 401 is what surfaces the signed-out screen. Inside Electron the
 * bridge is authoritative and `onAuthState` keeps it live: main pushes a
 * transition when a 401 survives a forced refresh, and the tray's sign-out
 * lands here instead of on a dead remote `/canvas` load (journey-audit J7-1).
 */
export function useAuthPhase(): { phase: AuthPhase; refresh: () => void } {
  const [phase, setPhase] = useState<AuthPhase>(() =>
    getBridge() ? "pending" : "signed-in"
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await readAuthPhase();
      if (next && !cancelled) setPhase(next);
    };
    void load();

    const bridge = getBridge();
    if (!bridge || typeof bridge.onAuthState !== "function") {
      return () => {
        cancelled = true;
      };
    }
    // Main pushes transitions (sign-out from the tray, a 401 that survived a
    // forced refresh), so the screen never strands on a dead session.
    const off = bridge.onAuthState((state) => {
      setPhase(state.signedIn ? "signed-in" : "signed-out");
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const refresh = useCallback(() => {
    void readAuthPhase().then((next) => {
      if (next) setPhase(next);
    });
  }, []);

  return { phase, refresh };
}

/** `null` = no bridge to ask (browser dev mode), so leave the phase alone. */
async function readAuthPhase(): Promise<AuthPhase | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  try {
    const state = await bridge.getAuthState();
    return state.signedIn ? "signed-in" : "signed-out";
  } catch {
    // A bridge that cannot answer is not a signed-in session.
    return "signed-out";
  }
}
