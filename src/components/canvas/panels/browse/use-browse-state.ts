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
  relevance_explanation?: string;
}

export interface Synthesis {
  recommendation: string;
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
  error: string | null;
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
    relevance_explanation: e.relevance_explanation as string | undefined,
  }));
}

export function useBrowseState(): BrowseState {
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "alpha">("newest");
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Browse mode: fetch entries on mount and when sort changes.
  // The setState calls inside the .then callbacks are fine — they run
  // asynchronously (not synchronously in the effect body).
  useEffect(() => {
    if (mode !== "browse") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;

    fetch(`/api/entries?status=complete&sort=${sort}&limit=50`, {
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
        include_synthesis: true,
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
        if (data.synthesis) {
          setSynthesis(data.synthesis);
        }
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
    error,
    synthesis,
    handleSearch,
    clearSearch,
  };
}
