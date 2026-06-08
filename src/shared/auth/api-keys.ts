import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { API_KEY_PREFIX } from "@/config";
import { encryptKey, decryptKey } from "./key-crypto";

// Audit fix #27: was `const supabase = supabaseAdmin()` at module load —
// fails fast on missing SUPABASE_SERVICE_ROLE_KEY before any call site
// runs, and makes test isolation harder. Each function below now grabs
// the admin client lazily, matching the convention in every other
// repository file.

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
 *
 * `workspace_id` (added in Item 4) is non-null when the key is locked to a
 * specific workspace. Auth wrappers use it to override the
 * `X-Workspace-Id` header — see `with-workspace-auth.ts`.
 */
export async function validateApiKey(
  key: string
): Promise<{
  id: string;
  name: string;
  rate_limit_rpm: number;
  user_id: string | null;
  workspace_id: string | null;
} | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;

  const supabase = supabaseAdmin();
  const hash = hashApiKey(key);
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, rate_limit_rpm, revoked_at, user_id, workspace_id")
    .eq("key_hash", hash)
    .single();

  if (error || !data) return null;
  if (data.revoked_at) return null;

  return {
    id: data.id,
    name: data.name,
    rate_limit_rpm: data.rate_limit_rpm,
    user_id: data.user_id,
    workspace_id: data.workspace_id,
  };
}

/**
 * Atomic rate-limit check + usage record. Returns true if within limit and
 * the usage was recorded, false if the limit would be exceeded.
 *
 * Backed by `check_and_record_rate_limit` RPC (migration 034), which uses
 * a Postgres advisory lock keyed on the api_key_id so concurrent requests
 * for the same key serialize without blocking other keys.
 *
 * Fails closed — if the DB call errors, the request is rejected.
 */
export async function checkAndRecordRateLimit(
  keyId: string,
  rpm: number,
  endpoint: string
): Promise<boolean> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.rpc("check_and_record_rate_limit", {
    p_api_key_id: keyId,
    p_rpm: rpm,
    p_endpoint: endpoint,
  });

  if (error) {
    console.error("[auth] Rate limit RPC failed:", error);
    return false; // Fail closed
  }

  return data === true;
}

/**
 * Atomic rate-limit check + record keyed by an arbitrary text subject, backed
 * by `check_and_record_rate_limit_subject` + the FK-free `rate_limit_events`
 * table. Use this for callers that aren't api_keys rows — e.g. OAuth access
 * tokens ("mcp:<token_id>") — since the api_key_usage table FKs to api_keys.
 *
 * Fails closed, like checkAndRecordRateLimit.
 */
export async function checkAndRecordRateLimitSubject(
  subject: string,
  rpm: number,
  endpoint: string
): Promise<boolean> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.rpc(
    "check_and_record_rate_limit_subject",
    { p_subject: subject, p_rpm: rpm, p_endpoint: endpoint }
  );

  if (error) {
    console.error("[auth] Subject rate limit RPC failed:", error);
    return false; // Fail closed
  }

  return data === true;
}

/**
 * Refresh last_used_at on the api_keys row and opportunistically prune
 * old usage records. Fire-and-forget — never blocks the caller.
 */
export function touchApiKey(keyId: string): void {
  const supabase = supabaseAdmin();
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId)
    .then(({ error }) => {
      if (error) console.error("[auth] touchApiKey failed:", error);
    });

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
 * Refresh profiles.mcp_connected_at for the owner of an API key. Fire-and-forget.
 *
 * Every authenticated MCP call touches this timestamp. The
 * settings/keys page's MCP install card polls `/api/user/mcp-status`
 * (every 3s while open) to detect when the user has connected their
 * agent — any tool call advances the timestamp, not just MCP server
 * boot, so the connection card flips to "connected" as soon as the
 * agent does anything real.
 *
 * In-process debounce: only writes once every 30s per user, since
 * the client polls every 3s and tolerates 5 minutes of staleness.
 * The debounce map is intentionally unbounded-but-small (one entry
 * per active user); process restarts clear it harmlessly.
 */
const mcpStatusLastTouched = new Map<string, number>();
const MCP_STATUS_TOUCH_INTERVAL_MS = 30_000;

export function touchMcpStatus(userId: string): void {
  const now = Date.now();
  const last = mcpStatusLastTouched.get(userId) ?? 0;
  if (now - last < MCP_STATUS_TOUCH_INTERVAL_MS) return;
  mcpStatusLastTouched.set(userId, now);

  const supabase = supabaseAdmin();
  supabase
    .from("profiles")
    .update({ mcp_connected_at: new Date(now).toISOString() })
    .eq("id", userId)
    .then(({ error }) => {
      if (error) console.error("[auth] touchMcpStatus failed:", error);
    });
}

/**
 * Create a new API key. Returns the plaintext key (shown ONCE).
 *
 * Pass `workspaceId` to lock the key to a single workspace — used by
 * MCP clients that should only ever operate on one workspace. When
 * unset (the default), the key behaves like a user-scoped key and
 * resolves to the user's default workspace per the existing flow.
 */
export async function createApiKey(
  name: string,
  userId?: string,
  workspaceId?: string
): Promise<{ key: string; id: string; name: string; prefix: string }> {
  const { key, hash, prefix } = generateApiKey();

  const row: Record<string, unknown> = {
    key_hash: hash,
    key_prefix: prefix,
    name,
    // Encrypted at rest so the owner can reveal it later (auth still
    // uses key_hash only). AES-256-GCM, packed base64.
    encrypted_key: encryptKey(key),
  };
  if (userId) row.user_id = userId;
  if (workspaceId) row.workspace_id = workspaceId;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .insert(row)
    .select("id")
    .single();

  // Propagate the raw PostgrestError so callers can branch on `.code`
  // (e.g. 23505 unique-violation → "active key already exists").
  if (error) throw error;
  if (!data) throw new Error("Failed to create API key");

  return { key, id: data.id, name, prefix };
}

/** The current active (non-revoked) key for a (user, workspace), or null. */
export async function findActiveWorkspaceKey(
  userId: string,
  workspaceId: string
): Promise<{ id: string; key_prefix: string; name: string } | null> {
  const keys = await listApiKeys({ userId, workspaceId });
  const active = keys.find((k) => !k.revoked_at);
  return active
    ? { id: active.id, key_prefix: active.key_prefix, name: active.name }
    : null;
}

/**
 * Idempotent auto-generation: mint a workspace-scoped key for the
 * (user, workspace) pair if one doesn't already exist. Safe to call on
 * every workspace create / invite accept — a concurrent create that
 * trips the unique index is treated as success. Lives in shared/auth so
 * workspace lifecycle code can trigger it without a cross-feature import.
 */
export async function ensureWorkspaceKey(
  userId: string,
  workspaceId: string,
  name: string = "Workspace key"
): Promise<void> {
  if (await findActiveWorkspaceKey(userId, workspaceId)) return;
  try {
    await createApiKey(name, userId, workspaceId);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") return; // race: lost
    throw e;
  }
}

/**
 * Decrypt and return an API key's plaintext, gated to its owner. Pass
 * the owner filters (userId and/or workspaceId) so a member can't
 * reveal another member's key by guessing an id. Returns null when the
 * key isn't found/owned OR has no stored ciphertext (pre-encryption
 * legacy keys — those are non-revealable).
 */
export async function revealApiKey(
  id: string,
  opts: { userId?: string; workspaceId?: string } = {}
): Promise<string | null> {
  const supabase = supabaseAdmin();
  let query = supabase
    .from("api_keys")
    .select("encrypted_key, revoked_at")
    .eq("id", id);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  if (opts.workspaceId) query = query.eq("workspace_id", opts.workspaceId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || !data.encrypted_key) return null;
  try {
    return decryptKey(data.encrypted_key);
  } catch (e) {
    // Corrupt ciphertext or a rotated/missing encryption secret →
    // treat as non-revealable rather than 500ing the caller.
    console.error("[auth] API key decrypt failed:", e);
    return null;
  }
}

/**
 * Revoke an API key. If `userId` is provided, ensures the key belongs
 * to that user. If `workspaceId` is provided, ensures the key is
 * locked to that workspace — used by the workspace-scoped revoke
 * endpoint to prevent cross-workspace tampering.
 */
export async function revokeApiKey(
  id: string,
  opts: { userId?: string; workspaceId?: string } = {}
): Promise<void> {
  const supabase = supabaseAdmin();
  let query = supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (opts.userId) {
    query = query.eq("user_id", opts.userId);
  }
  if (opts.workspaceId) {
    query = query.eq("workspace_id", opts.workspaceId);
  }

  const { error, count } = await query.select("id").then((res) => ({
    error: res.error,
    count: res.data?.length ?? 0,
  }));

  if (error) {
    throw new Error(`Failed to revoke API key: ${error.message}`);
  }

  if ((opts.userId || opts.workspaceId) && count === 0) {
    throw new Error("API key not found or not owned by you");
  }
}

/**
 * List API keys (never returns hashes). Optionally filter by user
 * and/or workspace. When `workspaceId` is provided, only keys locked
 * to that workspace are returned (`workspace_id IS NOT NULL` AND
 * matching).
 */
export async function listApiKeys(opts?: {
  userId?: string;
  workspaceId?: string;
}): Promise<
  {
    id: string;
    key_prefix: string;
    name: string;
    rate_limit_rpm: number;
    workspace_id: string | null;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }[]
> {
  const supabase = supabaseAdmin();
  let query = supabase
    .from("api_keys")
    .select(
      "id, key_prefix, name, rate_limit_rpm, workspace_id, created_at, last_used_at, revoked_at"
    )
    .order("created_at", { ascending: false });

  if (opts?.userId) {
    query = query.eq("user_id", opts.userId);
  }
  if (opts?.workspaceId) {
    query = query.eq("workspace_id", opts.workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list API keys: ${error.message}`);
  }

  return data || [];
}
