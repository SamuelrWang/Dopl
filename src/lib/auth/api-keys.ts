import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { API_KEY_PREFIX } from "@/lib/config";
const supabase = supabaseAdmin();

/**
 * Generate a new API key. Returns the plaintext key (shown once) and its hash.
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const random = randomBytes(20).toString("hex"); // 40 hex chars
  const key = `${API_KEY_PREFIX}${random}`;
  const hash = hashApiKey(key);
  const prefix = key.substring(0, 12);
  return { key, hash, prefix };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Validate an API key. Returns the key record if valid, null if invalid/revoked.
 */
export async function validateApiKey(
  key: string
): Promise<{
  id: string;
  name: string;
  rate_limit_rpm: number;
  user_id: string | null;
} | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;

  const hash = hashApiKey(key);
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, rate_limit_rpm, revoked_at, user_id")
    .eq("key_hash", hash)
    .single();

  if (error || !data) return null;
  if (data.revoked_at) return null;

  return {
    id: data.id,
    name: data.name,
    rate_limit_rpm: data.rate_limit_rpm,
    user_id: data.user_id,
  };
}

/**
 * Check rate limit for a key. Returns true if within limit, false if exceeded.
 * Fails closed — if the DB check fails, the request is rejected.
 *
 * NOTE: This check is not fully atomic — concurrent requests may both pass
 * the count check before either records usage. For stronger guarantees at
 * scale, move to a Postgres function that checks + inserts in one transaction.
 */
export async function checkRateLimit(
  keyId: string,
  rpm: number
): Promise<boolean> {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();

  const { count, error } = await supabase
    .from("api_key_usage")
    .select("*", { count: "exact", head: true })
    .eq("api_key_id", keyId)
    .gte("requested_at", oneMinuteAgo);

  if (error) {
    console.error("[auth] Rate limit check failed:", error);
    return false; // Fail closed — reject request on DB errors
  }

  return (count || 0) < rpm;
}

/**
 * Record a usage event for a key.
 */
export async function recordUsage(
  keyId: string,
  endpoint: string
): Promise<void> {
  await supabase.from("api_key_usage").insert({
    api_key_id: keyId,
    endpoint,
  });

  // Update last_used_at (fire-and-forget)
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId);

  // Periodically prune old usage records (1 in 100 chance per request)
  if (Math.random() < 0.01) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from("api_key_usage")
      .delete()
      .lt("requested_at", oneDayAgo)
      .then(({ error }) => {
        if (error) console.error("[auth] Usage cleanup failed:", error);
      });
  }
}

/**
 * Create a new API key. Returns the plaintext key (shown ONCE).
 */
export async function createApiKey(
  name: string,
  userId?: string
): Promise<{ key: string; id: string; name: string; prefix: string }> {
  const { key, hash, prefix } = generateApiKey();

  const row: Record<string, unknown> = {
    key_hash: hash,
    key_prefix: prefix,
    name,
  };
  if (userId) row.user_id = userId;

  const { data, error } = await supabase
    .from("api_keys")
    .insert(row)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create API key: ${error?.message}`);
  }

  return { key, id: data.id, name, prefix };
}

/**
 * Revoke an API key. If userId is provided, ensures the key belongs to that user.
 */
export async function revokeApiKey(id: string, userId?: string): Promise<void> {
  let query = supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { error, count } = await query.select("id").then((res) => ({
    error: res.error,
    count: res.data?.length ?? 0,
  }));

  if (error) {
    throw new Error(`Failed to revoke API key: ${error.message}`);
  }

  if (userId && count === 0) {
    throw new Error("API key not found or not owned by you");
  }
}

/**
 * List API keys (never returns hashes). Optionally filter by user.
 */
export async function listApiKeys(opts?: { userId?: string }): Promise<
  {
    id: string;
    key_prefix: string;
    name: string;
    rate_limit_rpm: number;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }[]
> {
  let query = supabase
    .from("api_keys")
    .select(
      "id, key_prefix, name, rate_limit_rpm, created_at, last_used_at, revoked_at"
    )
    .order("created_at", { ascending: false });

  if (opts?.userId) {
    query = query.eq("user_id", opts.userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list API keys: ${error.message}`);
  }

  return data || [];
}
