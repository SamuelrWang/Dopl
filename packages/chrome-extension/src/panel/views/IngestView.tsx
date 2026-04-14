/**
 * IngestView — URL ingestion with real-time SSE progress.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useBgMessage } from "../hooks/useBgMessage";
import { IngestionProgress } from "../components/IngestionProgress";
import { EntryCard } from "../components/EntryCard";
import { Download, Link, ArrowLeft, Loader2 } from "lucide-react";
import type { IngestResponse } from "@/shared/types";

interface IngestViewProps {
  initialUrl?: string;
  onAddToCanvas?: (entryId: string) => void;
  onBack?: () => void;
}

interface ProgressEvent {
  type: string;
  message: string;
  step?: string;
}

export function IngestView({ initialUrl, onAddToCanvas, onBack }: IngestViewProps) {
  const { send } = useBgMessage();
  const [url, setUrl] = useState(initialUrl || "");
  const [ingesting, setIngesting] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [status, setStatus] = useState<"idle" | "streaming" | "complete" | "error">("idle");
  const [result, setResult] = useState<IngestResponse | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  // Auto-start if initialUrl provided
  useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl);
      handleIngest(initialUrl);
    }
  }, []); // intentionally run once

  const handleIngest = useCallback(async (targetUrl?: string) => {
    const ingestUrl = (targetUrl || url).trim();
    if (!ingestUrl || ingesting) return;

    setIngesting(true);
    setEvents([]);
    setStatus("streaming");
    setResult(null);

    try {
      // Start ingestion
      const res = await send<IngestResponse>({ type: "INGEST_URL", url: ingestUrl });
      setResult(res);

      if (res.status === "already_exists") {
        setEvents([{ type: "complete", message: "Already ingested — showing existing entry" }]);
        setStatus("complete");
        setIngesting(false);
        return;
      }

      // Stream progress
      const auth = await send<{ apiUrl: string; apiKey?: string; mode: string }>({ type: "GET_AUTH_STATE" });
      const headers: Record<string, string> = {};
      if (auth.mode === "api_key" && auth.apiKey) {
        headers["Authorization"] = `Bearer ${auth.apiKey}`;
      }

      const streamUrl = `${auth.apiUrl}/api/ingest/${res.entry_id}/stream`;
      const controller = new AbortController();
      abortRef.current = () => controller.abort();

      const streamRes = await fetch(streamUrl, { headers, signal: controller.signal });
      if (!streamRes.ok) {
        throw new Error(`Stream error: HTTP ${streamRes.status}`);
      }

      const reader = streamRes.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6).trim());
            setEvents((prev) => [...prev, event]);
            if (event.type === "complete") {
              setStatus("complete");
            } else if (event.type === "error") {
              setStatus("error");
            }
          } catch {}
        }
      }

      if (status === "streaming") setStatus("complete");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStatus("error");
        setEvents((prev) => [...prev, {
          type: "error",
          message: err instanceof Error ? err.message : "Ingestion failed",
        }]);
      }
    } finally {
      setIngesting(false);
      abortRef.current = null;
    }
  }, [url, ingesting, send, status]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleIngest();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-default)]">
        {onBack && (
          <button onClick={onBack} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <ArrowLeft size={14} />
          </button>
        )}
        <Download size={14} className="text-[var(--accent-primary)]" />
        <span className="text-xs font-medium text-[var(--text-primary)]">Ingest URL</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* URL input */}
        <form onSubmit={handleSubmit}>
          <div className="relative">
            <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg
                pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)]
                focus:outline-none focus:border-[var(--accent-primary)] glow-focus transition-all"
              disabled={ingesting}
            />
          </div>
          <button
            type="submit"
            disabled={!url.trim() || ingesting}
            className="mt-2 w-full py-2 rounded-lg text-xs font-medium
              bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20
              hover:bg-[var(--accent-primary)]/30 transition-all disabled:opacity-40"
          >
            {ingesting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin" />
                Ingesting...
              </span>
            ) : (
              "Ingest"
            )}
          </button>
        </form>

        {/* Progress */}
        {events.length > 0 && (
          <IngestionProgress
            events={events}
            status={status === "idle" ? "streaming" : status as "streaming" | "complete" | "error"}
          />
        )}

        {/* Result entry card */}
        {status === "complete" && result && (
          <div className="animate-fade-in">
            <p className="text-[10px] text-[var(--text-muted)] mb-1.5">Ingested entry:</p>
            <EntryCard
              entryId={result.entry_id}
              title={result.title || "Processing..."}
              onAddToCanvas={onAddToCanvas}
            />
          </div>
        )}
      </div>
    </div>
  );
}
