"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * use-browse-state — data layer for the Browse panel.
 *
 * The panel browses **shared clusters** (the public community gallery) via
 * `GET /api/community`:
 *   - listing mode  → `?sort=newest|popular&limit&page` → { items, total }
 *   - search mode   → `?q=<query>`                       → { items, total }
 *
 * It used to browse individual KB entries (GitHub repos / X posts) via
 * `/api/entries` + `/api/query`; that surface was retired when ingestion of
 * arbitrary links was dropped, so the panel now surfaces shareable clusters
 * the user can import onto their canvas.
 */
export interface BrowseCluster {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  thumbnail_url: string | null;
  fork_count: number;
  panel_count: number;
  author_name: string | null;
  author_avatar: string | null;
  created_at: string;
}

export interface BrowseState {
  mode: "browse" | "search";
  query: string;
  setQuery: (q: string) => void;
  sort: "newest" | "popular";
  setSort: (s: "newest" | "popular") => void;
  clusters: BrowseCluster[];
  totalCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
  handleSearch: () => void;
  clearSearch: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapClusters(raw: any[]): BrowseCluster[] {
  return raw.map((c) => ({
    id: c.id as string,
    slug: c.slug as string,
    title: (c.title as string) ?? "Untitled cluster",
    description: (c.description as string) ?? "",
    category: (c.category as string) ?? null,
    thumbnail_url: (c.thumbnail_url as string) ?? null,
    fork_count: (c.fork_count as number) ?? 0,
    panel_count: (c.panel_count as number) ?? 0,
    author_name: c.author?.display_name ?? null,
    author_avatar: c.author?.avatar_url ?? null,
    created_at: (c.created_at as string) ?? "",
  }));
}

const PAGE_SIZE = 30;

export function useBrowseState(): BrowseState {
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [clusters, setClusters] = useState<BrowseCluster[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Browse mode: fetch first page on mount and when sort changes.
  // State updates live inside the async IIFE (not the effect body) so they
  // don't trigger the cascading-render lint and run only as fetch resolves.
  useEffect(() => {
    if (mode !== "browse") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setPage(1);
      try {
        const res = await fetch(
          `/api/community?sort=${sort}&limit=${PAGE_SIZE}&page=1`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch clusters (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        setClusters(mapClusters(data.items || []));
        setTotalCount(data.total || 0);
        setError(null);
      } catch (err) {
        const e = err as Error;
        if (cancelled || e.name === "AbortError") return;
        setError(e.message || "Failed to load shared clusters");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode, sort]);

  const loadMore = useCallback(() => {
    if (mode !== "browse") return;
    if (loading || loadingMore) return;
    if (clusters.length >= totalCount) return;

    const nextPage = page + 1;
    setLoadingMore(true);

    fetch(`/api/community?sort=${sort}&limit=${PAGE_SIZE}&page=${nextPage}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load more (${res.status})`);
        return res.json();
      })
      .then((data) => {
        const incoming = mapClusters(data.items || []);
        // Dedup by id in case a row shifted pages between fetches.
        setClusters((prev) => {
          const seen = new Set(prev.map((c) => c.id));
          const merged = [...prev];
          for (const c of incoming) {
            if (!seen.has(c.id)) merged.push(c);
          }
          return merged;
        });
        setTotalCount(data.total || 0);
        setPage(nextPage);
        setLoadingMore(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load more clusters");
        setLoadingMore(false);
      });
  }, [mode, sort, page, clusters.length, totalCount, loading, loadingMore]);

  const handleSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setMode("search");
    setLoading(true);
    setError(null);

    fetch(`/api/community?q=${encodeURIComponent(q)}&limit=20`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setClusters(mapClusters(data.items || []));
        setTotalCount(data.total ?? data.items?.length ?? 0);
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
    clusters,
    totalCount,
    loading,
    loadingMore,
    hasMore: mode === "browse" && clusters.length < totalCount,
    loadMore,
    error,
    handleSearch,
    clearSearch,
  };
}
