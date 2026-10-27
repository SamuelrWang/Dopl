import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

export interface PreviewRow {
  surface: string;
  payload: unknown;
}

/** The reader's own preview rows (one per surface at most). Service role: the table has no policy. */
export async function listOwnPreviewRows(userId: string): Promise<PreviewRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("account_preview_data")
    .select("surface,payload")
    .eq("user_id", userId)
    .limit(2);
  if (error) throw error;
  return (data ?? []).map((row) => ({ surface: row.surface, payload: row.payload }));
}
