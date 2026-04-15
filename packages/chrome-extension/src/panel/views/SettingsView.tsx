/**
 * SettingsView — Auth configuration and extension settings.
 */

import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { DEFAULT_API_URL } from "@/shared/constants";
import { Settings, Key, Link, Check, X, Loader2, LogOut, ArrowLeft } from "lucide-react";

interface SettingsViewProps {
  onBack?: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const { auth, loading, connect, disconnect } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState(auth.apiUrl || DEFAULT_API_URL);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setConnecting(true);
    setError(null);

    const success = await connect(apiKey.trim(), apiUrl.trim());
    if (!success) {
      setError("Failed to connect. Check your API key and URL.");
    } else {
      setApiKey("");
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    await disconnect();
    setApiKey("");
    setError(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-default)]">
        {onBack && (
          <button onClick={onBack} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <ArrowLeft size={14} />
          </button>
        )}
        <Settings size={14} className="text-[var(--accent-primary)]" />
        <span className="text-xs font-medium text-[var(--text-primary)]">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Connection status */}
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[var(--text-primary)]">Connection</span>
            <div className="flex items-center gap-1.5">
              <span
                className={`status-dot ${auth.authenticated ? "complete" : "error"}`}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                {auth.authenticated ? "Connected" : "Not connected"}
              </span>
            </div>
          </div>

          {auth.authenticated && (
            <div className="space-y-2">
              <div className="text-[10px] text-[var(--text-muted)]">
                <span className="font-mono">
                  {auth.mode === "api_key" ? `sk-dopl-...${auth.apiKey?.slice(-4) || ""}` : "Session"}
                </span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                <span className="font-mono">{auth.apiUrl}</span>
              </div>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs
                  text-[var(--coral)] bg-[var(--danger)]/10 rounded-md
                  hover:bg-[var(--danger)]/20 transition-colors"
              >
                <LogOut size={12} />
                Disconnect
              </button>
            </div>
          )}
        </div>

        {/* Connect form */}
        {!auth.authenticated && (
          <form onSubmit={handleConnect} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                API Key
              </label>
              <div className="relative">
                <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-dopl-..."
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg
                    pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)]
                    font-mono focus:outline-none focus:border-[var(--accent-primary)] glow-focus transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                API URL
              </label>
              <div className="relative">
                <Link size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="url"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder={DEFAULT_API_URL}
                  className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg
                    pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)]
                    font-mono focus:outline-none focus:border-[var(--accent-primary)] glow-focus transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20">
                <X size={12} className="text-[var(--coral)] shrink-0" />
                <p className="text-[10px] text-[var(--coral)]">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!apiKey.trim() || connecting}
              className="w-full py-2 rounded-lg text-xs font-medium
                bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20
                hover:bg-[var(--accent-primary)]/30 transition-all disabled:opacity-40"
            >
              {connecting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={12} className="animate-spin" />
                  Connecting...
                </span>
              ) : (
                "Connect"
              )}
            </button>
          </form>
        )}

        {/* Info */}
        <div className="glass-card p-3 space-y-1.5">
          <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
            About
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            Dopl v0.1.0
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            Dopl Chrome Extension.
            Ingest pages, search your knowledge base, and chat with AI — all from any tab.
          </p>
        </div>

        {/* Keyboard shortcuts */}
        <div className="glass-card p-3 space-y-2">
          <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Keyboard Shortcuts
          </p>
          <div className="space-y-1">
            {[
              { keys: "Ctrl+Shift+S", desc: "Toggle side panel" },
              { keys: "Ctrl+Shift+I", desc: "Quick ingest page" },
              { keys: "Ctrl+Shift+K", desc: "Quick search" },
            ].map(({ keys, desc }) => (
              <div key={keys} className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">{desc}</span>
                <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-inset)] border border-[var(--border-default)] text-[var(--text-muted)]">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
