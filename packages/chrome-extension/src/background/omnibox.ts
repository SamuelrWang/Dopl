/**
 * Omnibox integration — type "dopl <query>" in the address bar to search.
 */

import { getAuthState, getAuthHeaders } from "./auth";

export function setupOmnibox(): void {
  chrome.omnibox.setDefaultSuggestion({
    description: "Search Dopl knowledge base: %s",
  });

  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    if (text.length < 2) return;

    try {
      const auth = await getAuthState();
      if (!auth.authenticated) return;

      const headers = await getAuthHeaders();
      const res = await fetch(`${auth.apiUrl}/api/query`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: text,
          max_results: 5,
        }),
      });

      if (!res.ok) return;

      const data = await res.json();
      const suggestions = (data.entries || [])
        .slice(0, 5)
        .map((entry: { entry_id: string; title: string | null; summary: string | null }) => ({
          content: entry.entry_id,
          description: `${entry.title || "Untitled"} — ${(entry.summary || "").slice(0, 80)}`,
        }));

      suggest(suggestions);
    } catch {
      // Silently fail — omnibox suggestions are best-effort
    }
  });

  chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
    // If it looks like a UUID (clicked a suggestion), open the entry
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
    const auth = await getAuthState();

    if (isUuid) {
      const url = `${auth.apiUrl}/entries/${text}`;
      if (disposition === "currentTab") {
        chrome.tabs.update({ url });
      } else {
        chrome.tabs.create({ url });
      }
    } else {
      // Open side panel with search
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.sidePanel.open({ tabId: tab.id });
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: "CONTEXT_MENU_ACTION",
            action: "search_selection",
            data: text,
          });
        }, 500);
      }
    }
  });
}
