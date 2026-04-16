"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { EntryGrid } from "@/components/entries/entry-grid";
import { FilterSidebar } from "@/components/entries/filter-sidebar";
import { GlassCard, MonoLabel } from "@/components/design";

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

interface SearchResultEntry {
  entry_id: string;
  title: string | null;
  summary: string | null;
  similarity: number;
  relevance_explanation?: string;
}

interface Synthesis {
  recommendation: string;
  composite_approach?: string;
}

export default function EntriesPage() {
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [useCase, setUseCase] = useState("all");
  const [complexity, setComplexity] = useState("all");

  // Search state
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResultEntry[] | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", "complete");
      if (useCase !== "all") params.set("use_case", useCase);
      if (complexity !== "all") params.set("complexity", complexity);

      const res = await fetch(`/api/entries?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to load entries (HTTP ${res.status})`);
      }
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
      setLoadError(
        err instanceof Error ? err.message : "Failed to load entries"
      );
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [useCase, complexity]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  async function handleSearch() {
    const q = query.trim();
    if (!q) {
      clearSearch();
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          include_synthesis: true,
          max_results: 10,
        }),
      });
      if (!res.ok) {
        throw new Error(`Search failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      setSearchResults(Array.isArray(data.entries) ? data.entries : []);
      setSynthesis(data.synthesis || null);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchError(err instanceof Error ? err.message : "Search failed");
      setSearchResults(null);
      setSynthesis(null);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setSearchResults(null);
    setSynthesis(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
    if (e.key === "Escape") {
      clearSearch();
    }
  }

  const isShowingSearch = searchResults !== null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <MonoLabel tone="muted">Knowledge Base</MonoLabel>
          <h1 className="text-2xl font-semibold text-white/90 mt-1">
            Browse Setups
          </h1>
        </div>
      </div>

      {/* Search bar — sharp corners, glass-aesthetic */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search setups... e.g. 'AI agent for cold outreach' or 'n8n automation with Supabase'"
            className="w-full h-11 px-4 bg-[var(--tabs-surface)] border border-white/10 rounded-[3px] text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>
        {isShowingSearch ? (
          <button
            onClick={clearSearch}
            className="h-11 px-5 font-mono text-[10px] uppercase tracking-wide bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.1] hover:border-white/[0.2] rounded-[3px] text-white/70 hover:text-white/90 transition-all"
          >
            Clear
          </button>
        ) : (
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="h-11 px-5 font-mono text-[10px] uppercase tracking-wide bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.15] hover:border-white/[0.25] rounded-[3px] text-white/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {searching ? "Searching..." : "Search"}
          </button>
        )}
      </div>

      {/* Search results mode */}
      {isShowingSearch && (
        <div className="space-y-4">
          {searchError && (
            <GlassCard variant="subtle" className="py-4">
              <p className="text-sm text-red-400">{searchError}</p>
              <button
                onClick={handleSearch}
                className="mt-2 font-mono text-[10px] uppercase tracking-wide text-white/60 hover:text-white/90 border border-white/[0.15] rounded-[3px] px-3 py-1.5"
              >
                Retry search
              </button>
            </GlassCard>
          )}
          {synthesis && (
            <GlassCard
              label="AI Recommendation"
              accentColor="var(--mint)"
              labelDivider
            >
              <p className="text-sm text-white/80 leading-relaxed">
                {synthesis.recommendation}
              </p>
              {synthesis.composite_approach && (
                <p className="text-xs text-white/50 mt-3 leading-relaxed">
                  <span className="font-mono uppercase tracking-wide text-white/40 mr-2">
                    Approach:
                  </span>
                  {synthesis.composite_approach}
                </p>
              )}
            </GlassCard>
          )}

          {searchResults!.length === 0 ? (
            <GlassCard variant="subtle" className="text-center py-12">
              <p className="text-sm text-white/40 font-mono uppercase tracking-wide">
                No matching entries found
              </p>
              <p className="text-xs text-white/30 mt-2">
                Try a different query or clear the search
              </p>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {searchResults!.map((entry) => (
                <Link
                  key={entry.entry_id}
                  href={`/entries/${entry.entry_id}`}
                  className="block group"
                >
                  <GlassCard
                    variant="subtle"
                    className="hover:bg-white/[0.10] transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm text-white/90 group-hover:text-white transition-colors">
                          {entry.title || "Untitled"}
                        </h3>
                        <p className="text-xs text-white/50 mt-1 line-clamp-2 leading-relaxed">
                          {entry.summary || "No summary"}
                        </p>
                        {entry.relevance_explanation && (
                          <p className="text-xs text-mint mt-2 leading-relaxed" style={{ color: "var(--mint)" }}>
                            {entry.relevance_explanation}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-white/60 px-2 py-0.5 bg-white/[0.05] border border-white/[0.1] rounded-[3px]">
                          {(entry.similarity * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Browse mode */}
      {!isShowingSearch && (
        <div className="flex gap-6">
          <aside className="w-56 shrink-0 hidden md:block">
            <FilterSidebar
              useCase={useCase}
              complexity={complexity}
              onUseCaseChange={(v) => setUseCase(v || "all")}
              onComplexityChange={(v) => setComplexity(v || "all")}
              onReset={() => {
                setUseCase("all");
                setComplexity("all");
              }}
            />
          </aside>

          <div className="flex-1 min-w-0">
            {loading ? (
              <GlassCard variant="subtle" className="flex items-center justify-center h-64">
                <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                  Loading entries...
                </p>
              </GlassCard>
            ) : loadError ? (
              <GlassCard
                variant="subtle"
                className="flex flex-col items-center justify-center h-64 gap-3"
              >
                <p className="text-sm text-red-400">{loadError}</p>
                <button
                  onClick={fetchEntries}
                  className="font-mono text-[10px] uppercase tracking-wide text-white/60 hover:text-white/90 border border-white/[0.15] rounded-[3px] px-3 py-1.5"
                >
                  Retry
                </button>
              </GlassCard>
            ) : (
              <EntryGrid entries={entries} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
