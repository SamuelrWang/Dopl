/**
 * Generic hook for sending messages to the service worker.
 */

import { useCallback } from "react";
import type { PanelMessage, ServiceWorkerResponse } from "@/background/messages";

export function useBgMessage() {
  const send = useCallback(async <T = unknown>(message: PanelMessage): Promise<T> => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response: ServiceWorkerResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error("No response from service worker"));
          return;
        }
        if (response.ok) {
          resolve(response.data as T);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }, []);

  return { send };
}
