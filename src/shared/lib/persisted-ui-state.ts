/**
 * THE ONE STORE FOR "WHERE WAS I" UI STATE — per device, per user, per workspace.
 *
 * Every surface that remembers a selection across a page change, a reload or an
 * app restart (the ontology board, /home's face, composer drafts …) goes through
 * here instead of minting its own `localStorage` key. One place owns the rules:
 *
 * - SCOPED: key `dopl.<name>:<user>:<workspace>[:<key>]`. Per user because one
 *   machine holds more than one account; per workspace because an id from
 *   another one names nothing. `workspaceId: null` = account-wide (/home).
 * - VERSIONED: stored as `{ v, d }`. `decode(raw, fromVersion)` turns whatever is
 *   on disk into today's shape; a value written before this envelope existed
 *   arrives as `fromVersion: 0` with the raw string, so callers can migrate.
 * - NEVER AN ERROR: storage that throws (private window, blocked site data, no
 *   `window` in SSR), malformed JSON, or a value `decode` rejects all read as
 *   `fallback`. Failing to remember is not an error state.
 * - BOUNDED: a value over `MAX_VALUE_BYTES` is not written; `boundRecord` caps a
 *   map the caller keeps inside its value.
 * - STALE TARGETS ARE THE CALLER'S TO SWEEP: only the caller knows which ids
 *   still resolve, so it calls `update` to drop one once its data is READY
 *   (never on an empty loading list, which would wipe good memory).
 *
 * A convenience, never a permission: what is stored is replayed through data the
 * server already sent, so a remembered id the reader can no longer see simply
 * does not resolve.
 */

export interface PersistedScope {
  /** Whose memory. Undefined ⇒ an `anon` bucket, never another user's. */
  userId: string | undefined;
  /** Which workspace; null for account-wide state (/home has no workspace). */
  workspaceId: string | null;
  /** Optional sub-scope, e.g. a channel or thread id. */
  key?: string;
}

export interface PersistedStateSpec<T> {
  /** Stable name, part of the storage key (`dopl.<name>:…`). Never rename casually. */
  name: string;
  /** Bump when the stored shape changes; `decode` gets the old version to migrate. */
  version: number;
  /** What a missing, unreadable or rejected value reads as. */
  fallback: T;
  /**
   * Today's shape from what is on disk, or null to reject it (⇒ `fallback`).
   * `fromVersion` is the envelope's `v`, or 0 for a pre-envelope value, in which
   * case `raw` is the stored string itself (parsed JSON when it parses).
   */
  decode: (raw: unknown, fromVersion: number) => T | null;
  /** True when `value` is "nothing to remember" — the key is removed, not written. */
  isEmpty?: (value: T) => boolean;
  /**
   * Never touch storage without a signed-in user: reads are `fallback`, writes
   * are dropped. For state that must not outlive the session it was typed in
   * (drafts); a caller wanting in-memory behaviour layers it above.
   */
  requireUser?: boolean;
}

export interface PersistedState<T> {
  read(scope: PersistedScope): T;
  write(scope: PersistedScope, value: T): void;
  /** Read-modify-write. Return the same object to skip the write. */
  update(scope: PersistedScope, change: (value: T) => T): void;
  clear(scope: PersistedScope): void;
  /**
   * Every stored key of this name for one user (optionally one workspace), for
   * TTL / count caps / dropping keys whose target is gone. Order is storage
   * order, not recency: keep a timestamp in the value if recency matters.
   */
  keys(owner: { userId: string | undefined; workspaceId?: string | null }): string[];
  /** Read / remove by a key `keys` returned. */
  readKey(storageKey: string): T;
  removeKey(storageKey: string): void;
  /** The storage key, for tests and for migrating a key by hand. */
  storageKey(scope: PersistedScope): string;
}

/** Per value. A UI selection is ids; anything near this is a bug, not a memory. */
export const MAX_VALUE_BYTES = 32 * 1024;

const PREFIX = "dopl.";
const KEY_PART = /[:\s]/g;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function definePersistedState<T>(spec: PersistedStateSpec<T>): PersistedState<T> {
  const storageKey = ({ userId, workspaceId, key }: PersistedScope): string => {
    const part = (s: string) => s.replace(KEY_PART, "_");
    const base = `${PREFIX}${spec.name}:${part(userId || "anon")}:${part(workspaceId ?? "-")}`;
    return key ? `${base}:${part(key)}` : base;
  };

  const decodeStored = (raw: string | null): T => {
    if (raw === null || raw === "") return spec.fallback;
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // a pre-envelope bare string; `decode` decides at version 0
    }
    const envelope =
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { v?: unknown }).v === "number" &&
      "d" in (parsed as object)
        ? (parsed as { v: number; d: unknown })
        : null;
    // A value from a NEWER build than this one: its shape is unknown here.
    if (envelope && envelope.v > spec.version) return spec.fallback;
    try {
      const value = envelope ? spec.decode(envelope.d, envelope.v) : spec.decode(parsed, 0);
      return value ?? spec.fallback;
    } catch {
      return spec.fallback;
    }
  };

  const blocked = (userId: string | undefined) => Boolean(spec.requireUser && !userId);

  const readKey = (key: string): T => {
    const store = storage();
    if (!store) return spec.fallback;
    try {
      return decodeStored(store.getItem(key));
    } catch {
      return spec.fallback;
    }
  };

  const read = (scope: PersistedScope): T =>
    blocked(scope.userId) ? spec.fallback : readKey(storageKey(scope));

  const write = (scope: PersistedScope, value: T): void => {
    const store = storage();
    if (!store || blocked(scope.userId)) return;
    try {
      const key = storageKey(scope);
      if (spec.isEmpty?.(value)) {
        store.removeItem(key);
        return;
      }
      const raw = JSON.stringify({ v: spec.version, d: value });
      if (raw.length > MAX_VALUE_BYTES) return;
      store.setItem(key, raw);
    } catch {
      // quota, blocked, or unserialisable: remembering is a convenience
    }
  };

  return {
    read,
    write,
    update(scope, change) {
      const before = read(scope);
      let after: T;
      try {
        after = change(before);
      } catch {
        return;
      }
      if (after !== before) write(scope, after);
    },
    clear(scope) {
      try {
        storage()?.removeItem(storageKey(scope));
      } catch {
        // already unreachable
      }
    },
    storageKey,
    readKey,
    removeKey(key) {
      try {
        storage()?.removeItem(key);
      } catch {
        // already unreachable
      }
    },
    keys({ userId, workspaceId }) {
      const store = storage();
      if (!store || blocked(userId)) return [];
      // One workspace: its base key and every sub-key under it. None given:
      // every workspace of this user.
      const userPrefix = storageKey({ userId, workspaceId: null }).slice(0, -1);
      const base = workspaceId === undefined ? null : storageKey({ userId, workspaceId });
      const out: string[] = [];
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (!k) continue;
          if (base === null ? k.startsWith(userPrefix) : k === base || k.startsWith(`${base}:`)) {
            out.push(k);
          }
        }
      } catch {
        return [];
      }
      return out;
    },
  };
}

/**
 * Cap a record kept inside a value to its `max` most recent entries, by
 * insertion order. Re-insert a key (delete, then set) to mark it recent.
 */
export function boundRecord<V>(record: Readonly<Record<string, V>>, max: number): Record<string, V> {
  const entries = Object.entries(record);
  return entries.length <= max ? { ...record } : Object.fromEntries(entries.slice(entries.length - max));
}

/** `record` without `key`, as a new object. */
export function omitKey<V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/** A non-empty string, the shape of every id a UI selection stores. */
export const isStoredId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
