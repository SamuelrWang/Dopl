import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Raw Supabase I/O for PER-USER knowledge-base stars
 * (`20260812130000_knowledge_base_stars.sql`). No business logic, no auth
 * checks; see `repository.ts` for the split map and conventions.
 *
 * EVERY FUNCTION HERE TAKES A `userId` AND FILTERS ON IT. The table's whole
 * point is that a row belongs to one person, and this client is the service
 * role, which bypasses RLS — so the `.eq("user_id", …)` on each statement is
 * the fence, not a hint. There is deliberately no "list every star on this
 * base" read: nothing in the product asks who else starred something, and the
 * absence is what keeps a private signal private.
 *
 * The base-id set is passed in by the service, already narrowed to what the
 * caller may see, exactly as `listBaseStorageBytes` takes one — so a star on a
 * base hidden by the private/teams gate can never surface through this path.
 */

/**
 * Which of `baseIds` this user has starred. Returns the ids, in no particular
 * order — the grid's ordering is the LIST's order with the starred ones lifted
 * to the front, never this query's.
 *
 * One statement for the whole grid: an `in` filter, so N cards cost one round
 * trip on the same request that fetched the bases.
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

/**
 * Star a base for one user. IDEMPOTENT — `ignoreDuplicates` turns a re-star
 * into a no-op instead of a unique-violation, which is what lets the client
 * retry a failed toggle without having to know whether the first attempt
 * landed. The row is the fact; a second one would not be a second fact.
 */
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

/**
 * Unstar. Also idempotent: deleting a row that is not there matches zero rows
 * and succeeds, which is the correct answer to "make sure this is not starred".
 */
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
