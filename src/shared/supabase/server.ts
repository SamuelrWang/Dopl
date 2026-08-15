import { cache } from "react";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "./admin";

/** Auth-aware Supabase client for Server Components and API routes. ⚠ Must be
 *  called within a request context (where `cookies()` is available). */
export async function getServerClient() {
  const cookieStore = await cookies();
  return createServerSupabaseClient(cookieStore);
}

/** Currently authenticated user, or null. ⚠ React `cache()`-wrapped: layout and
 *  page both call this per request, and memoization collapses the duplicate auth
 *  round-trips. */
export const getUser = cache(async () => {
  const client = await getServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
});
