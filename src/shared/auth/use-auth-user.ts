"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { useAuthUserState } from "./use-auth-user-core";
import type { User } from "@supabase/supabase-js";

export { userInitials } from "./use-auth-user-core";

export interface AuthUser {
  user: User | null;
  signOut: () => Promise<void>;
}

/**
 * Subscribe to the current Supabase auth user on the client and expose a
 * sign-out action. Single source of truth for "who is logged in" in the
 * shell — the workspace switcher and any other client surface reuse this
 * rather than re-implementing the getUser + onAuthStateChange dance.
 *
 * The subscription itself lives in `./use-auth-user-core` so consumers that
 * only need the user (and must stay Next-free for the desktop SPA) can import
 * it without pulling `next/navigation` in.
 */
export function useAuthUser(): AuthUser {
  const router = useRouter();
  const user = useAuthUserState();

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return { user, signOut };
}
