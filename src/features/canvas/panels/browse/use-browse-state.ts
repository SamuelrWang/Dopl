"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface BrowseEntry {
  id: string;
  title: string | null;
  summary: string | null;
  source_platform: string | null;
  thumbnail_url: string | null;
  created_at: string | null;
  similarity?: number;
  // `relevance_explanation` was populated by server-side synthesis, which
  // has been retired in favour of client-only synthesis. Kept as optional
  // for type-compat with older response payloads still in flight; the
  // field will always be undefined from /api/query going forward.
}

// The Synthesis block used to carry a server-side-generated
// recommendation + composite_approach. Retired — callers should compose
// recommendations in their own model context. Fields stay optional so
// existing render conditionals (`synthesis && synthesis.recommendation`)
// still type-check; `synthesis` is always null at runtime now, so those
// branches never render.
export interface Synthesis {
  recommendation?: string;
  composite_approach?: string;
}

export interface BrowseState {
  mode: "browse" | "search";
  query: string;
  setQuery: (q: string) => void;
  sort: "newest" | "oldest" | "alpha";
  setSort: (s: "newest" | "oldest" | "alpha") => void;
  entries: BrowseEntry[];
  totalCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
  /** Always null post-pivot; kept for backward compat with existing consumers. */
  synthesis: Synthesis | null;
  handleSearch: () => void;
  clearSearch: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBrowseEntries(raw: any[]): BrowseEntry[] {
  return raw.map((e) => ({
    id: (e.entry_id as string) || (e.id as string),
    title: (e.title as string) ?? null,
    summary: (e.summary as string) ?? null,
    source_platform: (e.source_platform as string) ?? null,
    thumbnail_url: (e.thumbnail_url as string) ?? null,
    created_at: (e.created_at as string) ?? null,
    similarity: e.similarity as number | undefined,
    // relevance_explanation intentionally dropped — see BrowseEntry comment.
  }));
}

const PAGE_SIZE = 50;

export function useBrowseState(): BrowseState {
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "alpha">("newest");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Browse mode: fetch first page on mount and when sort changes.
  // The setState calls inside the .then callbacks are fine — they run
  // asynchronously (not synchronously in the effect body).
  useEffect(() => {
    if (mode !== "browse") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;
    setLoading(true);

    fetch(`/api/entries?status=complete&sort=${sort}&limit=${PAGE_SIZE}&offset=0`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch entries (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setEntries(mapBrowseEntries(data.entries || []));
        setTotalCount(data.total || 0);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        if (cancelled || err.name === "AbortError") return;
        setError(err.message || "Failed to load entries");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode, sort]);

  const loadMore = useCallback(() => {
    if (mode !== "browse") return;
    if (loading || loadingMore) return;
    if (entries.length >= totalCount) return;

    const offset = entries.length;
    setLoadingMore(true);

    fetch(`/api/entries?status=complete&sort=${sort}&limit=${PAGE_SIZE}&offset=${offset}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load more (${res.status})`);
        return res.json();
      })
      .then((data) => {
        const incoming = mapBrowseEntries(data.entries || []);
        // Dedup by id in case a row shifted pages between fetches.
        setEntries((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const merged = [...prev];
          for (const e of incoming) {
            if (!seen.has(e.id)) merged.push(e);
          }
          return merged;
        });
        setTotalCount(data.total || 0);
        setLoadingMore(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load more entries");
        setLoadingMore(false);
      });
  }, [mode, sort, entries.length, totalCount, loading, loadingMore]);

  const handleSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setMode("search");
    setLoading(true);
    setError(null);
    setSynthesis(null);

    fetch("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: q,
        max_results: 20,
      }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setEntries(mapBrowseEntries(data.entries || []));
        setTotalCount(data.entries?.length || 0);
        // Synthesis was removed server-side — leave `synthesis` null.
        // Any consumer UI block guarded by `synthesis && …` will cleanly
        // not render.
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message || "Search failed");
        setLoading(false);
      });
  }, [query]);

  const clearSearch = useCallback(() => {
    abortRef.current?.abort();
    setMode("browse");
    setLoading(true);
    setQuery("");
    setSynthesis(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    mode,
    query,
    setQuery,
    sort,
    setSort,
    entries,
    totalCount,
    loading,
    loadingMore,
    hasMore: mode === "browse" && entries.length < totalCount,
    loadMore,
    error,
    synthesis,
    handleSearch,
    clearSearch,
  };
}
