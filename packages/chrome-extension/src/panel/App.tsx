/**
 * App — Root component for the SIE Debugger side panel.
 *
 * Manages view routing, auth gating, and cross-view communication.
 * Listens for context menu actions and keyboard shortcuts from the service worker.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./hooks/useAuth";
import { useCanvas } from "./hooks/useCanvas";
import { PanelTabs } from "./components/PanelTabs";
import { ChatView } from "./views/ChatView";
import { CanvasView } from "./views/CanvasView";
import { SearchView } from "./views/SearchView";
import { IngestView } from "./views/IngestView";
import { PageReaderView } from "./views/PageReaderView";
import { SettingsView } from "./views/SettingsView";
import type { ViewName } from "@/shared/constants";
import type { ContextMenuAction } from "@/background/messages";

export function App() {
  const { auth, loading: authLoading } = useAuth();
  const { addToCanvas } = useCanvas(auth.authenticated);
  const [view, setView] = useState<ViewName>("chat");
  const [searchQuery, setSearchQuery] = useState<string | undefined>();
  const [ingestUrl, setIngestUrl] = useState<string | undefined>();

  // Listen for context menu / keyboard shortcut actions from service worker
  useEffect(() => {
    const handler = (message: ContextMenuAction) => {
      if (message.type !== "CONTEXT_MENU_ACTION") return;

      switch (message.action) {
        case "ingest_page":
        case "ingest_link":
          setIngestUrl(message.data || "");
          setView("ingest");
          break;
        case "search_selection":
          setSearchQuery(message.data || "");
          setView("search");
          break;
        case "save_snippet":
          // Navigate to chat and pre-fill with snippet context
          setView("chat");
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handleAddToCanvas = useCallback(
    async (entryId: string) => {
      const success = await addToCanvas(entryId);
      if (success) {
        // Brief visual feedback could be added here
      }
    },
    [addToCanvas]
  );

  const handleNavigateToIngest = useCallback((url: string) => {
    setIngestUrl(url);
    setView("ingest");
  }, []);

  const handleNavigateToSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setView("search");
  }, []);

  // Auth loading state
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/20 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-[var(--accent-primary)] animate-pulse" />
          </div>
          <p className="text-xs text-[var(--text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated — show settings
  if (!auth.authenticated) {
    return (
      <div className="h-screen flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-default)] bg-[var(--bg-inset)]">
          <div className="w-5 h-5 rounded bg-[var(--accent-primary)]/20 flex items-center justify-center">
            <span className="text-[10px] font-bold text-[var(--accent-primary)]">S</span>
          </div>
          <span className="text-xs font-semibold text-[var(--text-primary)]">SIE Debugger</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent-primary)]/10 flex items-center justify-center mb-4">
            <span className="text-lg font-bold text-[var(--accent-primary)]">SIE</span>
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
            Connect to SIE
          </h2>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Enter your API key to connect to your Setup Intelligence Engine account.
          </p>
        </div>

        <SettingsView />
      </div>
    );
  }

  // Authenticated — main app
  const isSubView = view === "ingest" || view === "reader" || view === "settings";
  const activeTab = isSubView ? "chat" : view;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-inset)] border-b border-[var(--border-subtle)]">
        <div className="w-4 h-4 rounded bg-[var(--accent-primary)]/20 flex items-center justify-center">
          <span className="text-[8px] font-bold text-[var(--accent-primary)]">S</span>
        </div>
        <span className="text-[10px] font-semibold text-[var(--text-secondary)]">SIE Debugger</span>
        <span className="flex-1" />
        <div className="flex items-center gap-1">
          <span className="status-dot complete" />
          <span className="text-[9px] text-[var(--text-muted)]">Connected</span>
        </div>
      </div>

      {/* Tab bar (hidden for sub-views) */}
      {!isSubView && (
        <PanelTabs
          active={activeTab as ViewName}
          onChange={setView}
          onSettingsClick={() => setView("settings")}
        />
      )}

      {/* View content */}
      <div className="flex-1 overflow-hidden">
        {view === "chat" && (
          <ChatView
            onAddToCanvas={handleAddToCanvas}
            onNavigateToIngest={handleNavigateToIngest}
          />
        )}
        {view === "canvas" && <CanvasView />}
        {view === "search" && (
          <SearchView
            initialQuery={searchQuery}
            onAddToCanvas={handleAddToCanvas}
          />
        )}
        {view === "ingest" && (
          <IngestView
            initialUrl={ingestUrl}
            onAddToCanvas={handleAddToCanvas}
            onBack={() => { setView("chat"); setIngestUrl(undefined); }}
          />
        )}
        {view === "reader" && (
          <PageReaderView
            onIngest={(url, text) => {
              setIngestUrl(url);
              setView("ingest");
            }}
            onSendToChat={() => setView("chat")}
            onBack={() => setView("chat")}
          />
        )}
        {view === "settings" && (
          <SettingsView onBack={() => setView("chat")} />
        )}
      </div>
    </div>
  );
}
