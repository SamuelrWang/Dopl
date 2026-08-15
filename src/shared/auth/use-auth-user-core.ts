"use client";

/**
 * The Next-free half of `use-auth-user.ts` (which needs `next/navigation` only
 * for the post-sign-out `router.push("/login")`).
 *
 * ⚠ Must stay free of `next/*` — this graph is imported transitively by client
 * components the desktop SPA reuses (`use-current-profile` → `skill-view`), and
 * `next/*` is the SPA's build-time fence (apps/desktop-ui/CONVENTIONS.md).
 */

import { useEffect, useState } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import type { User } from "@supabase/supabase-js";

/** One in-flight/settled identity per RENDERER, not per hook instance —
 *  SkillsBrowser remounts SkillView per selected row and each remount must not
 *  cost a fresh getAuthState + profile IPC pair. ⚠ Invalidated on every pushed
 *  auth-state transition. */
let bridgeUserCache: Promise<User | null> | null = null;

function fetchBridgeUser(bridge: {
  getAuthState(): Promise<{ signedIn: boolean; userId: string | null }>;
}): Promise<User | null> {
  if (!bridgeUserCache) {
    bridgeUserCache = (async () => {
      const state = await bridge.getAuthState();
      if (!state.signedIn || !state.userId) return null;
      const { apiRequest } = await import("@/shared/api/api-client");
      const profile = await apiRequest<{
        display_name?: string | null;
        avatar_url?: string | null;
        email?: string | null;
      }>("/api/user/profile").catch(() => null);
      return {
        id: state.userId,
        // profiles carries email (PROFILE_COLUMNS) so initials and the
        // email-local-part display fallbacks behave exactly as on web.
        email: profile?.email ?? undefined,
        user_metadata: {
          full_name: profile?.display_name ?? undefined,
          avatar_url: profile?.avatar_url ?? undefined,
        },
      } as unknown as User;
    })();
    // A failed fetch must not poison every later mount.
    bridgeUserCache.catch(() => {
      bridgeUserCache = null;
    });
  }
  return bridgeUserCache;
}

export function useAuthUserState(): User | null {
  const [user, setUser] = useState<User | null>(null);
  // Bundled SPA: no Supabase client in the renderer (no config, no network by
  // design). Identity comes over the bridge — `getAuthState()` for the id,
  // `/api/user/profile` for presentable fields — shaped like the Supabase
  // `User` surface consumers read: `id`, `email`, `user_metadata.full_name`.
  const bridge = getSpaBridge();

  useEffect(() => {
    if (bridge) {
      let cancelled = false;
      const load = async () => {
        try {
          const u = await fetchBridgeUser(bridge);
          if (!cancelled) setUser(u);
        } catch {
          // Signed-out / bridge failure → stay null (honest signed-out UI).
          if (!cancelled) setUser(null);
        }
      };
      void load();
      // ⚠ Main pushes auth transitions (a 401 surviving a forced refresh emits
      // 'signed-out'); mirror the web branch's onAuthStateChange subscription or
      // the renderer renders a signed-in identity forever.
      const maybeOn = (
        bridge as {
          onAuthState?: (cb: (s: { signedIn: boolean }) => void) => () => void;
        }
      ).onAuthState;
      const off =
        typeof maybeOn === "function"
          ? maybeOn(() => {
              bridgeUserCache = null; // state changed — never serve the stale identity
              void load();
            })
          : undefined;
      return () => {
        cancelled = true;
        if (off) off();
      };
    }

    let supabase: ReturnType<typeof getSupabaseBrowser>;
    try {
      supabase = getSupabaseBrowser();
    } catch {
      // No browser Supabase config — honest signed-out state instead of an
      // unmount-the-tree throw.
      return;
    }
    supabase.auth
      .getUser()
      .then(({ data }: { data: { user: User | null } }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user: User } | null) => {
        setUser(session?.user ?? null);
      },
    );

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return user;
}

/** Two-letter initials for an avatar fallback: full name, then email local-part,
 *  then "?". */
export function userInitials(user: User): string {
  const name =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    user.email ||
    "";
  const parts = name.split(/[\s@]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (name[0] || "?").toUpperCase();
}
