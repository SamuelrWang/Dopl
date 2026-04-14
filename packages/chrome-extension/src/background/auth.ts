/**
 * Auth state management for the extension.
 * Supports two modes:
 *   1. API key mode — user provides sk-sie-* key, stored in chrome.storage.sync
 *   2. Session mode — reuse Supabase session from the SIE web app (cookie-based)
 */

import { STORAGE_KEYS, DEFAULT_API_URL } from "@/shared/constants";
import type { AuthState } from "./messages";

let cachedAuth: AuthState | null = null;

/** Load auth state from chrome.storage.sync */
export async function getAuthState(): Promise<AuthState> {
  if (cachedAuth) return cachedAuth;

  const stored = await chrome.storage.sync.get([
    STORAGE_KEYS.API_KEY,
    STORAGE_KEYS.API_URL,
    STORAGE_KEYS.AUTH_MODE,
  ]);

  const apiKey = stored[STORAGE_KEYS.API_KEY] as string | undefined;
  const apiUrl = (stored[STORAGE_KEYS.API_URL] as string) || DEFAULT_API_URL;
  const mode = (stored[STORAGE_KEYS.AUTH_MODE] as AuthState["mode"]) || "none";

  cachedAuth = {
    mode,
    apiKey,
    apiUrl,
    authenticated: mode !== "none",
  };

  return cachedAuth;
}

/** Set API key auth */
export async function setApiKeyAuth(apiKey: string, apiUrl: string): Promise<AuthState> {
  await chrome.storage.sync.set({
    [STORAGE_KEYS.API_KEY]: apiKey,
    [STORAGE_KEYS.API_URL]: apiUrl || DEFAULT_API_URL,
    [STORAGE_KEYS.AUTH_MODE]: "api_key",
  });

  cachedAuth = {
    mode: "api_key",
    apiKey,
    apiUrl: apiUrl || DEFAULT_API_URL,
    authenticated: true,
  };

  // Update badge to show connected state
  chrome.action.setBadgeBackgroundColor({ color: "#9EFFBF" });
  chrome.action.setBadgeText({ text: "" });

  return cachedAuth;
}

/** Clear auth state */
export async function clearAuth(): Promise<void> {
  await chrome.storage.sync.remove([
    STORAGE_KEYS.API_KEY,
    STORAGE_KEYS.API_URL,
    STORAGE_KEYS.AUTH_MODE,
  ]);
  cachedAuth = null;
}

/** Get auth headers for API requests */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthState();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth.mode === "api_key" && auth.apiKey) {
    headers["Authorization"] = `Bearer ${auth.apiKey}`;
  }

  return headers;
}
