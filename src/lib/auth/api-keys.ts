import { createHash, randomBytes } from "crypto";
import { supabase } from "@/lib/supabase";

const KEY_PREFIX = "sk-sie-";

/**
 * Generate a new API key. Returns the plaintext key (shown once) and its hash.
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const random = randomBytes(20).toString("hex"); // 40 hex chars
  const key = `${KEY_PREFIX}${random}`;
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
): Promise<{ id: string; name: string; rate_limit_rpm: number } | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;

  const hash = hashApiKey(key);
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, rate_limit_rpm, revoked_at")
    .eq("key_hash", hash)
    .single();

  if (error || !data) return null;
  if (data.revoked_at) return null;

  return { id: data.id, name: data.name, rate_limit_rpm: data.rate_limit_rpm };
}

/**
 * Check rate limit for a key. Returns true if within limit, false if exceeded.
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
    return true; // Fail open — don't block on DB errors
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
}

/**
 * Create a new API key. Returns the plaintext key (shown ONCE).
 */
export async function createApiKey(
  name: string
): Promise<{ key: string; id: string; name: string; prefix: string }> {
  const { key, hash, prefix } = generateApiKey();

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      key_hash: hash,
      key_prefix: prefix,
      name,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create API key: ${error?.message}`);
  }

  return { key, id: data.id, name, prefix };
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(id: string): Promise<void> {
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to revoke API key: ${error.message}`);
  }
}

/**
 * List all API keys (never returns hashes).
 */
export async function listApiKeys(): Promise<
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
  const { data, error } = await supabase
    .from("api_keys")
    .select(
      "id, key_prefix, name, rate_limit_rpm, created_at, last_used_at, revoked_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list API keys: ${error.message}`);
  }

  return data || [];
}
