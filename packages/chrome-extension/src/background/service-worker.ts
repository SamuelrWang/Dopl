/**
 * Dopl — Service Worker (Manifest V3)
 *
 * Central hub for:
 * - Message routing between panel and content scripts
 * - Auth state management
 * - Context menu and omnibox handlers
 * - Tab-scoped chat lifecycle
 * - Badge updates
 */

import { getAuthState, setApiKeyAuth, clearAuth } from "./auth";
import { getTabChat, saveTabChat, clearTabChat, setupTabCleanup } from "./tab-chat-store";
import { setupContextMenus, handleContextMenuClick } from "./context-menu";
import { setupOmnibox } from "./omnibox";
import * as api from "./api-client";
import type { PanelMessage, ServiceWorkerResponse } from "./messages";

// ── Initialization ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();

  // Enable side panel on action click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Tab cleanup for ephemeral chats
setupTabCleanup();

// Omnibox search
setupOmnibox();

// Context menu click handler
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

// ── Keyboard shortcuts ──────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  switch (command) {
    case "quick-ingest":
      chrome.sidePanel.open({ tabId: tab.id });
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "CONTEXT_MENU_ACTION",
          action: "ingest_page",
          data: tab.url,
        });
      }, 500);
      break;

    case "quick-search":
      chrome.sidePanel.open({ tabId: tab.id });
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "CONTEXT_MENU_ACTION",
          action: "search_selection",
          data: "",
        });
      }, 500);
      break;
  }
});

// ── Message handler ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: PanelMessage, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : "Unknown error" })
      );
    return true; // Keep the message channel open for async response
  }
);

async function handleMessage(
  message: PanelMessage,
  sender: chrome.runtime.MessageSender
): Promise<ServiceWorkerResponse> {
  switch (message.type) {
    // ── Auth ────────────────────────────────────────────────────────
    case "GET_AUTH_STATE": {
      const state = await getAuthState();
      return { ok: true, data: state };
    }

    case "SET_API_KEY": {
      const state = await setApiKeyAuth(message.apiKey, message.apiUrl);
      // Verify connection
      const connected = await api.checkConnection();
      return { ok: true, data: { ...state, authenticated: connected } };
    }

    case "CLEAR_AUTH": {
      await clearAuth();
      return { ok: true, data: null };
    }

    // ── Page extraction ────────────────────────────────────────────
    case "EXTRACT_PAGE": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: "No active tab" };

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content/extractor.js"],
      });

      const extracted = results?.[0]?.result;
      if (!extracted) return { ok: false, error: "Failed to extract page content" };
      return { ok: true, data: extracted };
    }

    // ── Search ──────────────────────────────────────────────────────
    case "SEARCH": {
      const results = await api.searchSetups(message.query, message.maxResults);
      return { ok: true, data: results };
    }

    // ── Canvas ──────────────────────────────────────────────────────
    case "GET_CANVAS_PANELS": {
      const panels = await api.getCanvasPanels();
      return { ok: true, data: panels };
    }

    case "ADD_CANVAS_PANEL": {
      const result = await api.addCanvasPanel(message.entryId);
      return { ok: true, data: result };
    }

    case "REMOVE_CANVAS_PANEL": {
      await api.removeCanvasPanel(message.entryId);
      return { ok: true, data: null };
    }

    // ── Clusters ────────────────────────────────────────────────────
    case "GET_CLUSTERS": {
      const clusters = await api.getClusters();
      return { ok: true, data: clusters };
    }

    // ── Credits ─────────────────────────────────────────────────────
    case "GET_CREDITS": {
      const credits = await api.getCredits();
      return { ok: true, data: credits };
    }

    // ── Ingestion ───────────────────────────────────────────────────
    case "INGEST_URL": {
      const ingestResult = await api.ingestUrl(message.url, message.text);
      return { ok: true, data: ingestResult };
    }

    // ── Tab chat ────────────────────────────────────────────────────
    case "GET_TAB_CHAT": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: true, data: [] };
      const messages = await getTabChat(tab.id);
      return { ok: true, data: messages };
    }

    case "SAVE_TAB_CHAT": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: "No active tab" };
      await saveTabChat(tab.id, message.messages);
      return { ok: true, data: null };
    }

    case "CLEAR_TAB_CHAT": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: "No active tab" };
      await clearTabChat(tab.id);
      return { ok: true, data: null };
    }

    // ── Current tab info ────────────────────────────────────────────
    case "GET_CURRENT_TAB": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { ok: true, data: tab ? { id: tab.id, url: tab.url, title: tab.title } : null };
    }

    // ── View navigation (noop on service worker, panel handles it) ─
    case "SET_VIEW":
      return { ok: true, data: null };

    default:
      return { ok: false, error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}

// ── Badge update on canvas changes ──────────────────────────────────

async function updateBadge(): Promise<void> {
  try {
    const auth = await getAuthState();
    if (!auth.authenticated) {
      chrome.action.setBadgeText({ text: "" });
      return;
    }

    const panels = await api.getCanvasPanels();
    const count = panels.length;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#78B8E0" }); // accent-primary approx
  } catch {
    // Badge update is best-effort
  }
}

// Update badge periodically
chrome.alarms.create("update-badge", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "update-badge") {
    updateBadge();
  }
});
