"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { isSpaRenderer } from "@/shared/lib/spa-bridge";
// ⚠ Next-free: reached from `skill-view` and other components the desktop SPA
// reuses, so it must not pull `next/navigation`.
import { useAuthUserState } from "./use-auth-user-core";

export interface CurrentProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Current user's presentable identity (id + display name + avatar), resolving
 * `profiles.display_name`/`avatar_url` with a metadata/email fallback.
 * ⚠ Returns a STABLE object reference while values are unchanged, so callers can
 * use it in effect deps.
 */
export function useCurrentProfile(): CurrentProfile | null {
  const user = useAuthUserState();
  const [profile, setProfile] = useState<{
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);

  useEffect(() => {
    // No synchronous reset: the memo below returns null whenever there is no
    // user, so a stale profile is never shown.
    if (!user) return;
    let cancelled = false;
    // SPA renderer: profile arrived via useAuthUserState's bridge fetch; no
    // Supabase client here. ⚠ Deferred a tick so the set is not a synchronous
    // cascading render inside the effect body.
    if (isSpaRenderer()) {
      const meta = (user.user_metadata ?? {}) as {
        full_name?: string;
        avatar_url?: string;
      };
      queueMicrotask(() => {
        if (cancelled) return;
        setProfile({
          display_name: meta.full_name ?? null,
          avatar_url: meta.avatar_url ?? null,
        });
      });
      return () => {
        cancelled = true;
      };
    }
    const supabase = getSupabaseBrowser();
    void supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(
        ({
          data,
        }: {
          data: { display_name: string | null; avatar_url: string | null } | null;
        }) => {
          if (!cancelled) setProfile(data ?? null);
        }
      );
    return () => {
      cancelled = true;
    };
  }, [user]);

  const displayName =
    profile?.display_name?.trim() ||
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email?.split("@")[0] ||
    "Someone";
  const avatarUrl = profile?.avatar_url ?? null;
  const userId = user?.id ?? null;

  return useMemo(
    () => (userId ? { userId, displayName, avatarUrl } : null),
    [userId, displayName, avatarUrl]
  );
}
