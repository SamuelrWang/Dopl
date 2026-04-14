/**
 * Knowledge base search hook.
 */

import { useState, useCallback } from "react";
import { useBgMessage } from "./useBgMessage";
import type { SearchResult } from "@/shared/types";

export function useSearch() {
  const { send } = useBgMessage();
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  const search = useCallback(
    async (q: string, maxResults = 10) => {
      const trimmed = q.trim();
      if (!trimmed) return;

      setQuery(trimmed);
      setLoading(true);
      try {
        const data = await send<SearchResult>({ type: "SEARCH", query: trimmed, maxResults });
        setResults(data);
      } catch (err) {
        setResults(null);
      } finally {
        setLoading(false);
      }
    },
    [send]
  );

  const clear = useCallback(() => {
    setResults(null);
    setQuery("");
  }, []);

  return { results, loading, query, search, clear };
}
