"use client";

/**
 * Shared, ref-counted Supabase Realtime channels for workspace-table
 * subscriptions.
 *
 * WHY THIS EXISTS (Phase 0, docs/DESKTOP-MIGRATION-PLAN.md): the previous
 * design gave every mounted `useWorkspaceTablesRealtime` instance its own
 * channel (topic included React's useId), because Supabase v2 rejects
 * `.on("postgres_changes", …)` bindings added after `.subscribe()` — the
 * server fixes the binding list at JOIN time, and a second subscriber
 * attaching to an already-subscribed topic threw and took down the page.
 * Per-instance topics dodged that crash but multiplied server-side
 * subscriptions: every subscription is WAL-polling work on Postgres, and
 * the fan-out grew to ~96 live subscriptions eating >80% of DB exec time.
 *
 * This registry keeps the crash-safety AND collapses the fan-out:
 *   - One live channel per `(topicPrefix, workspaceId, tables)` key.
 *     All `.on()` bindings are attached BEFORE `.subscribe()`; components
 *     share through a listener set, never through late `.on()` calls.
 *   - TOPIC NAMES ARE GENERATION-UNIQUE. `RealtimeClient.channel(topic)`
 *     returns the EXISTING channel object for a topic it still knows, and
 *     `removeChannel()` is async (the channel is only forgotten after the
 *     leave push settles) — so reusing one topic string across reconnects
 *     would hand back the old, already-subscribed channel and either throw
 *     on `.on()` or silently no-op `.subscribe()`. Sharing is provided by
 *     the registry entry; topic identity is deliberately never reused.
 *   - Every status callback is generation-guarded: tearing down an old
 *     channel fires its CLOSED into a callback that no longer matches the
 *     entry's current generation and is ignored — our own cleanup can
 *     never be mistaken for a live-channel failure.
 *   - A listener that attaches to an already-SUBSCRIBED channel is fired
 *     once immediately — the old per-instance design gave every mount a
 *     SUBSCRIBED→refetch, and callers rely on that catch-up semantics.
 *   - Ref-counted teardown with a short grace period so StrictMode's
 *     mount→unmount→mount doesn't churn real websocket joins.
 *
 * RLS still applies: the client connects under the user's auth, so the
 * server filters events to rows the user can read.
 */

import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { getSpaBridge } from "@/shared/lib/spa-bridge";

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

/** Delay before an unused channel is actually torn down. Long enough to
 *  absorb StrictMode remounts and route transitions that remount the same
 *  page component; short enough that leaving a page really does release
 *  its subscriptions. */
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
  /** Channel died while the entry had no listeners (reconnects are
   *  suppressed in the teardown grace window) — a revive must reconnect. */
  broken: boolean;
  /** Torn down — a stale unsubscribe closure must not touch a revived key. */
  dead: boolean;
}

const entries = new Map<string, Entry>();

/** MODULE-scoped generation counter. Never per-entry: `teardown()` deletes
 *  the entry, so a per-entry counter would reset and mint a byte-identical
 *  topic while realtime-js may still remember the old channel (leave pushes
 *  ack asynchronously) — `channel(topic)` would return the leaving corpse,
 *  whose `subscribe()` silently no-ops, leaving the key dead until reload. */
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
  // Snapshot: a listener may unsubscribe (or subscribe a sibling) while we
  // iterate.
  for (const listener of [...entry.listeners]) {
    try {
      listener();
    } catch {
      // One listener throwing must not starve the others.
    }
  }
}

/** Release the current channel object (async on the wire; we only drop our
 *  reference — generation guards make any late status noise inert). */
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
  // No join for an entry in the teardown grace window (no listeners) —
  // it is about to be discarded, so a websocket join would be pure churn.
  // Mark it broken instead; a revive inside the window reconnects.
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
    // Listeners may have drained since this was armed (the unsubscribe
    // closure also cancels, but belt-and-suspenders: a join for an entry
    // in its teardown grace window is pure churn).
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
  // Bump the generation BEFORE releasing the old channel: phoenix delivers
  // the leave-close SYNCHRONOUSLY when the channel can't push (errored
  // state — i.e. exactly the reconnect path), and that CLOSED must already
  // be stale by the time it reaches the status callback.
  const myGen = ++entry.generation;
  releaseChannel(entry);
  entry.broken = false;

  let supabase: ReturnType<typeof getSupabaseBrowser>;
  try {
    supabase = getSupabaseBrowser();
  } catch (err) {
    // No browser Supabase config in this runtime (SPA renderers return
    // earlier via the window.dopl no-op; this guards test/exotic
    // runtimes) — realtime degrades instead of unmounting the tree. A real
    // web-build misconfig must not die SILENTLY though: warn once.
    if (!warnedNoConfig) {
      warnedNoConfig = true;
      console.warn("[realtime] disabled — browser client unavailable:", err);
    }
    entry.broken = true;
    return;
  }
  // Topic is generation-unique — see the header comment: reusing a topic
  // string while realtime-js still remembers it returns the OLD channel
  // object, which must never happen. The trailing table-count keeps two
  // same-prefix hooks with different table lists apart as well.
  const topic = `${entry.topicPrefix}-${entry.workspaceId}-t${entry.tables.length}-g${nextGeneration++}`;
  // Loosely typed at runtime — same cast the previous implementation used.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chan = supabase.channel(topic) as any;

  // CRITICAL ORDER: every binding is attached before subscribe(). The binding set
  // never changes for the channel's lifetime — components share via `listeners`.
  // THE FILTER IS THE DELETE GATE TOO: a DELETE's WAL record carries only the table's
  // REPLICA IDENTITY, so it matches one solely while that carries `workspace_id`
  // (migration 20260807150000). Back to DEFAULT and hard deletes vanish, silently.
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
    // Stale-generation noise (including the CLOSED our own cleanup emits
    // when releasing a previous channel) must not drive the state machine.
    if (entry.dead || myGen !== entry.generation) return;
    if (status === "SUBSCRIBED") {
      entry.subscribed = true;
      entry.reconnectAttempt = 0;
      // realtime-js also recovers on its own internal rejoin timer — a
      // pending external retry against a now-healthy channel would tear
      // it down for nothing.
      clearReconnect(entry);
      // Catch-up refetch for every listener: events during a disconnect
      // window (or before first join) were missed.
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
  // Invalidate all callbacks of the final channel before releasing it.
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
 * tables)`. Returns an unsubscribe function. The underlying channel is
 * shared across all subscribers of the same key and torn down (after a
 * short grace period) when the last one leaves.
 *
 * `tables` must be a stable, order-stable list — it participates in the
 * share key, so two callers only share when their lists match exactly.
 */
export function subscribeSharedWorkspaceTables(
  workspaceId: string,
  tables: readonly string[],
  topicPrefix: string,
  listener: Listener
): () => void {
  // Bundled desktop SPA (window.dopl present): the renderer has no network
  // (CSP connect-src 'none') — main watches postgres_changes for the viewed
  // workspace and pushes coalesced {workspaceId, table} events over the
  // bridge (Phase 3). Those events feed the SAME listener semantics the web
  // channels provide, so every feature realtime hook works unchanged. An
  // older main without the sync surface degrades to the previous no-op.
  // Capability-keyed (spa-bridge.ts): the legacy wrapper's partial
  // window.dopl must keep the WEB realtime path — a truthiness check here
  // silently killed realtime for every wrapper user.
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
    // If the channel died while the entry had no listeners (reconnects are
    // suppressed during the grace window), revive the connection now. A
    // merely still-joining channel (subscribed=false, not broken) is left
    // alone — StrictMode remounts must not churn healthy joins.
    if (entry.broken) connect(entry);
  }

  // Late joiner on a live channel: give it the same catch-up refetch a
  // fresh SUBSCRIBED would have delivered.
  if (entry.subscribed) listener();

  const owned = entry;
  let released = false;
  return () => {
    // Idempotent: React cleanup can run more than once.
    if (released || owned.dead) return;
    released = true;
    owned.listeners.delete(listener);
    if (owned.listeners.size === 0 && owned.reconnectTimer) {
      // An in-flight retry must not join a websocket for an entry that
      // just entered its teardown grace window.
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

// ─── SPA bridge feed (Phase 3) ───────────────────────────────────────────

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
/** The value of the most recent syncWatch we ISSUED (set synchronously);
 *  `watchedWorkspace` only advances when the IPC resolves. Dedupe reads
 *  the issued value; retry semantics read the committed one. */
let issuedWorkspace: string | null | undefined = undefined;
let watchNullTimer: ReturnType<typeof setTimeout> | null = null;

/** Which workspace should main watch? The one MOST hooks subscribe for,
 *  most-recent winning ties — so a workspace switch (many new-workspace
 *  mounts) wins immediately, while a single straggler re-subscribing with
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
  // Commit only on SUCCESS: a refused IPC (reject) or a refused payload
  // (a resolved { ok: false } from an older main) must not leave the
  // renderer believing it is watching — clearing the issued marker makes
  // the next updateWatch retry.
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
    // React flushes all cleanups before all creates within a commit, so
    // every navigation momentarily empties the sub set. Deferring the
    // unwatch behind the same grace the web path uses keeps a route change
    // from costing a leave + rejoin + catch-up burst.
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
          // Empty table = main's catch-up signal after (re)subscribe —
          // fire everyone, mirroring the web SUBSCRIBED catch-up.
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
  // Catch-up: the web path fires on SUBSCRIBED; the bridge path fires once
  // on subscribe so a page mounting after events flowed refetches.
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
