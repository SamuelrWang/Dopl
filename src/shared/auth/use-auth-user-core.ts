"use client";

/**
 * The Next-free half of `use-auth-user.ts`.
 *
 * `useAuthUser` needs `next/navigation`'s router for one thing only — the
 * post-sign-out `router.push("/login")`. Everything else (subscribe to the
 * Supabase auth user, derive initials) is framework-agnostic and is imported
 * transitively by client components the desktop SPA reuses
 * (`use-current-profile` → `skill-view`). Splitting the router out keeps that
 * import graph free of `next/*`, which is the SPA's build-time fence
 * (apps/desktop-ui/CONVENTIONS.md § Sharing code with the web app).
 *
 * The web app keeps importing `useAuthUser` from `./use-auth-user`; nothing
 * about its behaviour changes.
 */

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import type { User } from "@supabase/supabase-js";

/**
 * Subscribe to the current Supabase auth user on the client. Single source of
 * truth for "who is logged in"; `useAuthUser` wraps this with a sign-out
 * action that also navigates.
 */
export function useAuthUserState(): User | null {
  const [user, setUser] = useState<User | null>(null);
  // Bundled desktop SPA: no Supabase client exists in the renderer (no
  // config, no network by design). Identity comes over the bridge —
  // `window.dopl.getAuthState()` for the id, `/api/user/profile` (which
  // rides the IPC transport inside apiRequest) for the presentable fields.
  // The object is shaped like the Supabase `User` surface the consumers
  // actually read: `id`, `email`, `user_metadata.full_name`.
  const bridge =
    typeof window !== "undefined"
      ? (
          window as {
            dopl?: {
              getAuthState(): Promise<{ signedIn: boolean; userId: string | null }>;
            };
          }
        ).dopl
      : undefined;

  useEffect(() => {
    if (bridge) {
      let cancelled = false;
      void (async () => {
        try {
          const state = await bridge.getAuthState();
          if (cancelled || !state.signedIn || !state.userId) return;
          const { apiRequest } = await import("@/shared/api/api-client");
          const profile = await apiRequest<{
            display_name?: string | null;
            avatar_url?: string | null;
          }>("/api/user/profile").catch(() => null);
          if (cancelled) return;
          setUser({
            id: state.userId,
            email: undefined,
            user_metadata: {
              full_name: profile?.display_name ?? undefined,
              avatar_url: profile?.avatar_url ?? undefined,
            },
          } as unknown as User);
        } catch {
          // Signed-out / bridge failure → stay null (honest signed-out UI).
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const supabase = getSupabaseBrowser();
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

/**
 * Two-letter initials for an avatar fallback. Prefers full name, then
 * the email local-part, then "?".
 */
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
