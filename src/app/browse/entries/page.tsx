"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EntryGrid, EntryGridSkeleton } from "@/features/entries/components/entry-grid";
import { GlassCard, MonoLabel } from "@/shared/design";

interface EntryListItem {
  id: string;
  title: string | null;
  summary: string | null;
  source_url: string;
  source_platform: string | null;
  thumbnail_url: string | null;
  use_case: string | null;
  complexity: string | null;
  content_type: string | null;
  status: string;
  created_at: string;
}

interface PendingIngest {
  entry_id: string;
  url: string;
  queued_at: string;
}

// Page size for both initial load and each subsequent infinite-scroll
// batch. 24 fits ~3-4 grid rows on a typical desktop and gives the
// next batch headroom to load before the user runs out of cards.
const PAGE_SIZE = 24;

// Distance from the bottom of the page (in pixels) at which we kick
// off the next batch fetch. Larger margin = more aggressive prefetch =
// less chance the user ever sees an empty space; smaller margin =
// fewer wasted fetches if they bounce off the page early.
const ROOT_MARGIN_PX = 600;

export default function BrowseEntriesPage() {
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [pending, setPending] = useState<PendingIngest[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Refs guard against the race where IntersectionObserver fires twice
  // before React has flushed loadingMore=true. Without these, scrolling
  // fast can issue two parallel fetches for the same page.
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const loadPage = useCallback(async (offset: number, replace: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (replace) {
      setInitialLoading(true);
    } else {
      setLoadingMore(true);
    }
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", "complete");
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      const res = await fetch(`/api/entries?${params}`);
      if (!res.ok) throw new Error(`Failed to load entries (HTTP ${res.status})`);
      const data = await res.json();
      const batch: EntryListItem[] = Array.isArray(data.entries) ? data.entries : [];

      // A short batch (less than PAGE_SIZE) means we hit the end. Stop
      // observing further intersection events.
      const reachedEnd = batch.length < PAGE_SIZE;
      hasMoreRef.current = !reachedEnd;
      setHasMore(!reachedEnd);

      offsetRef.current = offset + batch.length;

      setEntries((prev) => {
        if (replace) return batch;
        // Defensive de-dupe by id. Offset pagination drifts if rows
        // are inserted between fetches; without this guard, rapid
        // ingest activity can produce duplicate cards.
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...batch.filter((e) => !seen.has(e.id))];
      });
    } catch (err) {
      console.error("Failed to fetch entries:", err);
      setLoadError(err instanceof Error ? err.message : "Failed to load entries");
      if (replace) setEntries([]);
    } finally {
      loadingRef.current = false;
      if (replace) {
        setInitialLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, []);

  const reload = useCallback(() => {
    offsetRef.current = 0;
    hasMoreRef.current = true;
    setHasMore(true);
    void loadPage(0, true);
  }, [loadPage]);

  // Initial load.
  useEffect(() => {
    void loadPage(0, true);
  }, [loadPage]);

  // Callback ref: React invokes this the moment the sentinel mounts
  // (and again with `null` on unmount), so the observer wires up
  // exactly when the element exists. A useEffect-based observer would
  // miss the mount because the sentinel is gated on `!initialLoading`
  // and renders AFTER the effect's first run, with no dep change to
  // re-trigger it.
  const setSentinel = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (
              entry.isIntersecting &&
              !loadingRef.current &&
              hasMoreRef.current
            ) {
              void loadPage(offsetRef.current, false);
            }
          }
        },
        { rootMargin: `${ROOT_MARGIN_PX}px 0px` }
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [loadPage]
  );

  // User's pending queue — skeleton entries waiting for their MCP agent.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ingest/pending")
      .then(async (r) => (r.ok ? r.json() : { recent: [] }))
      .then((data) => {
        if (!cancelled) {
          setPending(Array.isArray(data?.recent) ? data.recent : []);
        }
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      });
    return () => {
      cancelled = true;
    };
    // Fires once on mount — previously gated on `entries.length` to
    // re-poll after the initial entries load, but with infinite scroll
    // that would fire on every batch. The pending list is its own
    // surface; one refresh per page visit is enough.
  }, []);

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <GlassCard
          variant="subtle"
          className="!p-4 border border-amber-500/20 bg-amber-500/[0.04]"
        >
          <div className="flex items-center justify-between mb-3">
            <MonoLabel tone="muted" accentColor="rgb(245,158,11)">
              Your queued URLs ({pending.length})
            </MonoLabel>
            <span className="text-[10px] text-amber-300/60 font-mono uppercase tracking-wide">
              Waiting for your agent
            </span>
          </div>
          <ul className="space-y-1.5">
            {pending.map((p) => (
              <li
                key={p.entry_id}
                className="flex items-center gap-3 text-xs text-white/70"
              >
                <span className="font-mono text-[10px] text-amber-400/80 shrink-0">
                  ●
                </span>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate hover:text-white/90 transition-colors"
                  title={p.url}
                >
                  {p.url}
                </a>
                <span className="ml-auto text-[10px] text-white/30 font-mono shrink-0">
                  {new Date(p.queued_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-white/40 leading-relaxed">
            These URLs will be processed the next time your connected MCP
            agent calls a Dopl tool.
          </p>
        </GlassCard>
      )}

      {initialLoading ? (
        <EntryGridSkeleton />
      ) : loadError && entries.length === 0 ? (
        <GlassCard
          variant="subtle"
          className="flex flex-col items-center justify-center h-64 gap-3"
        >
          <p className="text-sm text-red-400">{loadError}</p>
          <button
            onClick={reload}
            className="font-mono text-[10px] uppercase tracking-wide text-white/60 hover:text-white/90 border border-white/[0.15] rounded-[3px] px-3 py-1.5"
          >
            Retry
          </button>
        </GlassCard>
      ) : (
        <>
          <EntryGrid entries={entries} />

          {/* Loader row shown while the next batch is in flight. Mirrors
              the initial skeleton so the page doesn't visually jolt. */}
          {loadingMore && (
            <div className="pt-2">
              <EntryGridSkeleton />
            </div>
          )}

          {/* IntersectionObserver sentinel. Sits ~600px above the actual
              bottom of the grid (rootMargin) so the next batch starts
              loading before the user reaches the end. Hidden but takes
              one row of vertical space so it intersects reliably. */}
          {hasMore && (
            <div ref={setSentinel} aria-hidden className="h-px w-full" />
          )}

          {/* End-of-list affordance + inline retry on mid-stream errors. */}
          {!hasMore && entries.length > 0 && (
            <p className="pt-6 pb-4 text-center font-mono text-[10px] uppercase tracking-wider text-white/30">
              End of feed
            </p>
          )}
          {loadError && entries.length > 0 && (
            <div className="pt-4 flex justify-center">
              <button
                onClick={() => void loadPage(offsetRef.current, false)}
                className="font-mono text-[10px] uppercase tracking-wide text-red-300/80 hover:text-red-200 border border-red-400/30 rounded-[3px] px-3 py-1.5"
              >
                Retry — {loadError}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
