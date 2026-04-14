"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Search, X } from "lucide-react";
import { CommunityCard } from "@/components/community/community-card";
import type { PublishedClusterSummary } from "@/lib/community/types";

type SortOption = "popular" | "newest";

export default function CommunityPage() {
  const [items, setItems] = useState<PublishedClusterSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>("popular");
  const [category, setCategory] = useState<string>("");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limit = 20;

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value.trim());
      setPage(1);
    }, 300);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [sort, category]);

  useEffect(() => {
    fetchClusters();
  }, [sort, category, page, searchQuery]);

  async function fetchClusters() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit) });

      if (searchQuery) {
        // Semantic search mode
        params.set("q", searchQuery);
        if (category) params.set("category", category);
      } else {
        // Listing mode
        params.set("page", String(page));
        params.set("sort", sort);
        if (category) params.set("category", category);
      }

      const res = await fetch(`/api/community?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.ceil(total / limit);
  const isSearching = searchQuery.length > 0;

  const CATEGORIES = [
    "marketing",
    "development",
    "automation",
    "data & analytics",
    "design",
    "productivity",
    "ai & ml",
    "devops",
    "security",
  ];

  return (
    <div className="max-w-[1200px] mx-auto py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors mb-3"
          >
            <ArrowLeft size={12} /> Home
          </Link>
          <h1 className="text-3xl font-semibold text-white">Community</h1>
          <p className="text-sm text-white/40 mt-1">
            Explore clusters shared by the community
          </p>
        </div>
        <Link
          href="/community/posts"
          className="text-sm text-white/50 hover:text-white border border-white/[0.1] hover:border-white/[0.2] px-4 h-8 rounded-md inline-flex items-center transition-colors"
        >
          My Posts
        </Link>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none"
        />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search clusters... (e.g. marketing automation, AI agents)"
          className="w-full h-10 pl-9 pr-9 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 outline-none focus:border-white/[0.15] transition-colors"
        />
        {searchInput && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Sort (hidden during search — results are sorted by relevance) */}
        {!isSearching && (
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-md border border-white/[0.08] overflow-hidden">
            <button
              onClick={() => setSort("popular")}
              className={`h-7 px-3 text-xs font-medium transition-colors ${
                sort === "popular"
                  ? "text-white bg-white/[0.08]"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              Popular
            </button>
            <button
              onClick={() => setSort("newest")}
              className={`h-7 px-3 text-xs font-medium transition-colors ${
                sort === "newest"
                  ? "text-white bg-white/[0.08]"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              Newest
            </button>
          </div>
        )}

        {isSearching && (
          <span className="text-xs text-white/30 h-7 flex items-center">
            Sorted by relevance
          </span>
        )}

        {/* Category pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setCategory("")}
            className={`h-7 px-3 rounded-full text-xs transition-colors border ${
              !category
                ? "text-white bg-white/[0.08] border-white/[0.15]"
                : "text-white/40 hover:text-white/60 border-white/[0.06] hover:border-white/[0.12]"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat === category ? "" : cat)}
              className={`h-7 px-3 rounded-full text-xs capitalize transition-colors border ${
                category === cat
                  ? "text-white bg-white/[0.08] border-white/[0.15]"
                  : "text-white/40 hover:text-white/60 border-white/[0.06] hover:border-white/[0.12]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[16/10] bg-white/[0.04] rounded-xl mb-3" />
              <div className="h-4 w-3/4 bg-white/[0.04] rounded mb-2" />
              <div className="h-3 w-1/2 bg-white/[0.04] rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 border border-white/[0.06] rounded-xl">
          <p className="text-white/30 mb-1">
            {isSearching ? "No results found" : "No clusters found"}
          </p>
          <p className="text-xs text-white/20">
            {isSearching
              ? "Try different search terms or clear filters"
              : category
                ? "Try a different category or clear filters"
                : "Be the first to publish a cluster!"}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {items.map((item) => (
              <CommunityCard key={item.id} cluster={item} />
            ))}
          </div>

          {/* Pagination (hidden during search) */}
          {!isSearching && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 px-3 rounded text-xs text-white/40 hover:text-white border border-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-white/30 px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-8 px-3 rounded text-xs text-white/40 hover:text-white border border-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
