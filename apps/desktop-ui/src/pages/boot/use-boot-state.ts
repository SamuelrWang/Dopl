import { useCallback, useEffect, useState, useRef } from "react";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { Role, Workspace } from "@/features/workspaces/types";
import { apiRequest } from "#/lib/api";
import { getBridge } from "#/lib/dopl-bridge";

/**
 * `POST /api/boot` — THE launch read. Two modes, one endpoint:
 *   - no `segment` — cold launch at `/`. Provisions if needed (`ensure-default`
 *     semantics, idempotent) and answers the onboarding gate in one breath.
 *   - `segment` — shell resolve, fail-closed + membership-scoped, plus role,
 *     caller id and access matrix.
 *
 * The four endpoints it subsumes (`/api/user/onboarding-state`,
 * `/api/workspaces/{ensure-default,resolve,me}`) are all still live for the web
 * app, `@dopl/client` and deep links; `seedBootAnswer` (use-workspace-route.ts)
 * writes this answer into their cache keys so those callers get it free.
 */
export const BOOT_PATH = "/api/boot";

/** Onboarding page's key; boot seeds it, so boot → `/onboarding` pays once. */
export const ONBOARDING_STATE_PATH = "/api/user/onboarding-state";

/** ⚠ Wire shape of `GET /api/workspaces/[segment]/my-access` verbatim. */
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
  /** Null only when caller not onboarded yet (nothing provisioned). */
  workspace: Workspace | null;
  /** Canonical `{slug}-{publicId}`. */
  segment: string | null;
  /** Segment mode: routed segment stale — shell rewrites the URL. */
  needsRedirect: boolean;
  role: Role | null;
  myAccess: BootMyAccess | null;
}

/**
 * One cache entry per boot target: launch (`null`) and each routed segment.
 * ⚠ Must stay the `[path, workspaceId, query]` tuple `use-api-query-core` uses,
 * so the shell's hook-driven boot query and this hand-written launch query
 * address the same cache under the same rules.
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
 * Session view straight off the Electron bridge. `getAuthState()` answers
 * `{ signedIn, userId }` and NEVER a token (dopl-bridge.ts).
 *
 * ⚠ NOT `useAuthUserState` (@/shared/auth/use-auth-user-core): that hook
 * collapses "loading" and "signed out" into one `null` and fetches
 * `/api/user/profile`, guaranteed to 401 exactly where the distinction matters.
 *
 * Browser dev mode has no bridge, so phase starts "signed-in" and the API's 401
 * surfaces the signed-out screen. In Electron the bridge is authoritative and
 * `onAuthState` keeps it live (main pushes on tray sign-out, or a 401 that
 * survived a forced refresh).
 */
export function useAuthPhase(): { phase: AuthPhase; refresh: () => void } {
  const [phase, setPhase] = useState<AuthPhase>(() =>
    getBridge() ? "pending" : "signed-in"
  );

  // ⚠ Monotonic seq: a pushed transition must never be overwritten by a slower
  // in-flight read that started before it — the push is NEWER truth.
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
    // Main pushes transitions so the screen never strands on a dead session.
    const off = bridge.onAuthState((state) => {
      seqRef.current += 1; // outrank every in-flight read
      setPhase(state.signedIn ? "signed-in" : "signed-out");
    });
    return () => {
      cancelled = true;
      off();
    };
    // ⚠ Mount-only on purpose: subscribes to main's auth pushes for page life.
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
