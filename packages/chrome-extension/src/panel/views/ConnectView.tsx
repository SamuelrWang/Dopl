/**
 * ConnectView — dedicated pre-auth screen.
 *
 * Replaces the old layered pre-auth UI (outer "Connect to Dopl" + embedded
 * SettingsView that showed its own connect form, About, Keyboard Shortcuts,
 * etc). A single focused card: logo, one sentence, one input, one button.
 */

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { DEFAULT_API_URL } from "@/shared/constants";

export function ConnectView() {
  const { connect } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setConnecting(true);
    setError(null);
    const ok = await connect(apiKey.trim(), (apiUrl || DEFAULT_API_URL).trim());
    if (!ok) {
      setError("Couldn't connect. Check your API key and try again.");
      setConnecting(false);
    }
    // On success, AuthProvider flips `authenticated` and App re-renders
    // into ChatView; this component unmounts before the finally runs.
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center p-6 bg-[var(--bg-base)]">
      <div className="w-full max-w-xs">
        {/* Logo + wordmark */}
        <div className="flex flex-col items-center mb-6">
          <img
            src={chrome.runtime.getURL("icons/icon-128.png")}
            alt="Dopl"
            className="w-12 h-12 rounded-xl mb-3"
          />
          <div className="text-base font-semibold text-[var(--text-primary)] tracking-tight">
            Dopl
          </div>
          <p className="text-xs text-[var(--text-muted)] text-center mt-1.5 leading-relaxed">
            Connect your Dopl API key to get started.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-dopl-..."
            autoFocus
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg
              px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)]
              font-mono focus:outline-none focus:border-[var(--accent-primary)] glow-focus transition-all"
          />

          {error && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20">
              <X size={12} className="text-[var(--coral)] shrink-0" />
              <p className="text-[11px] text-[var(--coral)]">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!apiKey.trim() || connecting}
            className="w-full py-2.5 rounded-lg text-sm font-medium
              bg-[var(--accent-primary)] text-[var(--bg-base)]
              hover:bg-[var(--accent-glow)] transition-all
              disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {connecting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Connecting…
              </span>
            ) : (
              "Connect"
            )}
          </button>
        </form>

        {/* Advanced (custom API URL) — collapsed by default so 99% of users
            see a single-input screen. Power users and self-hosters expand. */}
        <details
          open={showAdvanced}
          onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
          className="mt-4"
        >
          <summary className="text-[10px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] select-none">
            Advanced: custom API URL
          </summary>
          <input
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder={DEFAULT_API_URL}
            className="w-full mt-2 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg
              px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-disabled)]
              font-mono focus:outline-none focus:border-[var(--accent-primary)] glow-focus transition-all"
          />
        </details>

        {/* Footer link */}
        <p className="text-[10px] text-[var(--text-muted)] text-center mt-6">
          Don&apos;t have a key?{" "}
          <a
            href="https://usedopl.com/settings/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-primary)] hover:underline"
          >
            Create one on usedopl.com
          </a>
        </p>
      </div>
    </div>
  );
}
