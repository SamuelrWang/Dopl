/**
 * **UNSENT MESSAGE DRAFTS, KEPT ACROSS NAVIGATION, RELOAD AND RESTART** (Samuel, 2026-10-08).
 *
 * ONE store for every composer (the channel box, the direct agent box, the new-thread form), so a
 * draft behaves the same wherever it was typed. Keyed by WHO is typing, WHERE (workspace) and WHAT
 * it is for (the target), so two accounts or two targets never see each other's text.
 *
 * - DISK is the one persisted-UI-state store (`persisted-ui-state.ts`): scoped key, versioned
 *   envelope, throw / malformed ⇒ nothing, `requireUser` so no signed-out draft is ever kept.
 * - Above it, what only drafts need: a MEMORY copy every mounted composer on a key shares
 *   (`subscribeDraft`), writes DEBOUNCED and flushed when the page hides, a TTL and a cap, and the
 *   text HELD while a send is in flight.
 * - A send CLEARS the visible draft immediately but keeps the text until the server answers
 *   ({@link stashPendingSend}); a failed send puts it back ({@link settlePendingSend}).
 * - A draft for a target that no longer exists is never shown (nothing mounts for it); deleting or
 *   leaving a channel drops its drafts at once ({@link clearDraftsForTarget}), and the TTL / cap
 *   sweep anything else.
 */
import { definePersistedState, isStoredId } from "./persisted-ui-state";

export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DRAFT_CAP = 100;
export const DRAFT_DEBOUNCE_MS = 300;

/** What a composer keeps: its text, plus any composer-held state (addressees, a title). */
export interface DraftValue {
  text: string;
  extra?: Readonly<Record<string, unknown>>;
}

interface Stored extends DraftValue {
  at: number;
}

export interface DraftScope {
  /** The signed-in member. No user, no persistence: a draft must never outlive its author. */
  userId: string | null | undefined;
  /** The workspace; omitted where the target id is already globally unique (a channel UUID). */
  workspaceId?: string | null;
}

function isEmpty(value: DraftValue | null | undefined): boolean {
  if (!value) return true;
  return value.text.trim() === "" && (!value.extra || Object.keys(value.extra).length === 0);
}

const disk = definePersistedState<Stored | null>({
  name: "draft",
  version: 1,
  fallback: null,
  requireUser: true,
  isEmpty: (v) => isEmpty(v),
  decode: (raw, fromVersion) => {
    if (fromVersion !== 1 || raw === null || typeof raw !== "object") return null;
    const r = raw as Partial<Stored>;
    if (typeof r.text !== "string" || typeof r.at !== "number") return null;
    const extra =
      r.extra && typeof r.extra === "object" && !Array.isArray(r.extra) ? r.extra : undefined;
    return extra ? { text: r.text, extra, at: r.at } : { text: r.text, at: r.at };
  },
});

type OwnedScope = { userId: string; workspaceId: string | null; key: string };
/** Owned keys → the scope that writes them (the helper writes by scope, lists and reads by key). */
const scopes = new Map<string, OwnedScope>();
const memory = new Map<string, DraftValue | null>();
const listeners = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, { key: string; value: DraftValue }>();
let now: () => number = () => Date.now();

/** The storage key, or `null` when there is no signed-in user to own it. */
export function draftKey(scope: DraftScope, target: string): string | null {
  if (!isStoredId(scope.userId) || !target) return null;
  const owned: OwnedScope = {
    userId: scope.userId,
    workspaceId: scope.workspaceId ?? null,
    key: target,
  };
  const key = disk.storageKey(owned);
  scopes.set(key, owned);
  return key;
}

function readStored(key: string): DraftValue | null {
  const stored = disk.readKey(key);
  if (!stored) return null;
  if (now() - stored.at > DRAFT_TTL_MS) {
    disk.removeKey(key);
    return null;
  }
  return stored.extra ? { text: stored.text, extra: stored.extra } : { text: stored.text };
}

/** Drops this user's expired drafts, then the oldest past the cap. */
function prune(userId: string): void {
  const entries = disk.keys({ userId }).map((key) => ({ key, at: disk.readKey(key)?.at ?? 0 }));
  const live = entries.filter((e) => now() - e.at <= DRAFT_TTL_MS);
  for (const e of entries) if (!live.includes(e)) disk.removeKey(e.key);
  if (live.length > DRAFT_CAP) {
    live.sort((a, b) => a.at - b.at);
    for (const e of live.slice(0, live.length - DRAFT_CAP)) {
      disk.removeKey(e.key);
      memory.delete(e.key);
    }
  }
}

function persist(key: string): void {
  timers.delete(key);
  const scope = scopes.get(key);
  // Only owned keys reach disk; an ephemeral (no-user) key lives in memory for its mount.
  if (!scope) return;
  const value = memory.get(key) ?? null;
  disk.write(scope, isEmpty(value) ? null : { ...(value as DraftValue), at: now() });
  prune(scope.userId);
}

function schedule(key: string): void {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.set(key, setTimeout(() => persist(key), DRAFT_DEBOUNCE_MS));
}

function notify(key: string): void {
  for (const fn of listeners.get(key) ?? []) fn();
}

/** Writes every debounced draft now. Called when the page hides, so a quit loses nothing. */
export function flushDrafts(): void {
  for (const [key, t] of [...timers]) {
    clearTimeout(t);
    persist(key);
  }
}

let wired = false;
function wireLifecycle(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("pagehide", flushDrafts);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDrafts();
  });
  // Another window of the same app wrote a draft we hold: drop the cached copy and re-read.
  window.addEventListener("storage", (e) => {
    if (!e.key || !memory.has(e.key) || timers.has(e.key)) return;
    memory.delete(e.key);
    notify(e.key);
  });
}

/** The draft for `key` (memory, else disk); `null` when there is none. */
export function readDraft(key: string | null): DraftValue | null {
  if (!key) return null;
  wireLifecycle();
  if (!memory.has(key)) memory.set(key, scopes.has(key) ? readStored(key) : null);
  return memory.get(key) ?? null;
}

/** Replaces the draft; an empty one is removed. Disk follows after the debounce. */
export function writeDraft(key: string | null, value: DraftValue | null): void {
  if (!key) return;
  wireLifecycle();
  memory.set(key, isEmpty(value) ? null : value);
  notify(key);
  schedule(key);
}

/** Removes the draft now, disk included. */
export function clearDraft(key: string | null): void {
  if (!key) return;
  const t = timers.get(key);
  if (t) clearTimeout(t);
  memory.set(key, null);
  notify(key);
  persist(key);
}

/** Drops every draft of `userId` whose target names `targetId` (a deleted or left channel). */
export function clearDraftsForTarget(userId: string | null | undefined, targetId: string): void {
  if (!isStoredId(userId) || !targetId) return;
  for (const key of new Set([...disk.keys({ userId }), ...scopes.keys()])) {
    const scope = scopes.get(key);
    if (scope && scope.userId !== userId) continue;
    const target = scope ? scope.key : key.split(":").slice(3).join(":");
    if (!target.includes(targetId)) continue;
    if (scope) clearDraft(key);
    else disk.removeKey(key);
  }
}

/** Subscribes to one key's changes (for `useSyncExternalStore`). */
export function subscribeDraft(key: string | null, fn: () => void): () => void {
  if (!key) return () => {};
  const set = listeners.get(key) ?? new Set();
  set.add(fn);
  listeners.set(key, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * A send is leaving: empty the visible draft now, but hold its value under `sendId` until the
 * server answers. Disk keeps the exact text sent until then, so a crash mid-send loses nothing.
 */
export function stashPendingSend(key: string | null, sendId: string, value: DraftValue): void {
  if (!key) return;
  pending.set(sendId, { key, value });
  const t = timers.get(key);
  if (t) clearTimeout(t);
  memory.set(key, value);
  persist(key);
  memory.set(key, null);
  notify(key);
}

/**
 * The server answered. Success drops the held text for good; failure puts it back — before
 * anything typed since, so neither is lost.
 */
export function settlePendingSend(sendId: string, ok: boolean): void {
  const held = pending.get(sendId);
  if (!held) return;
  pending.delete(sendId);
  if (ok) {
    if (isEmpty(readDraft(held.key))) clearDraft(held.key);
    return;
  }
  const current = readDraft(held.key);
  const text =
    current && current.text.trim() !== "" ? `${held.value.text}\n\n${current.text}` : held.value.text;
  writeDraft(held.key, { ...held.value, ...current, text });
  flushDrafts();
}

/** Test seam: reset module state and pin the clock. */
export function __resetDraftStoreForTests(clock?: () => number): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  memory.clear();
  listeners.clear();
  pending.clear();
  scopes.clear();
  now = clock ?? (() => Date.now());
}
