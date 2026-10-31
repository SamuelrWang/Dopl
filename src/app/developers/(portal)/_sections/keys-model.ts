/** The API keys page's rules: what a key's state is and what each view keeps. */
import type { KeyView as Key } from "@/features/device-sdk/portal/view";
import type { Tone } from "../_design/ui";
import { portalNow } from "../_components/format";

export type KeyKind = Key["kind"];
export type KeyTab = "active" | "review" | "revoked";
export const KEY_VIEWS: { key: KeyTab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "review", label: "Needs review" },
  { key: "revoked", label: "Revoked" },
];

const DAY = 1440;
const UNUSED_DAYS = 30;
const minsSince = (iso: string) => (portalNow() - Date.parse(iso)) / 60_000;
const days = (iso: string) => Math.floor(minsSince(iso) / DAY);

/** A fresh key has not had the chance to be used, so its clock starts there. */
function quietDays(k: Key) {
  const last = k.lastUsedAt && Date.parse(k.lastUsedAt) > Date.parse(k.createdAt) ? k.lastUsedAt : k.createdAt;
  return days(last);
}

const isExpired = (k: Key) => k.expiresAt !== null && Date.parse(k.expiresAt) <= portalNow();
export const isDead = (k: Key) => k.revokedAt !== null || isExpired(k);
const isUnused = (k: Key) => !isDead(k) && quietDays(k) >= UNUSED_DAYS;
export const inUse = (k: Key) => !isDead(k) && k.lastUsedAt !== null && minsSince(k.lastUsedAt) < DAY;

export function keepsKey(k: Key, view: KeyTab, q: string) {
  const inView = view === "revoked" ? isDead(k) : view === "review" ? isUnused(k) : !isDead(k);
  const needle = q.trim().toLowerCase();
  return inView && (!needle || [k.name, k.prefix, ...k.scopes].some((text) => text.toLowerCase().includes(needle)));
}

export function stateOf(k: Key): { label: string; tone: Tone } {
  if (k.revokedAt) return { label: "Revoked", tone: "neutral" };
  if (isExpired(k)) return { label: "Expired", tone: "neutral" };
  if (isUnused(k)) return { label: `Unused ${quietDays(k)}d`, tone: "warn" };
  if (inUse(k)) return { label: "In use", tone: "ok" };
  return { label: k.lastUsedAt && Date.parse(k.lastUsedAt) > Date.parse(k.createdAt) ? "Idle" : "Not used yet", tone: "neutral" };
}

/** A rotated-out key still works until this. */
export function oldSecretLeft(k: Key): string | null {
  if (!k.expiresAt || isDead(k)) return null;
  const hours = Math.max(1, Math.round(-minsSince(k.expiresAt) / 60));
  return `Ends in ${hours}h`;
}

export const GRACE = [
  { label: "Now", hours: 0 },
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
] as const;
