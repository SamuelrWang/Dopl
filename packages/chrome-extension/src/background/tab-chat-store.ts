/**
 * Tab-scoped ephemeral chat storage.
 * Uses chrome.storage.session — auto-clears on browser close.
 * Each tab gets an independent conversation keyed by tab-chat-{tabId}.
 */

import { TAB_CHAT_PREFIX } from "@/shared/constants";
import type { ChatMessage } from "@/shared/types";

function chatKey(tabId: number): string {
  return `${TAB_CHAT_PREFIX}${tabId}`;
}

/** Get chat messages for a tab */
export async function getTabChat(tabId: number): Promise<ChatMessage[]> {
  const key = chatKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return (stored[key] as ChatMessage[]) || [];
}

/** Save chat messages for a tab */
export async function saveTabChat(tabId: number, messages: ChatMessage[]): Promise<void> {
  const key = chatKey(tabId);
  await chrome.storage.session.set({ [key]: messages });
}

/** Clear chat for a tab */
export async function clearTabChat(tabId: number): Promise<void> {
  const key = chatKey(tabId);
  await chrome.storage.session.remove(key);
}

/** Set up auto-cleanup on tab close */
export function setupTabCleanup(): void {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    await clearTabChat(tabId);
  });
}
