import { cookies } from "next/headers";
import { createServerSupabaseClient } from "./admin";

/**
 * Create an auth-aware Supabase client for Server Components and API routes.
 * Must be called within a request context (where `cookies()` is available).
 */
export async function getServerClient() {
  const cookieStore = await cookies();
  return createServerSupabaseClient(cookieStore);
}

/**
 * Get the currently authenticated user, or null if not logged in.
 */
export async function getUser() {
  const client = await getServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
}
