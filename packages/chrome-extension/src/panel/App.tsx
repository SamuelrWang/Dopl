/**
 * App — root of the Dopl side panel.
 *
 * Post-connect the panel is a single chat surface (the main-site canvas
 * chat, but purpose-built for a narrow sidebar). Settings are reachable
 * via the gear icon as a back-able overlay view. Context-menu and
 * keyboard-shortcut actions fired by the service worker are turned into
 * trigger counters that ChatView consumes via useEffect.
 */

import { useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { AuthProvider } from "./providers/AuthProvider";
import { useAuth } from "./hooks/useAuth";
import { useCanvas } from "./hooks/useCanvas";
import { ChatView } from "./views/ChatView";
import { ConnectView } from "./views/ConnectView";
import { SettingsView } from "./views/SettingsView";
import { CreditBadge } from "./components/CreditBadge";
import type { ContextMenuAction } from "@/background/messages";

export function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

function AppInner() {
  const { auth, loading } = useAuth();
  const { addToCanvas } = useCanvas(auth.authenticated);
  const [showSettings, setShowSettings] = useState(false);

  // ChatView listens for these "trigger counter" props. Each time a
  // context-menu or keyboard-shortcut fires, we increment the counter,
  // ChatView's useEffect notices the change and runs the corresponding
  // action. Counters (vs booleans) let the same action fire twice in a row.
  const [extractTrigger, setExtractTrigger] = useState(0);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [prefill, setPrefill] = useState<string | null>(null);

  // Service-worker-dispatched actions (context menu, keyboard shortcuts).
  useEffect(() => {
    const handler = (message: ContextMenuAction) => {
      if (message.type !== "CONTEXT_MENU_ACTION") return;

      // Any action implicitly leaves the settings overlay.
      setShowSettings(false);

      switch (message.action) {
        case "ingest_page":
        case "ingest_link":
          setExtractTrigger((n) => n + 1);
          break;
        case "search_selection":
          // Wrap the selection in a natural-language search prompt so the
          // chat model treats it as a query rather than a bare fragment.
          if (message.data) {
            setPrefill(`Search my canvas for: ${message.data}`);
          }
          setFocusTrigger((n) => n + 1);
          break;
        case "save_snippet":
          // Paste the snippet as a quote so the user can add their own
          // question around it before sending.
          if (message.data) {
            setPrefill(`> ${message.data}\n\n`);
          }
          setFocusTrigger((n) => n + 1);
          break;
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handleAddToCanvas = useCallback(
    async (entryId: string) => {
      await addToCanvas(entryId);
    },
    [addToCanvas]
  );

  const handlePrefillConsumed = useCallback(() => {
    setPrefill(null);
  }, []);

  // ── Loading ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-base)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)]/20 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-[var(--accent-primary)] animate-pulse" />
          </div>
          <p className="text-xs text-[var(--text-muted)]">Loading…</p>
        </div>
      </div>
    );
  }

  // ── Pre-auth ───────────────────────────────────────────────────────
  if (!auth.authenticated) {
    return <ConnectView />;
  }

  // ── Settings overlay (back-able sub-view) ─────────────────────────
  if (showSettings) {
    return <SettingsView onBack={() => setShowSettings(false)} />;
  }

  // ── Main chat surface ──────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-[var(--bg-base)]">
      <header className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-inset)] border-b border-[var(--border-subtle)]">
        <img
          src={chrome.runtime.getURL("icons/icon-128.png")}
          alt="Dopl"
          className="w-4 h-4 rounded"
        />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] tracking-tight">
          Dopl
        </span>
        <span className="flex-1" />
        <CreditBadge />
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          aria-label="Settings"
          className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
        >
          <SettingsIcon size={14} />
        </button>
      </header>

      <main className="flex-1 overflow-hidden">
        <ChatView
          onAddToCanvas={handleAddToCanvas}
          extractTrigger={extractTrigger}
          focusTrigger={focusTrigger}
          prefill={prefill}
          onPrefillConsumed={handlePrefillConsumed}
        />
      </main>
    </div>
  );
}
