import { useCallback, useEffect, useState, useRef } from "react";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { Role, Workspace } from "@/features/workspaces/types";
import { apiRequest } from "#/lib/api";
import { getBridge } from "#/lib/dopl-bridge";

/**
 * `POST /api/boot` — THE launch read (launch-blocker P0-2c).
 *
 * It replaced four strictly serial hops, each of which existed only because
 * the answers lived on four endpoints: `/api/user/onboarding-state` →
 * `/api/workspaces/ensure-default` → `/api/workspaces/resolve` →
 * `/api/workspaces/me`, and then the shell's `my-access` on top. Nothing in
 * that chain was a real dependency — server-side it is one composition — but
 * the shell gated `<Outlet/>` on the third, so no page began fetching its own
 * data until all four had landed.
 *
 * Two modes, one endpoint:
 *   - no `segment` — the cold launch at `/`. Provisions if needed (the old
 *     `ensure-default` semantics, unchanged and idempotent) and answers the
 *     onboarding gate in the same breath.
 *   - `segment` — the shell's resolve, fail-closed and membership-scoped, plus
 *     the role, the caller id and the access matrix the pages used to fetch.
 *
 * The four endpoints it replaces are all still live: the web app, `@dopl/client`
 * and deep links keep using them, and `seedBootAnswer` (use-workspace-route.ts)
 * writes this one answer into their cache keys so a caller that still asks
 * gets it for free.
 */
export const BOOT_PATH = "/api/boot";

/**
 * Still the onboarding page's key — boot seeds it from the same answer rather
 * than fetching it, so a boot → `/onboarding` hop pays for it exactly once.
 */
export const ONBOARDING_STATE_PATH = "/api/user/onboarding-state";

/** The `my-access` half of the boot answer; the wire shape of
 *  `GET /api/workspaces/[segment]/my-access` verbatim. */
export interface BootMyAccess {
  defaultLevel: AccessLevel;
  overrides: Array<{
    resourceType: TeamResourceType;
    resourceId: string;
    level: AccessLevel;
  }>;
}

export interface BootPayload {
  isOnboarded: boolean;
  surveyCompleted: boolean;
  userId: string;
  /** Null only when the caller is not onboarded yet (nothing is provisioned). */
  workspace: Workspace | null;
  /** Canonical `{slug}-{publicId}`. */
  segment: string | null;
  /** Segment mode: the routed segment was stale — the shell rewrites the URL. */
  needsRedirect: boolean;
  role: Role | null;
  myAccess: BootMyAccess | null;
}

/**
 * One cache entry per boot target: the launch (`null`) and each routed
 * segment. Shaped as the `[path, workspaceId, query]` tuple every other read
 * in this renderer uses (`use-api-query-core`), so the shell's boot query —
 * which goes through that hook — and the launch query written by hand here
 * address the same cache with the same rules.
 */
export function bootQueryKey(segment: string | null) {
  return [BOOT_PATH, undefined, segment ? { segment } : undefined] as const;
}

/** POST because the no-segment mode may provision; idempotent, always 200. */
export function fetchBoot(
  segment: string | null,
  signal?: AbortSignal
): Promise<BootPayload> {
  return apiRequest<BootPayload>(BOOT_PATH, {
    method: "POST",
    body: segment ? { segment } : {},
    signal,
  });
}

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

  // Monotonic sequence: a pushed transition must never be overwritten by a
  // slower in-flight read that started before it (the push is NEWER truth).
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const mySeq = ++seqRef.current;
    const load = async () => {
      const next = await readAuthPhase();
      if (next && !cancelled && mySeq === seqRef.current) setPhase(next);
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
      seqRef.current += 1; // outrank every in-flight read
      setPhase(state.signedIn ? "signed-in" : "signed-out");
    });
    return () => {
      cancelled = true;
      off();
    };
    // Mount-only on purpose: this subscribes to main's auth pushes for the
    // life of the page. (The rule no longer flags the empty dep list here, so
    // there is no disable directive to carry — an unused one is a warning.)
  }, []);

  const refresh = useCallback(() => {
    const mySeq = ++seqRef.current;
    void readAuthPhase().then((next) => {
      if (next && mySeq === seqRef.current) setPhase(next);
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
