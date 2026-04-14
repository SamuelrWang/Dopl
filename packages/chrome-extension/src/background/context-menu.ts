/**
 * Context menu integration — right-click actions on pages.
 */

import { CONTEXT_MENU } from "@/shared/constants";

/** Register all context menu items */
export function setupContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU.INGEST_PAGE,
      title: "Ingest this page into SIE",
      contexts: ["page"],
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU.INGEST_LINK,
      title: "Ingest linked page into SIE",
      contexts: ["link"],
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU.SEARCH_SELECTION,
      title: 'Search SIE for "%s"',
      contexts: ["selection"],
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU.SAVE_SNIPPET,
      title: "Save snippet to SIE chat",
      contexts: ["selection"],
    });
  });
}

/** Handle context menu clicks */
export function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): void {
  if (!tab?.id) return;

  const tabId = tab.id;

  switch (info.menuItemId) {
    case CONTEXT_MENU.INGEST_PAGE:
      // Open side panel and trigger ingest of current page URL
      chrome.sidePanel.open({ tabId });
      // Send message to panel to ingest
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "CONTEXT_MENU_ACTION",
          action: "ingest_page",
          data: tab.url,
        });
      }, 500);
      break;

    case CONTEXT_MENU.INGEST_LINK:
      chrome.sidePanel.open({ tabId });
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "CONTEXT_MENU_ACTION",
          action: "ingest_link",
          data: info.linkUrl,
        });
      }, 500);
      break;

    case CONTEXT_MENU.SEARCH_SELECTION:
      chrome.sidePanel.open({ tabId });
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "CONTEXT_MENU_ACTION",
          action: "search_selection",
          data: info.selectionText,
        });
      }, 500);
      break;

    case CONTEXT_MENU.SAVE_SNIPPET:
      chrome.sidePanel.open({ tabId });
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: "CONTEXT_MENU_ACTION",
          action: "save_snippet",
          data: info.selectionText,
        });
      }, 500);
      break;
  }
}
