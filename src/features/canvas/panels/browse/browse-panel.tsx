"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useBrowseState } from "./use-browse-state";
import { BrowseClusterCard } from "./browse-cluster-card";

export function BrowsePanelBody() {
  const router = useRouter();
  const browse = useBrowseState();
  const [importingSlug, setImportingSlug] = useState<string | null>(null);
  const [importedSlugs, setImportedSlugs] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);

  const handleImport = useCallback(
    async (slug: string) => {
      setImportingSlug(slug);
      setImportError(null);
      try {
        const res = await fetch(`/api/community/${slug}/fork`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || `Import failed (${res.status})`);
        }
        setImportedSlugs((prev) => new Set(prev).add(slug));
        // /canvas is server-rendered from canvas_panels + canvas_state, so
        // a refresh re-pulls the freshly forked cluster onto the board —
        // the same surfacing pattern the community detail panel uses.
        router.refresh();
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Import failed");
      } finally {
        setImportingSlug(null);
      }
    },
    [router],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      browse.handleSearch();
    } else if (e.key === "Escape" && browse.mode === "search") {
      browse.clearSearch();
    }
  }

  const countLabel = browse.loading
    ? browse.mode === "search"
      ? "Searching..."
      : "Loading..."
    : browse.mode === "search"
      ? `${browse.totalCount} result${browse.totalCount !== 1 ? "s" : ""}`
      : `${browse.totalCount} shared cluster${browse.totalCount !== 1 ? "s" : ""}`;

  return (
    <div className="flex flex-col h-full" data-no-drag>
      {/* Search bar */}
      <div className="shrink-0 px-3 pt-3">
        <div className="relative">
          <input
            type="text"
            value={browse.query}
            onChange={(e) => browse.setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search shared clusters..."
            className="w-full h-8 px-3 pr-8 text-[13px] text-white/90 bg-white/[0.04] border border-white/[0.1] rounded-[4px] outline-none placeholder:text-white/30 focus:border-white/[0.2] focus:bg-white/[0.06] transition-colors"
          />
          {browse.mode === "search" ? (
            <button
              type="button"
              onClick={browse.clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors"
              aria-label="Clear search"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={browse.handleSearch}
              disabled={!browse.query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors disabled:opacity-30"
              aria-label="Search"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <circle cx="5" cy="5" r="3.5" />
                <path d="M8 8l2.5 2.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Controls row */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
          {countLabel}
        </span>
        {browse.mode === "browse" && (
          <select
            value={browse.sort}
            onChange={(e) =>
              browse.setSort(e.target.value as "newest" | "popular")
            }
            className="font-mono text-[10px] uppercase tracking-wide bg-transparent border border-white/[0.1] rounded-[3px] text-white/50 px-2 h-6 outline-none hover:border-white/[0.2] focus:border-white/[0.2] transition-colors cursor-pointer"
          >
            <option value="newest">Newest</option>
            <option value="popular">Popular</option>
          </select>
        )}
      </div>

      {/* Import error banner */}
      {importError && (
        <div className="shrink-0 mx-3 mb-2 px-2.5 py-1.5 rounded-[4px] bg-[color:var(--coral)]/10 border border-[color:var(--coral)]/30">
          <span className="font-mono text-[10px] text-[color:var(--coral)]">
            {importError}
          </span>
        </div>
      )}

      {/* Results grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {browse.loading ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-[6px] overflow-hidden bg-white/[0.03] border border-white/[0.08]"
              >
                <div className="aspect-[16/9] bg-white/[0.04] animate-pulse" />
                <div className="px-2.5 py-2 space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-white/[0.06] animate-pulse" />
                  <div className="h-2 w-1/3 rounded bg-white/[0.04] animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : browse.error ? (
          <div className="flex items-center justify-center h-full px-4">
            <span className="font-mono text-[11px] text-[color:var(--coral)] text-center">
              {browse.error}
            </span>
          </div>
        ) : browse.clusters.length === 0 ? (
          <div className="flex items-center justify-center h-full px-4">
            <span className="font-mono text-[11px] text-white/30 text-center">
              {browse.mode === "search"
                ? "No results found"
                : "No shared clusters yet"}
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {browse.clusters.map((cluster) => (
                <BrowseClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  onImport={handleImport}
                  importing={importingSlug === cluster.slug}
                  imported={importedSlugs.has(cluster.slug)}
                />
              ))}
            </div>
            {browse.hasMore && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={browse.loadMore}
                  disabled={browse.loadingMore}
                  className="inline-flex h-7 items-center px-3 font-mono text-[10px] uppercase tracking-wide rounded-[3px] border border-white/[0.12] text-white/60 hover:text-white/90 hover:border-white/[0.22] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {browse.loadingMore
                    ? "Loading..."
                    : `Load more (${browse.totalCount - browse.clusters.length} left)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
