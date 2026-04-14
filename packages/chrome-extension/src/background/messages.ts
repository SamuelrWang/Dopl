/**
 * Message types for communication between service worker, side panel, and content scripts.
 * All messages are strongly typed via discriminated union.
 */

import type { ChatMessage, CanvasPanel, SearchResult, ExtractedPage, IngestResponse, ClusterRow } from "@/shared/types";

// ── Messages FROM panel TO service worker ──────────────────────────

export type PanelMessage =
  | { type: "GET_AUTH_STATE" }
  | { type: "SET_API_KEY"; apiKey: string; apiUrl: string }
  | { type: "CLEAR_AUTH" }
  | { type: "EXTRACT_PAGE" }
  | { type: "INGEST_URL"; url: string; text?: string }
  | { type: "SEARCH"; query: string; maxResults?: number }
  | { type: "GET_CANVAS_PANELS" }
  | { type: "ADD_CANVAS_PANEL"; entryId: string }
  | { type: "REMOVE_CANVAS_PANEL"; entryId: string }
  | { type: "GET_CLUSTERS" }
  | { type: "GET_TAB_CHAT" }
  | { type: "SAVE_TAB_CHAT"; messages: ChatMessage[] }
  | { type: "CLEAR_TAB_CHAT" }
  | { type: "GET_CURRENT_TAB" }
  | { type: "SET_VIEW"; view: string };

// ── Responses FROM service worker TO panel ─────────────────────────

export type ServiceWorkerResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

// ── Auth state ─────────────────────────────────────────────────────

export interface AuthState {
  mode: "none" | "api_key" | "session";
  apiKey?: string;
  apiUrl: string;
  authenticated: boolean;
}

// ── Context menu action ────────────────────────────────────────────

export interface ContextMenuAction {
  type: "CONTEXT_MENU_ACTION";
  action: "ingest_page" | "ingest_link" | "search_selection" | "save_snippet";
  data?: string;
}
