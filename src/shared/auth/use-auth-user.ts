"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import type { User } from "@supabase/supabase-js";

export interface AuthUser {
  user: User | null;
  signOut: () => Promise<void>;
}

/**
 * Subscribe to the current Supabase auth user on the client and expose a
 * sign-out action. Single source of truth for "who is logged in" in the
 * shell — the workspace switcher and any other client surface reuse this
 * rather than re-implementing the getUser + onAuthStateChange dance.
 */
export function useAuthUser(): AuthUser {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const supabase = getSupabaseBrowser();

  useEffect(() => {
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
  }, [supabase]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return { user, signOut };
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
