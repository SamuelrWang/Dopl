/** Base URL for the Dopl API — configurable per environment */
export const DEFAULT_API_URL = "https://setupintelligence.com";

/** Storage keys */
export const STORAGE_KEYS = {
  API_KEY: "dopl_api_key",
  API_URL: "dopl_api_url",
  AUTH_MODE: "dopl_auth_mode",
} as const;

/** Session storage key prefix for tab-scoped chats */
export const TAB_CHAT_PREFIX = "tab-chat-";

/** Canvas polling interval in ms */
export const CANVAS_POLL_INTERVAL = 30_000;

/** API request timeout in ms */
export const API_TIMEOUT = 30_000;

/** Long-running request timeout (ingestion, synthesis) */
export const LONG_TIMEOUT = 120_000;

/** Side panel view names */
export type ViewName = "chat" | "canvas" | "search" | "ingest" | "reader" | "settings";

/** Context menu IDs */
export const CONTEXT_MENU = {
  INGEST_PAGE: "dopl-ingest-page",
  INGEST_LINK: "dopl-ingest-link",
  SEARCH_SELECTION: "dopl-search-selection",
  SAVE_SNIPPET: "dopl-save-snippet",
} as const;
