/**
 * SIE API client for the Chrome extension.
 * Adapted from packages/mcp-server/src/api-client.ts for browser environment.
 * All API calls route through this module for consistent auth & error handling.
 */

import { getAuthState, getAuthHeaders } from "./auth";
import { API_TIMEOUT, LONG_TIMEOUT } from "@/shared/constants";
import type {
  CanvasPanel,
  SearchResult,
  ClusterRow,
  ClusterDetail,
  IngestResponse,
  Entry,
} from "@/shared/types";

async function getBaseUrl(): Promise<string> {
  const auth = await getAuthState();
  return auth.apiUrl;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const { method = "GET", body, timeoutMs = API_TIMEOUT } = options;
  const baseUrl = await getBaseUrl();
  const headers = await getAuthHeaders();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SIE API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${method} ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Search ──────────────────────────────────────────────────────────

export async function searchSetups(query: string, maxResults = 5): Promise<SearchResult> {
  return request<SearchResult>("/api/query", {
    method: "POST",
    body: {
      query,
      max_results: maxResults,
      include_synthesis: true,
    },
  });
}

// ── Entries ──────────────────────────────────────────────────────────

export async function getEntry(id: string): Promise<Entry> {
  return request<Entry>(`/api/entries/${encodeURIComponent(id)}`);
}

// ── Canvas ──────────────────────────────────────────────────────────

export async function getCanvasPanels(): Promise<CanvasPanel[]> {
  const res = await request<{ panels: CanvasPanel[] }>("/api/canvas/panels");
  return res.panels;
}

export async function addCanvasPanel(entryId: string): Promise<{ panel: CanvasPanel; created: boolean }> {
  return request<{ panel: CanvasPanel; created: boolean }>("/api/canvas/panels", {
    method: "POST",
    body: { entry_id: entryId },
  });
}

export async function removeCanvasPanel(entryId: string): Promise<void> {
  const baseUrl = await getBaseUrl();
  const headers = await getAuthHeaders();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const res = await fetch(`${baseUrl}/api/canvas/panels/${encodeURIComponent(entryId)}`, {
      method: "DELETE",
      headers,
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new Error(`SIE API error ${res.status}: ${text}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Clusters ────────────────────────────────────────────────────────

export async function getClusters(): Promise<ClusterRow[]> {
  const res = await request<{ clusters: ClusterRow[] }>("/api/clusters");
  return res.clusters;
}

export async function getCluster(slug: string): Promise<ClusterDetail> {
  return request<ClusterDetail>(`/api/clusters/${encodeURIComponent(slug)}`);
}

// ── Ingestion ───────────────────────────────────────────────────────

export async function ingestUrl(url: string, text?: string): Promise<IngestResponse> {
  return request<IngestResponse>("/api/ingest", {
    method: "POST",
    body: { url, content: { text: text || "" } },
    timeoutMs: LONG_TIMEOUT,
  });
}

/**
 * Create a streaming connection to monitor ingestion progress.
 * Returns an EventSource-like interface.
 */
export async function streamIngestionProgress(
  entryId: string,
  onEvent: (event: { type: string; message: string; step?: string }) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<() => void> {
  const baseUrl = await getBaseUrl();
  const auth = await getAuthState();

  const url = `${baseUrl}/api/ingest/${entryId}/stream`;
  const controller = new AbortController();

  (async () => {
    try {
      const headers: Record<string, string> = {};
      if (auth.mode === "api_key" && auth.apiKey) {
        headers["Authorization"] = `Bearer ${auth.apiKey}`;
      }

      const res = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        onError(`HTTP ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onError("No response stream");
        return;
      }

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
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === "complete" || event.type === "error") {
              onEvent(event);
              onDone();
              return;
            }
            onEvent(event);
          } catch {
            continue;
          }
        }
      }

      onDone();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError(err instanceof Error ? err.message : "Stream error");
      }
    }
  })();

  return () => controller.abort();
}

// ── Chat ────────────────────────────────────────────────────────────

/**
 * Stream a chat message through /api/chat.
 * Returns an abort function.
 */
export async function streamChat(
  messages: Array<{ role: string; content: string }>,
  canvasContext?: unknown,
  onEvent: (event: { type: string; [key: string]: unknown }) => void = () => {},
  onDone: () => void = () => {},
  onError: (error: string) => void = () => {}
): Promise<() => void> {
  const baseUrl = await getBaseUrl();
  const headers = await getAuthHeaders();
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ messages, canvasContext }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onError((err as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onError("No response stream");
        return;
      }

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
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            onEvent(event);
            if (event.type === "done" || event.type === "error") {
              onDone();
              return;
            }
          } catch {
            continue;
          }
        }
      }

      onDone();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError(err instanceof Error ? err.message : "Chat stream error");
      }
    }
  })();

  return () => controller.abort();
}

// ── Health check ────────────────────────────────────────────────────

export async function checkConnection(): Promise<boolean> {
  try {
    await getCanvasPanels();
    return true;
  } catch {
    return false;
  }
}
