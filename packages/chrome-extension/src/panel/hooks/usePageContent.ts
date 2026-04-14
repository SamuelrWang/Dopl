/**
 * Page content extraction hook.
 */

import { useState, useCallback } from "react";
import { useBgMessage } from "./useBgMessage";
import type { ExtractedPage } from "@/shared/types";

export function usePageContent() {
  const { send } = useBgMessage();
  const [page, setPage] = useState<ExtractedPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extract = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await send<ExtractedPage>({ type: "EXTRACT_PAGE" });
      setPage(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extraction failed";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [send]);

  const clear = useCallback(() => {
    setPage(null);
    setError(null);
  }, []);

  return { page, loading, error, extract, clear };
}
