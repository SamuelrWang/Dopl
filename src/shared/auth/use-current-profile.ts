"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { useAuthUser } from "./use-auth-user";

export interface CurrentProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * The current user's presentable identity (id + display name + avatar),
 * resolving `profiles.display_name`/`avatar_url` with a metadata/email
 * fallback. Shared because multiple surfaces (editor presence headers)
 * need it. Returns a stable object reference while the values are
 * unchanged so callers can safely use it in effect deps.
 */
export function useCurrentProfile(): CurrentProfile | null {
  const { user } = useAuthUser();
  const [profile, setProfile] = useState<{
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);

  useEffect(() => {
    // No synchronous reset here (stale profile is never shown — the
    // memo below returns null whenever there's no user).
    if (!user) return;
    let cancelled = false;
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
