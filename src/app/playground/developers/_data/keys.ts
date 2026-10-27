/** API key rotation with a grace window (Stripe's pattern). Pure; `keys.test.ts` pins it. */
import type { ApiKey } from "@dopl/contracts/device-sdk";
import { DEMO_NOW } from "./fixtures";

export const ROTATE_GRACE_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The rotated key gets a successor with the same kind, env and scopes; it keeps working until `expires_at`. */
export function rotateKey(
  keys: readonly ApiKey[],
  id: string,
  secret: string,
  newId: string,
  now: string = DEMO_NOW,
  graceHours: number = ROTATE_GRACE_HOURS
): ApiKey[] {
  const old = keys.find((k) => k.id === id);
  if (!old || old.revoked_at) return [...keys];
  const expires_at = new Date(Date.parse(now) + graceHours * 60 * 60 * 1000).toISOString();
  const successor: ApiKey = {
    ...old,
    id: newId,
    prefix: secret.slice(0, old.prefix.length),
    created_at: now,
    last_used_at: null,
    expires_at: null,
  };
  return [successor, ...keys.map((k) => (k.id === id ? { ...k, expires_at } : k))];
}

/** Active, and not used in the last 30 days. */
export function isStale(k: ApiKey, now: string = DEMO_NOW): boolean {
  if (k.revoked_at) return false;
  const used = Date.parse(k.last_used_at ?? k.created_at);
  return Date.parse(now) - used > 30 * DAY_MS;
}
