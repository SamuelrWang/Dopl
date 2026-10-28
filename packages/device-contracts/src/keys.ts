/**
 * C1 — developer API keys (spec v1 › C1).
 *
 * Secret keys `sk_test_…` / `sk_live_…` are server-to-server Bearer credentials; publishable keys
 * `pk_…` may only create Connect sessions. Keys are stored hashed (only `prefix` is ever shown again)
 * and rotate with an overlap window (`expires_at` on the outgoing key).
 */
import { z } from "zod";

export const ENVIRONMENTS = ["test", "live"] as const;
export const EnvironmentSchema = z.enum(ENVIRONMENTS);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const API_KEY_KINDS = ["secret", "publishable"] as const;
export const ApiKeyKindSchema = z.enum(API_KEY_KINDS);
export type ApiKeyKind = z.infer<typeof ApiKeyKindSchema>;

/** Coarse per-key scopes. A publishable key carries `connect` only. */
export const API_KEY_SCOPES = ["connect", "devices:read", "actions:write", "analytics:read"] as const;
export const ApiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

/** The literal key prefixes. */
export const API_KEY_PREFIX = {
  secret_test: "sk_test_",
  secret_live: "sk_live_",
  publishable: "pk_",
} as const;

export const SECRET_KEY_RE = /^sk_(test|live)_[A-Za-z0-9]{16,}$/;
export const PUBLISHABLE_KEY_RE = /^pk_[A-Za-z0-9_]{16,}$/;
export const SecretKeySchema = z.string().regex(SECRET_KEY_RE);
export const PublishableKeySchema = z.string().regex(PUBLISHABLE_KEY_RE);

/** What a raw key string says about itself, or null when it is not a Dopl key. */
export function parseApiKey(raw: string): { kind: ApiKeyKind; env: Environment | null } | null {
  if (SECRET_KEY_RE.test(raw)) return { kind: "secret", env: raw.startsWith(API_KEY_PREFIX.secret_test) ? "test" : "live" };
  if (PUBLISHABLE_KEY_RE.test(raw)) return { kind: "publishable", env: null };
  return null;
}

/** A key as the portal / API lists it. The secret itself is returned once, at creation. */
export const ApiKeySchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    kind: ApiKeyKindSchema,
    env: EnvironmentSchema,
    /** The first characters of the key, e.g. `sk_live_4fQa`. */
    prefix: z.string().min(1),
    scopes: z.array(ApiKeyScopeSchema).min(1),
    created_at: z.iso.datetime(),
    last_used_at: z.iso.datetime().nullable(),
    revoked_at: z.iso.datetime().nullable(),
    /** Set on a key being rotated out: it keeps working until then. */
    expires_at: z.iso.datetime().nullable(),
  })
  .refine((k) => k.kind === "secret" || k.scopes.every((s) => s === "connect"), {
    message: "a publishable key may only carry the `connect` scope",
    path: ["scopes"],
  });
export type ApiKey = z.infer<typeof ApiKeySchema>;
