"use client";

import { useEffect, useState, useCallback } from "react";
import { EntryGrid } from "@/components/entries/entry-grid";
import { FilterSidebar } from "@/components/entries/filter-sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface EntryListItem {
  id: string;
  title: string | null;
  summary: string | null;
  source_url: string;
  source_platform: string | null;
  thumbnail_url: string | null;
  use_case: string | null;
  complexity: string | null;
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
  const [useCase, setUseCase] = useState("all");
  const [complexity, setComplexity] = useState("all");

  // Search state
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultEntry[] | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "complete");
      if (useCase !== "all") params.set("use_case", useCase);
      if (complexity !== "all") params.set("complexity", complexity);

      const res = await fetch(`/api/entries?${params}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
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
      const data = await res.json();
      setSearchResults(data.entries || []);
      setSynthesis(data.synthesis || null);
    } catch (err) {
      console.error("Search failed:", err);
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
    <div>
      {/* Search bar */}
      <div className="mb-6">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search setups... e.g. 'AI agent for cold outreach' or 'n8n automation with Supabase'"
            className="flex-1"
          />
          {isShowingSearch ? (
            <Button variant="outline" onClick={clearSearch}>
              Clear
            </Button>
          ) : (
            <Button onClick={handleSearch} disabled={searching || !query.trim()}>
              {searching ? "Searching..." : "Search"}
            </Button>
          )}
        </div>
      </div>

      {/* Search results mode */}
      {isShowingSearch && (
        <div className="space-y-4">
          {synthesis && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">AI Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm">{synthesis.recommendation}</p>
                {synthesis.composite_approach && (
                  <p className="text-sm text-muted-foreground">
                    {synthesis.composite_approach}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {searchResults!.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No matching entries found. Try a different query.
            </div>
          ) : (
            <div className="space-y-3">
              {searchResults!.map((entry) => (
                <Link key={entry.entry_id} href={`/entries/${entry.entry_id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-medium text-sm">
                            {entry.title || "Untitled"}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {entry.summary || "No summary"}
                          </p>
                          {entry.relevance_explanation && (
                            <p className="text-xs text-blue-500 mt-1">
                              {entry.relevance_explanation}
                            </p>
                          )}
                        </div>
                        <Badge variant="secondary" className="ml-3 shrink-0 text-xs">
                          {(entry.similarity * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Browse mode */}
      {!isShowingSearch && (
        <div className="flex gap-6">
          <div className="w-56 shrink-0 hidden md:block">
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
          </div>

          <div className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-muted-foreground">Loading entries...</p>
              </div>
            ) : (
              <EntryGrid entries={entries} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
