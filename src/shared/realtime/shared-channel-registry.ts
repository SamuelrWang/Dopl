"use client";

/**
 * Shared, ref-counted Supabase Realtime channels for workspace-table
 * subscriptions. Collapses per-instance fan-out (every subscription is
 * WAL-polling work on Postgres). Invariants:
 *   - One live channel per `(topicPrefix, workspaceId, tables)` key. ⚠ ALL
 *     `.on()` bindings BEFORE `.subscribe()` — Supabase v2 fixes the binding
 *     list at JOIN time and throws on a late `.on()`. Components share through
 *     a listener set.
 *   - ⚠ TOPIC NAMES ARE GENERATION-UNIQUE, never reused: `channel(topic)`
 *     returns the EXISTING object for a topic still known and `removeChannel()`
 *     is async, so reuse hands back the old subscribed channel, which throws on
 *     `.on()` or silently no-ops `.subscribe()`.
 *   - Every status callback is generation-guarded, so our own teardown CLOSED
 *     is not mistaken for a live-channel failure.
 *   - A listener attaching to an already-SUBSCRIBED channel fires once
 *     immediately — callers rely on that catch-up.
 *   - Ref-counted teardown with a grace period, so StrictMode remounts do not
 *     churn websocket joins.
 * RLS still applies: client connects under the user's auth.
 */

import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { getSpaBridge } from "@/shared/lib/spa-bridge";

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

/** Teardown delay: long enough to absorb StrictMode remounts and route
 *  transitions, short enough that leaving a page releases its subscriptions. */
const TEARDOWN_GRACE_MS = 1_000;

type Listener = () => void;
type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

interface Entry {
  key: string;
  workspaceId: string;
  tables: readonly string[];
  topicPrefix: string;
  listeners: Set<Listener>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  channel: any | null;
  /** Bumped on every connect attempt; stale callbacks compare and bail. */
  generation: number;
  /** True while the current-generation channel is live (last SUBSCRIBED). */
  subscribed: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  /** Died with no listeners (reconnects suppressed in the grace window) — a
   *  revive must reconnect. */
  broken: boolean;
  /** Torn down — a stale unsubscribe closure must not touch a revived key. */
  dead: boolean;
}

const entries = new Map<string, Entry>();

/** ⚠ MODULE-scoped, never per-entry: `teardown()` deletes the entry, so a
 *  per-entry counter resets and mints a byte-identical topic while realtime-js
 *  may still remember the old channel (leave pushes ack async) —
 *  `channel(topic)` returns the leaving corpse whose `subscribe()` silently
 *  no-ops, leaving the key dead until reload. */
let nextGeneration = 1;

/** One-shot guard for the missing-config warning below. */
let warnedNoConfig = false;

function entryKey(
  topicPrefix: string,
  workspaceId: string,
  tables: readonly string[]
): string {
  return `${topicPrefix}|${workspaceId}|${tables.join(",")}`;
}

function fire(entry: Entry): void {
  if (entry.dead) return;
  // Snapshot: a listener may unsubscribe (or subscribe a sibling) mid-iterate.
  for (const listener of [...entry.listeners]) {
    try {
      listener();
    } catch {
      // One listener throwing must not starve the others.
    }
  }
}

/** Drop our reference; release is async on the wire and generation guards make
 *  late status noise inert. */
function releaseChannel(entry: Entry): void {
  if (entry.channel) {
    try {
      getSupabaseBrowser().removeChannel(entry.channel);
    } catch {
      // Already torn down.
    }
    entry.channel = null;
  }
  entry.subscribed = false;
}

function clearReconnect(entry: Entry): void {
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
}

function scheduleReconnect(entry: Entry): void {
  if (entry.dead || entry.reconnectTimer) return;
  // No join for an entry in its teardown grace window — pure churn. Mark
  // broken; a revive inside the window reconnects.
  if (entry.listeners.size === 0) {
    entry.broken = true;
    return;
  }
  const delay =
    RECONNECT_DELAYS_MS[
      Math.min(entry.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ];
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null;
    // Listeners may have drained since this was armed.
    if (entry.listeners.size === 0) {
      entry.broken = true;
      return;
    }
    entry.reconnectAttempt += 1;
    connect(entry);
  }, delay);
}

function connect(entry: Entry): void {
  if (entry.dead) return;
  // ⚠ Bump generation BEFORE releasing the old channel: phoenix delivers the
  // leave-close SYNCHRONOUSLY when the channel can't push (errored state = the
  // reconnect path), so that CLOSED must already be stale on arrival.
  const myGen = ++entry.generation;
  releaseChannel(entry);
  entry.broken = false;

  let supabase: ReturnType<typeof getSupabaseBrowser>;
  try {
    supabase = getSupabaseBrowser();
  } catch (err) {
    // No browser Supabase config — degrade instead of unmounting the tree, but
    // a real web-build misconfig must not die silently: warn once.
    if (!warnedNoConfig) {
      warnedNoConfig = true;
      console.warn("[realtime] disabled — browser client unavailable:", err);
    }
    entry.broken = true;
    return;
  }
  // ⚠ Generation-unique topic (see header). Trailing table-count keeps two
  // same-prefix hooks with different table lists apart.
  const topic = `${entry.topicPrefix}-${entry.workspaceId}-t${entry.tables.length}-g${nextGeneration++}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chan = supabase.channel(topic) as any;

  // ⚠ CRITICAL ORDER: every binding attached before subscribe(); the binding set
  // never changes for the channel's lifetime.
  // ⚠ THE FILTER IS ALSO THE DELETE GATE: a DELETE's WAL record carries only the
  // table's REPLICA IDENTITY, so it matches solely while that carries
  // `workspace_id` (migration 20260807150000). Back to DEFAULT and hard deletes
  // vanish silently.
  for (const table of entry.tables) {
    chan = chan.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table,
        filter: `workspace_id=eq.${entry.workspaceId}`,
      },
      () => {
        if (myGen !== entry.generation) return; // stale channel
        fire(entry);
      }
    );
  }

  entry.channel = chan.subscribe((status: ChannelStatus) => {
    // Stale-generation noise (incl. our own cleanup's CLOSED) must not drive
    // the state machine.
    if (entry.dead || myGen !== entry.generation) return;
    if (status === "SUBSCRIBED") {
      entry.subscribed = true;
      entry.reconnectAttempt = 0;
      // realtime-js recovers on its own rejoin timer; a pending external retry
      // against a now-healthy channel would tear it down for nothing.
      clearReconnect(entry);
      // Catch-up refetch: events during the disconnect window were missed.
      fire(entry);
      return;
    }
    if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      entry.subscribed = false;
      scheduleReconnect(entry);
    }
  });
}

function teardown(entry: Entry): void {
  entry.dead = true;
  // ⚠ Invalidate the final channel's callbacks before releasing it.
  entry.generation += 1;
  if (entry.teardownTimer) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }
  clearReconnect(entry);
  releaseChannel(entry);
  entry.listeners.clear();
  entries.delete(entry.key);
}

/**
 * Subscribe `listener` to change events for `(topicPrefix, workspaceId,
 * tables)`. Returns an unsubscribe fn. Channel shared across subscribers of the
 * same key, torn down after a grace period when the last one leaves.
 *
 * ⚠ `tables` must be stable AND order-stable — it participates in the share key,
 * so callers only share when their lists match exactly.
 */
export function subscribeSharedWorkspaceTables(
  workspaceId: string,
  tables: readonly string[],
  topicPrefix: string,
  listener: Listener
): () => void {
  // Bundled desktop SPA: renderer has no network (CSP connect-src 'none') —
  // main watches postgres_changes and pushes coalesced {workspaceId, table}
  // events over the bridge, with the same listener semantics as web channels.
  // ⚠ Capability-keyed, NOT a truthiness check on window.dopl: the legacy
  // wrapper's partial window.dopl must keep the WEB realtime path (a truthiness
  // check here silently killed realtime for every wrapper user).
  const spaBridge = getSpaBridge();
  if (spaBridge) {
    if (
      typeof spaBridge.onSyncEvent !== "function" ||
      typeof spaBridge.syncWatch !== "function"
    ) {
      return () => {};
    }
    return subscribeViaBridge(spaBridge as SpaSyncBridge, workspaceId, tables, listener);
  }
  const key = entryKey(topicPrefix, workspaceId, tables);
  let entry = entries.get(key);

  if (!entry) {
    entry = {
      key,
      workspaceId,
      tables,
      topicPrefix,
      listeners: new Set(),
      channel: null,
      generation: 0,
      subscribed: false,
      reconnectTimer: null,
      reconnectAttempt: 0,
      teardownTimer: null,
      broken: false,
      dead: false,
    };
    entries.set(key, entry);
    entry.listeners.add(listener);
    connect(entry);
  } else {
    if (entry.teardownTimer) {
      // Revived within the grace window — cancel the pending teardown.
      clearTimeout(entry.teardownTimer);
      entry.teardownTimer = null;
    }
    entry.listeners.add(listener);
    // Revive only if broken. A still-joining channel (subscribed=false, not
    // broken) is left alone — StrictMode remounts must not churn healthy joins.
    if (entry.broken) connect(entry);
  }

  // Late joiner on a live channel gets the catch-up refetch a fresh SUBSCRIBED
  // would have delivered.
  if (entry.subscribed) listener();

  const owned = entry;
  let released = false;
  return () => {
    // Idempotent: React cleanup can run more than once.
    if (released || owned.dead) return;
    released = true;
    owned.listeners.delete(listener);
    if (owned.listeners.size === 0 && owned.reconnectTimer) {
      // In-flight retry must not join for an entry entering its grace window.
      clearReconnect(owned);
      owned.broken = true;
    }
    if (owned.listeners.size === 0 && !owned.teardownTimer) {
      owned.teardownTimer = setTimeout(() => {
        owned.teardownTimer = null;
        // A subscriber may have arrived during the grace window.
        if (owned.listeners.size === 0) teardown(owned);
      }, TEARDOWN_GRACE_MS);
    }
  };
}

// ─── SPA bridge feed ─────────────────────────────────────────────────────

interface SpaSyncBridge {
  syncWatch?: (workspaceId: string | null) => Promise<unknown>;
  onSyncEvent?: (
    cb: (e: { workspaceId: string; table: string }) => void
  ) => () => void;
}

interface BridgeSub {
  workspaceId: string;
  tables: ReadonlySet<string>;
  listener: Listener;
}

const bridgeSubs = new Set<BridgeSub>();
let bridgeOff: (() => void) | null = null;
let watchedWorkspace: string | null = null;
/** Most recent syncWatch ISSUED (set synchronously); `watchedWorkspace` only
 *  advances when the IPC resolves. Dedupe reads issued; retry reads committed. */
let issuedWorkspace: string | null | undefined = undefined;
let watchNullTimer: ReturnType<typeof setTimeout> | null = null;

/** Workspace main should watch: the one MOST hooks subscribe for, most-recent
 *  winning ties — a workspace switch wins immediately, a single straggler with
 *  a stale id cannot steal the watch from a mounted page. */
function wantedWorkspace(): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const sub of bridgeSubs) {
    const n = (counts.get(sub.workspaceId) ?? 0) + 1;
    counts.set(sub.workspaceId, n);
    // >= : later insertion wins ties (Set preserves insertion order).
    if (best === null || n >= (counts.get(best) ?? 0)) best = sub.workspaceId;
  }
  return best;
}

function issueWatch(bridge: SpaSyncBridge, want: string | null): void {
  issuedWorkspace = want;
  // ⚠ Commit only on SUCCESS: a rejected IPC or a resolved `{ ok: false }` from
  // an older main must not leave the renderer believing it is watching.
  // Clearing the issued marker makes the next updateWatch retry.
  void Promise.resolve(bridge.syncWatch?.(want))
    .then((out) => {
      const ok = !(out && typeof out === "object" && (out as { ok?: boolean }).ok === false);
      if (ok) {
        watchedWorkspace = want;
      } else if (issuedWorkspace === want) {
        issuedWorkspace = watchedWorkspace;
      }
    })
    .catch(() => {
      if (issuedWorkspace === want) issuedWorkspace = watchedWorkspace;
    });
}

function updateWatch(bridge: SpaSyncBridge): void {
  const want = wantedWorkspace();
  if (watchNullTimer) {
    clearTimeout(watchNullTimer);
    watchNullTimer = null;
  }
  const current = issuedWorkspace === undefined ? watchedWorkspace : issuedWorkspace;
  if (want === current) return;
  if (want === null) {
    // ⚠ React flushes all cleanups before all creates in a commit, so every
    // navigation momentarily empties the sub set. Defer the unwatch behind the
    // same grace the web path uses, else a route change costs leave + rejoin +
    // catch-up burst.
    watchNullTimer = setTimeout(() => {
      watchNullTimer = null;
      if (wantedWorkspace() === null) issueWatch(bridge, null);
    }, TEARDOWN_GRACE_MS);
    return;
  }
  issueWatch(bridge, want);
}

function subscribeViaBridge(
  bridge: SpaSyncBridge,
  workspaceId: string,
  tables: readonly string[],
  listener: Listener
): () => void {
  const sub: BridgeSub = {
    workspaceId,
    tables: new Set(tables),
    listener,
  };
  bridgeSubs.add(sub);
  if (!bridgeOff) {
    bridgeOff =
      bridge.onSyncEvent?.((e) => {
        for (const s of [...bridgeSubs]) {
          if (s.workspaceId !== e.workspaceId) continue;
          // Empty table = main's catch-up signal after (re)subscribe: fire
          // everyone, mirroring the web SUBSCRIBED catch-up.
          if (e.table && !s.tables.has(e.table)) continue;
          try {
            s.listener();
          } catch {
            // One listener throwing must not starve the others.
          }
        }
      }) ?? null;
  }
  updateWatch(bridge);
  // Catch-up: web path fires on SUBSCRIBED, bridge path fires once on subscribe.
  try {
    listener();
  } catch {
    /* listener errors are the caller's problem */
  }
  return () => {
    bridgeSubs.delete(sub);
    updateWatch(bridge);
    if (bridgeSubs.size === 0 && bridgeOff) {
      bridgeOff();
      bridgeOff = null;
    }
  };
}

/** Test-only: reset all shared state (tears down every live channel). */
export function __resetSharedChannelsForTests(): void {
  for (const entry of [...entries.values()]) teardown(entry);
  bridgeSubs.clear();
  if (bridgeOff) {
    bridgeOff();
    bridgeOff = null;
  }
  if (watchNullTimer) {
    clearTimeout(watchNullTimer);
    watchNullTimer = null;
  }
  watchedWorkspace = null;
  issuedWorkspace = undefined;
}

/** Test-only: current entry count (live channels, including grace-window). */
export function __sharedChannelCountForTests(): number {
  return entries.size;
}
