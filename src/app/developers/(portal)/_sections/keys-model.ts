/** The API keys page's rules: what a key's state is, what each view keeps, how keys are made. */
import { DEMO_NOW, minsAgo, type Env } from "../_data/company";
import type { ApiKeyRow } from "../_data/misc";

export type KeyKind = ApiKeyRow["kind"];
export type KeyView = "active" | "review" | "revoked";
export const KEY_VIEWS: { key: KeyView; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "review", label: "Needs review" },
  { key: "revoked", label: "Revoked" },
];

const DAY = 1440;
const UNUSED_DAYS = 30;
const IN_USE_MINS = DAY;

const minsSince = (iso: string) => (Date.parse(DEMO_NOW) - Date.parse(iso)) / 60_000;
export const days = (iso: string) => Math.floor(minsSince(iso) / DAY);

/** A fresh or just rotated key has not had the chance to be used, so its clock starts there. */
function quietDays(k: ApiKeyRow) {
  const last = k.lastUsedAt && Date.parse(k.lastUsedAt) > Date.parse(k.createdAt) ? k.lastUsedAt : k.createdAt;
  return days(last);
}

export const isUnused = (k: ApiKeyRow) => !k.revoked && quietDays(k) >= UNUSED_DAYS;
export const inUse = (k: ApiKeyRow) => !k.revoked && k.lastUsedAt !== null && minsSince(k.lastUsedAt) < IN_USE_MINS;

export function keepsKey(k: ApiKeyRow, view: KeyView, q: string) {
  const inView = view === "revoked" ? k.revoked : view === "review" ? isUnused(k) : !k.revoked;
  const needle = q.trim().toLowerCase();
  return inView && (!needle || [k.name, k.prefix, ...k.scopes].some((text) => text.toLowerCase().includes(needle)));
}

export function stateOf(k: ApiKeyRow): { label: string; tone: "ok" | "warn" | "plain" } {
  if (k.revoked) return { label: "Revoked", tone: "plain" };
  if (isUnused(k)) return { label: `Unused ${quietDays(k)}d`, tone: "warn" };
  if (inUse(k)) return { label: "In use", tone: "ok" };
  return { label: k.lastUsedAt && Date.parse(k.lastUsedAt) > Date.parse(k.createdAt) ? "Idle" : "Not used yet", tone: "plain" };
}

export function oldSecretLeft(k: ApiKeyRow): string | null {
  if (!k.oldSecretEndsAt) return null;
  return `Old secret ends in ${Math.round(-minsSince(k.oldSecretEndsAt) / 60)}h`;
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Demo only: a token that looks right and differs per key. Nothing here is ever a real secret. */
function tail(n: number, seed: number) {
  let x = 7919 * (seed + 1);
  return Array.from({ length: n }, () => {
    x = (x * 48271) % 2147483647;
    return ALPHABET[x % ALPHABET.length];
  }).join("");
}

const tokenOf = (kind: KeyKind, env: Env, seed: number) => `${kind === "secret" ? "sk" : "pk"}_${env}_${tail(24, seed)}`;
const prefixOf = (token: string) => token.slice(0, token.lastIndexOf("_") + 5);

export function newKey(input: { name: string; kind: KeyKind; env: Env; scopes: string[]; by: string; seed: number }): { row: ApiKeyRow; token: string } {
  const { name, kind, env, scopes, by, seed } = input;
  const token = tokenOf(kind, env, seed);
  const row: ApiKeyRow = {
    id: `key_${String(seed).padStart(2, "0")}`,
    name,
    kind,
    env,
    prefix: prefixOf(token),
    ...(kind === "publishable" && { token }),
    scopes: kind === "publishable" ? ["connect"] : scopes,
    createdAt: minsAgo(0),
    createdBy: by,
    lastUsedAt: null,
    calls7d: 0,
    revoked: false,
  };
  return { row, token };
}

export const GRACE = [
  { label: "Now", hours: 0 },
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
] as const;

export function rotated(k: ApiKeyRow, graceHours: number, seed: number): { row: ApiKeyRow; token: string } {
  const token = tokenOf(k.kind, k.env, seed);
  return { row: { ...k, prefix: prefixOf(token), createdAt: minsAgo(0), oldSecretEndsAt: graceHours > 0 ? minsAgo(-graceHours * 60) : undefined }, token };
}
