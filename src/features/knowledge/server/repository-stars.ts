import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Raw Supabase I/O for PER-USER knowledge-base stars. No business logic, no
 * auth checks — see `repository.ts` for the split map and conventions.
 *
 * ⚠ EVERY FUNCTION TAKES A `userId` AND FILTERS ON IT. This client is the
 * service role and bypasses RLS, so each `.eq("user_id", …)` IS the fence, not
 * a hint. There is deliberately NO "list every star on this base" read —
 * that absence is what keeps a private signal private.
 *
 * The base-id set arrives from the service already narrowed to what the caller
 * may see, so a star on a gate-hidden base can never surface here.
 */

/**
 * Which of `baseIds` this user starred. ⚠ Unordered — grid ordering is the
 * LIST's order with starred ones lifted, never this query's. One `in` filter,
 * so N cards cost one round trip.
 */
export async function listStarredBaseIds(
  userId: string,
  baseIds: string[]
): Promise<string[]> {
  if (baseIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_base_stars")
    .select("knowledge_base_id")
    .eq("user_id", userId)
    .in("knowledge_base_id", baseIds);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ knowledge_base_id: string }>).map(
    (row) => row.knowledge_base_id
  );
}

/** Star a base. IDEMPOTENT via `ignoreDuplicates` — a re-star no-ops instead
 *  of violating unique, so clients can retry an ambiguous toggle. */
export async function insertBaseStar(
  userId: string,
  baseId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_base_stars")
    .upsert(
      { user_id: userId, knowledge_base_id: baseId },
      { onConflict: "user_id,knowledge_base_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

/** Unstar. Idempotent — a delete matching zero rows still succeeds. */
export async function deleteBaseStar(
  userId: string,
  baseId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_base_stars")
    .delete()
    .eq("user_id", userId)
    .eq("knowledge_base_id", baseId);
  if (error) throw error;
}
