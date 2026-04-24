import { supabaseAdmin } from "@/shared/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a slug-or-UUID input to the canonical entry UUID.
 * Returns null if no matching entry exists.
 *
 * Backend handlers should call this before any `.eq("id", ...)` filter
 * so API callers can use either the public slug or the internal UUID.
 */
export async function resolveEntryId(
  input: string
): Promise<string | null> {
  if (!input) return null;
  if (UUID_RE.test(input)) return input;

  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from("entries")
    .select("id")
    .eq("slug", input)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}

/** Pure-sync UUID check — no DB lookup. */
export function isUuid(input: string): boolean {
  return UUID_RE.test(input);
}
