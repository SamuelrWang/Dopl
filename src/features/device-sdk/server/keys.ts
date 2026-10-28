import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  API_KEY_PREFIX,
  API_KEY_SCOPES,
  parseApiKey,
  type ApiKeyKind,
  type ApiKeyScope,
  type Environment,
  type ErrorCode,
} from "../types";

/**
 * DEVICE SDK API KEYS (C1, docs/specs/device-sdk/SPEC-v1.md). Mint, verify, revoke, rotate.
 *
 * ⚠ THE RAW KEY IS NEVER STORED AND NEVER LOGGED. `dev_api_keys.key_hash` is the lowercase hex
 * sha256 of it; `prefix` (e.g. `sk_live_4fQa`) is the only part ever shown again. `mintApiKey` and
 * `rotateApiKey` return the raw key once, to the caller that shows it to the developer.
 *
 * ⚠ ENV ISOLATION: a secret key's prefix names its env (`sk_test_` / `sk_live_`), and the lookup
 * filters on that env, so a test key can never resolve a live row (or the reverse) even if a hash
 * somehow matched. Publishable keys (`pk_`) carry no env in the string; their row's env decides.
 */

const TABLE = "dev_api_keys";

/** Random characters after the prefix. 32 base62 chars ≈ 190 bits. */
const KEY_BODY_LENGTH = 32;
/** Random characters kept in the display prefix (`sk_live_` + 4). */
const DISPLAY_CHARS = 4;
/** Default rotation overlap: the outgoing key keeps working this long. */
export const DEFAULT_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Uniform base62 by rejection sampling (248 = 62 × 4, so `byte % 62` is unbiased below it). */
function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time compare of two hex digests. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** The literal prefix for a key of this kind and env (from the contracts). */
export function keyPrefixFor(kind: ApiKeyKind, env: Environment): string {
  if (kind === "publishable") return API_KEY_PREFIX.publishable;
  return env === "test" ? API_KEY_PREFIX.secret_test : API_KEY_PREFIX.secret_live;
}

/** A fresh raw key plus what is stored for it. Pure: no DB. */
export function generateApiKey(kind: ApiKeyKind, env: Environment): {
  raw: string;
  prefix: string;
  keyHash: string;
} {
  const lead = keyPrefixFor(kind, env);
  const raw = lead + randomBase62(KEY_BODY_LENGTH);
  return { raw, prefix: raw.slice(0, lead.length + DISPLAY_CHARS), keyHash: hashApiKey(raw) };
}

/** Publishable keys carry `connect` only; secret keys default to every scope. */
export function normalizeScopes(kind: ApiKeyKind, scopes?: readonly ApiKeyScope[]): ApiKeyScope[] {
  if (kind === "publishable") {
    if (scopes && scopes.some((s) => s !== "connect")) {
      throw new Error("a publishable key may only carry the `connect` scope");
    }
    return ["connect"];
  }
  const chosen = scopes && scopes.length > 0 ? scopes : API_KEY_SCOPES;
  return [...new Set(chosen)];
}

/** A `dev_api_keys` row as selected here (never `key_hash` outward). */
export interface DevApiKeyRow {
  id: string;
  project_id: string;
  env: Environment;
  kind: ApiKeyKind;
  prefix: string;
  scopes: ApiKeyScope[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

const ROW_COLUMNS =
  "id, project_id, env, kind, prefix, scopes, created_at, last_used_at, revoked_at, expires_at";

export interface MintedKey {
  /** Shown once. Never store or log it. */
  secret: string;
  key: DevApiKeyRow;
}

export async function mintApiKey(input: {
  projectId: string;
  env: Environment;
  kind: ApiKeyKind;
  scopes?: readonly ApiKeyScope[];
}): Promise<MintedKey> {
  const scopes = normalizeScopes(input.kind, input.scopes);
  const { raw, prefix, keyHash } = generateApiKey(input.kind, input.env);
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .insert({
      project_id: input.projectId,
      env: input.env,
      kind: input.kind,
      prefix,
      key_hash: keyHash,
      scopes,
    })
    .select(ROW_COLUMNS)
    .single();
  if (error) throw new Error(`mintApiKey failed: ${error.message}`);
  return { secret: raw, key: data as DevApiKeyRow };
}

/** Revoke now. Idempotent: an already-revoked key keeps its first `revoked_at`. */
export async function revokeApiKey(input: { projectId: string; keyId: string }): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.keyId)
    .eq("project_id", input.projectId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`revokeApiKey failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** Why a key cannot be rotated. `code` is the portal route's 409 error code. */
export class KeyNotRotatableError extends Error {
  constructor(readonly code: "KEY_REVOKED" | "KEY_EXPIRED" | "KEY_ROTATING", message: string) {
    super(message);
    this.name = "KeyNotRotatableError";
  }
}

/**
 * Mint a replacement with the same env, kind and scopes, and give the outgoing key an
 * `expires_at` overlap window.
 *
 * ⚠ ONLY A LIVE, UN-ROTATED KEY ROTATES. A revoked key, an expired key, or a key already in its
 * overlap window (`expires_at` set) is refused with `KeyNotRotatableError`: rotating an expired
 * key would mint a working credential off a dead one, and rotating one already rotating would
 * leave several live replacements.
 * ⚠ THE CLAIM IS ATOMIC: the old key's `expires_at` is set by an UPDATE conditioned on
 * `expires_at IS NULL AND revoked_at IS NULL`, BEFORE the replacement is minted. Two concurrent
 * rotations (two tabs, a retry) race on that UPDATE; exactly one wins, the other is refused.
 * If minting then fails, the old key still expires after the overlap and the caller sees an error.
 */
export async function rotateApiKey(input: {
  projectId: string;
  keyId: string;
  overlapMs?: number;
  now?: Date;
}): Promise<MintedKey & { previous: { id: string; expires_at: string } }> {
  const db = supabaseAdmin();
  const { data: old, error } = await db
    .from(TABLE)
    .select(ROW_COLUMNS)
    .eq("id", input.keyId)
    .eq("project_id", input.projectId)
    .maybeSingle();
  if (error) throw new Error(`rotateApiKey failed: ${error.message}`);
  const prev = old as DevApiKeyRow | null;
  if (!prev) throw new Error("rotateApiKey: key not found");
  const now = input.now ?? new Date();
  if (prev.revoked_at) throw new KeyNotRotatableError("KEY_REVOKED", "A revoked key cannot be rotated");
  if (prev.expires_at && Date.parse(prev.expires_at) <= now.getTime()) {
    throw new KeyNotRotatableError("KEY_EXPIRED", "An expired key cannot be rotated");
  }
  if (prev.expires_at) throw new KeyNotRotatableError("KEY_ROTATING", "This key is already being rotated");

  const expiresAt = new Date(now.getTime() + (input.overlapMs ?? DEFAULT_ROTATION_OVERLAP_MS)).toISOString();
  const { data: claimed, error: upErr } = await db
    .from(TABLE)
    .update({ expires_at: expiresAt })
    .eq("id", prev.id)
    .eq("project_id", prev.project_id)
    .is("expires_at", null)
    .is("revoked_at", null)
    .select("id");
  if (upErr) throw new Error(`rotateApiKey failed: ${upErr.message}`);
  if (!Array.isArray(claimed) || claimed.length === 0) {
    throw new KeyNotRotatableError("KEY_ROTATING", "This key is already being rotated");
  }

  const minted = await mintApiKey({
    projectId: prev.project_id,
    env: prev.env,
    kind: prev.kind,
    scopes: prev.scopes,
  });
  return { ...minted, previous: { id: prev.id, expires_at: expiresAt } };
}

/** What a verified key resolves to. */
export interface ResolvedDeveloperKey {
  orgId: string;
  projectId: string;
  env: Environment;
  apiVersion: string;
  key: { id: string; kind: ApiKeyKind; scopes: ApiKeyScope[]; prefix: string };
}

export type VerifyResult =
  | { ok: true; resolved: ResolvedDeveloperKey }
  | {
      ok: false;
      code: Extract<ErrorCode, "unauthenticated">;
      message: string;
      /** Set only when the key's row was found (revoked / expired): its project, for the event log. */
      known?: ResolvedDeveloperKey;
    };

interface KeyLookupRow extends DevApiKeyRow {
  key_hash: string;
  project: { id: string; org_id: string; api_version: string } | null;
}

const INVALID = "Invalid API key provided.";

/**
 * Verify a raw key: shape (contracts regexes) → sha256 → lookup by hash (and, for a secret key,
 * by the env its prefix names) → constant-time hash compare → revoked / expired checks.
 * Throws only on a database failure.
 */
export async function verifyApiKey(raw: string, now: Date = new Date()): Promise<VerifyResult> {
  const parsed = parseApiKey(raw);
  if (!parsed) return { ok: false, code: "unauthenticated", message: INVALID };

  const keyHash = hashApiKey(raw);
  let query = supabaseAdmin()
    .from(TABLE)
    .select(`${ROW_COLUMNS}, key_hash, project:dev_projects!inner(id, org_id, api_version)`)
    .eq("key_hash", keyHash)
    .eq("kind", parsed.kind);
  if (parsed.env) query = query.eq("env", parsed.env);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`verifyApiKey lookup failed: ${error.message}`);

  const row = data as KeyLookupRow | null;
  if (!row || !row.project || !sameHash(keyHash, row.key_hash)) {
    return { ok: false, code: "unauthenticated", message: INVALID };
  }
  // Belt and braces over the query filters: the string's kind/env must match the row's.
  if (row.kind !== parsed.kind || (parsed.env !== null && row.env !== parsed.env)) {
    return { ok: false, code: "unauthenticated", message: INVALID };
  }
  const resolved: ResolvedDeveloperKey = {
    orgId: row.project.org_id,
    projectId: row.project.id,
    env: row.env,
    apiVersion: row.project.api_version,
    key: { id: row.id, kind: row.kind, scopes: row.scopes, prefix: row.prefix },
  };
  if (row.revoked_at) {
    return { ok: false, code: "unauthenticated", message: "This API key has been revoked.", known: resolved };
  }
  if (row.expires_at && new Date(row.expires_at) <= now) {
    return { ok: false, code: "unauthenticated", message: "This API key has expired.", known: resolved };
  }
  return { ok: true, resolved };
}

/** Per-key last write, so a hot key costs one UPDATE a minute, not one per request. */
const LAST_USED_INTERVAL_MS = 60_000;
const lastTouched = new Map<string, number>();

/** Fire-and-forget `last_used_at` bump. Never awaited, never throws. */
export function touchApiKeyLastUsed(keyId: string, now: number = Date.now()): void {
  const last = lastTouched.get(keyId) ?? 0;
  if (now - last < LAST_USED_INTERVAL_MS) return;
  lastTouched.set(keyId, now);
  try {
    supabaseAdmin()
      .from(TABLE)
      .update({ last_used_at: new Date(now).toISOString() })
      .eq("id", keyId)
      .then(
        ({ error }) => {
          if (error) console.error("[device-sdk] last_used_at update failed:", error.message);
        },
        (err: unknown) => console.error("[device-sdk] last_used_at update failed:", err)
      );
  } catch (err) {
    console.error("[device-sdk] last_used_at update failed:", err);
  }
}

/** Test seam: forget the throttle. */
export function resetLastUsedThrottleForTests(): void {
  lastTouched.clear();
}
