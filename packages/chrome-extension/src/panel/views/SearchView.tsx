/**
 * SearchView — Knowledge base semantic search.
 */

import { useState, useRef, useEffect } from "react";
import { useSearch } from "../hooks/useSearch";
import { EntryCard } from "../components/EntryCard";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { Search, X, Loader2 } from "lucide-react";

interface SearchViewProps {
  initialQuery?: string;
  onAddToCanvas?: (entryId: string) => void;
}

export function SearchView({ initialQuery, onAddToCanvas }: SearchViewProps) {
  const { results, loading, query, search, clear } = useSearch();
  const [input, setInput] = useState(initialQuery || "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-search if initial query provided
  useEffect(() => {
    if (initialQuery) {
      setInput(initialQuery);
      search(initialQuery);
    }
  }, [initialQuery, search]);

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(input);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <form onSubmit={handleSubmit} className="p-3 border-b border-[var(--border-default)]">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search knowledge base..."
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg
              pl-9 pr-8 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)]
              focus:outline-none focus:border-[var(--accent-primary)] glow-focus transition-all"
          />
          {input && (
            <button
              type="button"
              onClick={() => { setInput(""); clear(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </form>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[var(--accent-primary)]" />
          </div>
        )}

        {!loading && !results && !query && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Search size={24} className="text-[var(--text-disabled)] mb-2" />
            <p className="text-xs text-[var(--text-muted)]">Search your knowledge base</p>
            <p className="text-[10px] text-[var(--text-disabled)] mt-1">
              Find setups, tools, and patterns
            </p>
          </div>
        )}

        {!loading && results && (
          <>
            {/* Synthesis recommendation */}
            {results.synthesis?.recommendation && (
              <div className="glass-card p-3">
                <p className="text-[10px] font-medium text-[var(--accent-primary)] uppercase tracking-wide mb-1.5">
                  AI Recommendation
                </p>
                <MarkdownRenderer content={results.synthesis.recommendation} />
              </div>
            )}

            {/* Entry results */}
            <div className="space-y-2">
              <p className="text-[10px] text-[var(--text-muted)]">
                {results.entries.length} result{results.entries.length !== 1 ? "s" : ""}
              </p>
              {results.entries.map((entry) => (
                <EntryCard
                  key={entry.entry_id}
                  entryId={entry.entry_id}
                  title={entry.title || "Untitled"}
                  summary={entry.summary}
                  complexity={entry.manifest ? (entry.manifest as { complexity?: string }).complexity : undefined}
                  onAddToCanvas={onAddToCanvas}
                />
              ))}
            </div>

            {results.entries.length === 0 && (
              <p className="text-xs text-[var(--text-muted)] text-center py-4">
                No results for "{query}"
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
